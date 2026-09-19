"""Subscription & plan endpoints for a logged-in tenant (PRD US "Subscription plan enforcement" +
"Razorpay subscription integration")."""
import logging
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from common.api import ApiError

from . import razorpay_service as rz
from .models import SubscriptionPayment
from .plans import COMPARISON, PAID_PLAN_KEYS, PLANS
from .public_views import _period_end, _plan_from_subscription
from .services import activate_plan, normalize_plan, record_payment

log = logging.getLogger(__name__)


def subscription_state(request) -> dict:
    from billing.usage import get_usage

    business = normalize_plan(request.tenant)
    plan_key = business.effective_plan
    return {
        "plan": plan_key,
        "plan_name": PLANS[plan_key]["name"],
        "plan_expires_on": business.plan_expires_on,
        "cancel_at_period_end": business.cancel_at_period_end,
        "has_subscription": bool(business.razorpay_subscription_id),
        "limits": PLANS[plan_key]["limits"],
        "usage": get_usage(),
        "plans": list(PLANS.values()),
        "comparison": COMPARISON,
        "razorpay": {
            "mock": settings.RAZORPAY_MOCK,
            "configured": settings.RAZORPAY_CONFIGURED,
            "key_id": settings.RAZORPAY_KEY_ID if settings.RAZORPAY_CONFIGURED else "",
        },
        "receipts": [
            {
                "id": p.id, "receipt_number": p.receipt_number, "plan": p.plan, "plan_name": PLANS[p.plan]["name"],
                "amount": p.amount, "paid_at": p.paid_at, "is_demo": p.is_demo, "status": p.status,
            }
            for p in business.payments.all()[:24]
        ],
    }


class SubscriptionView(APIView):
    def get(self, request):
        return Response(subscription_state(request))


class CheckoutView(APIView):
    """Step 1 of an upgrade: create the Razorpay subscription the browser will pay for."""

    def post(self, request):
        plan_key = request.data.get("plan")
        if plan_key not in PAID_PLAN_KEYS:
            raise ApiError("Choose the Starter or Pro plan.", "invalid_plan")
        business = normalize_plan(request.tenant)
        if business.effective_plan == plan_key and not business.cancel_at_period_end:
            raise ApiError(f"You are already on the {PLANS[plan_key]['name']} plan.", "same_plan")

        plan = PLANS[plan_key]
        if settings.RAZORPAY_MOCK:
            return Response({
                "mode": "mock", "plan": plan_key, "amount": plan["price"],
                "subscription_id": f"sub_mock_{secrets.token_hex(8)}",
            })
        if not settings.RAZORPAY_CONFIGURED:
            raise ApiError("Online payments are not configured yet. Please contact support.", "payments_unconfigured", 503)

        plan_id = settings.RAZORPAY_PLAN_IDS.get(plan_key)
        if not plan_id:
            raise ApiError("This plan is not set up on Razorpay yet. Please contact support.", "plan_unconfigured", 503)
        try:
            sub = rz.create_subscription(plan_id, business.schema_name, plan_key)
        except rz.RazorpayError as exc:
            raise ApiError(str(exc), "razorpay_error", 502)
        return Response({
            "mode": "razorpay", "plan": plan_key, "amount": plan["price"], "subscription_id": sub["id"],
            "key_id": settings.RAZORPAY_KEY_ID, "business_name": business.name,
            "prefill": {"email": request.user.email},
        })


class VerifyView(APIView):
    """Step 2: the browser reports a successful payment; we verify the signature and switch plan."""

    def post(self, request):
        data = request.data
        plan_key = data.get("plan")
        sub_id = data.get("razorpay_subscription_id", "")
        pay_id = data.get("razorpay_payment_id", "")
        if plan_key not in PAID_PLAN_KEYS:
            raise ApiError("Choose the Starter or Pro plan.", "invalid_plan")
        business = normalize_plan(request.tenant)
        old_sub = business.razorpay_subscription_id

        if settings.RAZORPAY_MOCK and sub_id.startswith("sub_mock_"):
            period_end = timezone.localdate() + timedelta(days=30)
            pay_id = pay_id or f"pay_mock_{secrets.token_hex(8)}"
            is_demo = True
        elif settings.RAZORPAY_CONFIGURED:
            if not rz.verify_checkout_signature(pay_id, sub_id, data.get("razorpay_signature", "")):
                raise ApiError("Payment signature could not be verified.", "bad_signature", 400)
            try:
                sub = rz.fetch_subscription(sub_id)
            except rz.RazorpayError as exc:
                raise ApiError(str(exc), "razorpay_error", 502)
            plan_key = _plan_from_subscription(sub) or plan_key  # trust Razorpay, not the browser
            period_end, is_demo = _period_end(sub), False
        else:
            raise ApiError("Online payments are not configured.", "payments_unconfigured", 503)

        record_payment(business, plan_key, pay_id, sub_id, Decimal(PLANS[plan_key]["price"]), period_end, is_demo)
        activate_plan(business, plan_key, sub_id, period_end)

        if old_sub and old_sub != sub_id and not old_sub.startswith("sub_mock_") and settings.RAZORPAY_CONFIGURED:
            try:  # plan switch: stop billing the previous subscription straight away
                rz.cancel_subscription(old_sub, at_cycle_end=False)
            except rz.RazorpayError:
                log.warning("Could not cancel superseded subscription %s", old_sub)
        return Response(subscription_state(request))


class CancelView(APIView):
    """Cancel / downgrade to Free: the paid plan stays active until the period ends."""

    def post(self, request):
        business = normalize_plan(request.tenant)
        if business.plan == "free":
            raise ApiError("You are on the Free plan - there is nothing to cancel.", "nothing_to_cancel")
        sub_id = business.razorpay_subscription_id
        if sub_id and not sub_id.startswith("sub_mock_") and settings.RAZORPAY_CONFIGURED:
            try:
                rz.cancel_subscription(sub_id, at_cycle_end=True)
            except rz.RazorpayError as exc:
                raise ApiError(str(exc), "razorpay_error", 502)
        business.cancel_at_period_end = True
        business.save(update_fields=["cancel_at_period_end"])
        return Response(subscription_state(request))


class ReceiptPdfView(APIView):
    def get(self, request, pk):
        payment = get_object_or_404(SubscriptionPayment, pk=pk, business=request.tenant)
        try:
            from weasyprint import HTML
        except OSError:  # native libs missing
            raise ApiError("PDF engine is not available on this server.", "pdf_unavailable", 503)
        profile = getattr(request.user, "profile", None)
        html = render_to_string("tenants/receipt.html", {
            "payment": payment, "business": request.tenant, "plan": PLANS.get(payment.plan, PLANS["free"]),
            "profile": profile,
        })
        pdf = HTML(string=html).write_pdf()
        response = HttpResponse(pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{payment.receipt_number}.pdf"'
        return response

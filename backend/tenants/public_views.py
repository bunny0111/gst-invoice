"""Endpoints served on the PUBLIC domain (localhost / app.techcognixium.com)."""
import json
import logging
from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django_tenants.utils import schema_context
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from common.api import CsrfProtectedMixin

from . import razorpay_service as rz
from .models import Business, Domain
from .plans import PLANS
from .services import (activate_plan, make_slug, record_payment, schema_name_for, slug_problem,
                       tenant_base_url)

log = logging.getLogger(__name__)
User = get_user_model()


class RegisterSerializer(serializers.Serializer):
    business_name = serializers.CharField(max_length=200)
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_business_name(self, value):
        value = value.strip()
        problem = slug_problem(make_slug(value))
        if problem:
            raise serializers.ValidationError(problem)
        return value

    def validate_password(self, value):
        try:  # PRD US-01 AC8 - minimum 8 characters
            validate_password(value)
        except DjangoValidationError:
            raise serializers.ValidationError("Password must be at least 8 characters.")
        return value


class RegisterView(CsrfProtectedMixin, APIView):
    """PRD US-01 - create the tenant, its schema, its subdomain and the owner account."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        ser = RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        name = ser.validated_data["business_name"]
        email = ser.validated_data["email"].lower()
        password = ser.validated_data["password"]

        slug = make_slug(name)
        domain = f"{slug}.{settings.TENANT_BASE_DOMAIN}"
        business = Business(schema_name=schema_name_for(slug), name=name, slug=slug, plan="free")
        try:
            business.save()  # INSERT + CREATE SCHEMA + run tenant migrations (AC3)
        except IntegrityError:
            return Response({"business_name": ["Business name already taken"]}, status=status.HTTP_400_BAD_REQUEST)

        try:
            Domain.objects.create(domain=domain, tenant=business, is_primary=True)  # AC4
            with schema_context(business.schema_name):
                from accounts.models import BusinessProfile

                user = User.objects.create_user(username=email, email=email, password=password, is_staff=True)  # AC5
                BusinessProfile.objects.create(user=user, business_name=name, email=email)
        except Exception:
            log.exception("Registration failed for %s - rolling back tenant", slug)
            business.delete(force_drop=True)
            raise

        return Response(
            {
                "business": {"name": name, "slug": slug},
                "subdomain_url": tenant_base_url(request, slug),  # AC7
                "login_url": f"{tenant_base_url(request, slug)}/login",
                "email": email,
            },
            status=status.HTTP_201_CREATED,
        )


class CheckNameView(APIView):
    """Live availability check used by the registration form."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "lookup"

    def get(self, request):
        name = request.query_params.get("name", "").strip()
        slug = make_slug(name)
        if not name:
            return Response({"slug": "", "available": False, "reason": None})
        problem = slug_problem(slug)
        return Response({
            "slug": slug,
            "available": problem is None,
            "reason": problem,
            "subdomain": f"{slug}.{settings.TENANT_BASE_DOMAIN}" if slug else "",
        })


class FindBusinessView(APIView):
    """'Where do I log in?' - resolve a business name / subdomain to its login URL."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "lookup"

    def get(self, request):
        q = request.query_params.get("q", "").strip().lower()
        if q.endswith(settings.TENANT_BASE_DOMAIN):
            q = q[: -len(settings.TENANT_BASE_DOMAIN)].rstrip(".")
        slug = make_slug(q.split(".")[0]) if q else ""
        business = Business.objects.filter(slug=slug, is_active=True).exclude(schema_name="public").first() if slug else None
        if not business:
            return Response({"found": False})
        return Response({"found": True, "name": business.name, "login_url": f"{tenant_base_url(request, business.slug)}/login"})


def _plan_from_subscription(sub: dict) -> str | None:
    plan_id = sub.get("plan_id")
    for key, pid in settings.RAZORPAY_PLAN_IDS.items():
        if pid and pid == plan_id:
            return key
    return (sub.get("notes") or {}).get("plan")


def _period_end(sub: dict):
    ts = sub.get("current_end")
    return datetime.fromtimestamp(ts, tz=dt_timezone.utc).date() if ts else None


@method_decorator(csrf_exempt, name="dispatch")
class RazorpayWebhookView(APIView):
    """Razorpay -> us. Keeps plans in sync with renewals, cancellations and failed charges."""

    authentication_classes: list = []
    permission_classes = [AllowAny]

    def post(self, request):
        body = request.body
        if not rz.verify_webhook_signature(body, request.headers.get("X-Razorpay-Signature", "")):
            return HttpResponse(status=400)
        try:
            payload = json.loads(body)
        except ValueError:
            return HttpResponse(status=400)

        event = payload.get("event", "")
        entities = payload.get("payload", {})
        sub = (entities.get("subscription") or {}).get("entity") or {}
        payment = (entities.get("payment") or {}).get("entity") or {}
        business = Business.objects.filter(razorpay_subscription_id=sub.get("id", "")).first() if sub.get("id") else None
        if not business:
            return HttpResponse(status=200)  # unknown / superseded subscription - nothing to do

        if event in ("subscription.activated", "subscription.charged"):
            plan_key = _plan_from_subscription(sub) or business.plan
            if plan_key in PLANS and plan_key != "free":
                activate_plan(business, plan_key, sub["id"], _period_end(sub))
                if payment.get("id"):
                    record_payment(business, plan_key, payment["id"], sub["id"],
                                   (payment.get("amount") or PLANS[plan_key]["price"] * 100) / 100, _period_end(sub))
        elif event in ("subscription.cancelled", "subscription.completed", "subscription.halted"):
            business.plan, business.plan_expires_on = "free", None
            business.razorpay_subscription_id, business.cancel_at_period_end = "", False
            business.save(update_fields=["plan", "plan_expires_on", "razorpay_subscription_id", "cancel_at_period_end"])
        log.info("Razorpay webhook %s handled for %s", event, business.schema_name)
        return HttpResponse(status=200)

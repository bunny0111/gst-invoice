from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.mail import EmailMessage
from django.db.models import Count, DecimalField, ExpressionWrapper, F, Max, Q, Sum
from django.db.models.functions import Lower, TruncMonth
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from accounts.views import get_profile
from common.api import ApiError

from . import services, sharing
from .models import Customer, Invoice, Payment, Product
from .pdf import render_invoice_pdf, render_receipt_pdf
from .serializers import (CustomerSerializer, InvoiceDetailSerializer, InvoiceListSerializer,
                          InvoiceWriteSerializer, PaymentRecordSerializer, PaymentWriteSerializer, ProductSerializer)
from .usage import enforce_limit


# --------------------------------------------------------------------------- shared soft-delete viewset
class SoftDeleteViewSet(viewsets.ModelViewSet):
    """Customers & products are only ever soft-deleted (US-03 AC4 / US-04 AC3)."""

    resource = ""  # plan-limit key
    search_fields: tuple = ()
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        state = self.request.query_params.get("status", "active")
        if self.action == "restore":
            return qs
        if state == "active":
            qs = qs.filter(is_active=True)
        elif state == "inactive":
            qs = qs.filter(is_active=False)
        q = self.request.query_params.get("q", "").strip()
        if q:
            cond = Q()
            for field in self.search_fields:  # case-insensitive (US-03 AC3, US-04 AC6)
                cond |= Q(**{f"{field}__icontains": q})
            qs = qs.filter(cond)
        return qs

    def perform_create(self, serializer):
        enforce_limit(self.request, self.resource)  # BEFORE creating (PRD section 6)
        serializer.save()

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        obj = self.get_object()
        if not obj.is_active:
            enforce_limit(request, self.resource)  # re-activating uses a slot again
            obj.is_active = True
            obj.save(update_fields=["is_active", "updated_at"])
        return Response(self.get_serializer(obj).data)


class CustomerViewSet(SoftDeleteViewSet):
    serializer_class = CustomerSerializer
    queryset = Customer.objects.annotate(invoice_count=Count("invoices")).order_by(Lower("name"))
    resource = "customers"
    search_fields = ("name", "gstin", "phone")


class ProductViewSet(SoftDeleteViewSet):
    serializer_class = ProductSerializer
    queryset = Product.objects.order_by(Lower("name"))
    resource = "products"
    search_fields = ("name", "hsn_sac_code")

    def get_queryset(self):
        qs = super().get_queryset()
        item_type = self.request.query_params.get("item_type")
        return qs.filter(item_type=item_type) if item_type in ("goods", "service") else qs


# --------------------------------------------------------------------------- invoices
FILTERS = {
    "paid": Q(status="paid"),
    "draft": Q(status="draft"),
    "sent": Q(status="sent"),
    "partial": Q(status="partial"),
    "cancelled": Q(status="cancelled"),
}


def status_q(value: str) -> Q | None:
    """List filters from US-07 AC5. 'pending' = money still expected and not yet late."""
    today = timezone.localdate()
    if value == "pending":
        return Q(status__in=["sent", "partial"], due_date__gte=today)
    if value == "overdue":
        return Q(status__in=["sent", "partial"], due_date__lt=today)
    return FILTERS.get(value)


class InvoiceViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]
    throttle_scope = None  # per-action override: the share / send-email actions use the "share" scope

    def get_queryset(self):
        qs = Invoice.objects.select_related("customer")
        if self.action in ("retrieve", "pdf", "payments", "finalize", "cancel"):
            return qs.prefetch_related("items", "payments")
        p = self.request.query_params
        cond = status_q(p.get("status", ""))
        if cond is not None:
            qs = qs.filter(cond)
        if p.get("customer"):
            qs = qs.filter(customer_id=p["customer"])
        if p.get("q", "").strip():
            q = p["q"].strip()
            qs = qs.filter(Q(invoice_number__icontains=q) | Q(customer__name__icontains=q))
        if p.get("date_from"):
            qs = qs.filter(invoice_date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(invoice_date__lte=p["date_to"])
        return qs

    def get_serializer_class(self):
        return InvoiceListSerializer if self.action == "list" else InvoiceDetailSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["profile"] = get_profile(self.request.user)
        return ctx

    def _detail(self, invoice):
        invoice = self.get_queryset_for_detail().get(pk=invoice.pk)
        return Response(InvoiceDetailSerializer(invoice, context=self.get_serializer_context()).data)

    def get_queryset_for_detail(self):
        return Invoice.objects.select_related("customer").prefetch_related("items", "payments")

    # --- create / update (drafts only)
    def create(self, request, *args, **kwargs):
        profile = get_profile(request.user)
        if not profile.is_complete:  # US-02 AC8
            raise ApiError("Complete your profile to generate invoices.", "profile_incomplete", 403)
        enforce_limit(request, "invoices_per_month")  # US-05 AC9 - drafts count too
        ser = InvoiceWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        invoice = services.create_invoice(ser.validated_data, request.user, profile)
        resp = self._detail(invoice)
        resp.status_code = status.HTTP_201_CREATED
        return resp

    def update(self, request, *args, **kwargs):
        invoice = self.get_object()
        ser = InvoiceWriteSerializer(data=request.data, partial=kwargs.get("partial", False))
        ser.is_valid(raise_exception=True)
        invoice = services.update_invoice(invoice, ser.validated_data, get_profile(request.user))
        return self._detail(invoice)

    def destroy(self, request, *args, **kwargs):
        invoice = self.get_object()
        if invoice.status != Invoice.DRAFT:
            raise ApiError("Only drafts can be deleted. Cancel a finalized invoice instead.", "not_draft", 409)
        invoice.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    # --- workflow actions
    @action(detail=True, methods=["post"])
    def finalize(self, request, pk=None):
        invoice = self.get_object()
        return self._detail(services.finalize_invoice(invoice.pk, get_profile(request.user)))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        invoice = self.get_object()
        return self._detail(services.cancel_invoice(invoice.pk))

    @action(detail=True, methods=["post"])
    def payments(self, request, pk=None):
        invoice = self.get_object()
        ser = PaymentWriteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        d = ser.validated_data
        invoice = services.add_payment(invoice.pk, d["amount"], d["payment_date"], d["mode"],
                                       d.get("reference", ""), d.get("notes", ""))
        return self._detail(invoice)

    @action(detail=True, methods=["delete"], url_path=r"payments/(?P<payment_id>\d+)")
    def delete_payment(self, request, pk=None, payment_id=None):
        invoice = self.get_object()
        return self._detail(services.delete_payment(invoice.pk, int(payment_id)))

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        invoice = self.get_object()
        if invoice.status == Invoice.DRAFT:  # US-05 AC8: PDF becomes available on finalize
            raise ApiError("Finalize the invoice to download its PDF.", "is_draft", 409)
        pdf = render_invoice_pdf(invoice, get_profile(request.user))
        response = HttpResponse(pdf, content_type="application/pdf")
        disposition = "inline" if request.query_params.get("inline") else "attachment"
        response["Content-Disposition"] = f'{disposition}; filename="{invoice.pdf_filename}"'
        return response

    # --- sharing with the customer (WhatsApp / email) ------------------------------------------------
    def _shareable(self, invoice):
        if invoice.status == Invoice.DRAFT:
            raise ApiError("Finalize the invoice before sending it to the customer.", "is_draft", 409)
        if invoice.status == Invoice.CANCELLED:
            raise ApiError("A cancelled invoice can't be sent.", "is_cancelled", 409)

    def _business_name(self, invoice, profile):
        return (invoice.business_snapshot or {}).get("business_name") or profile.business_name

    @action(detail=True, methods=["post"], throttle_classes=[ScopedRateThrottle], throttle_scope="share")
    def share(self, request, pk=None):
        """Everything the browser needs to open WhatsApp: a wa.me link addressed to the customer's phone,
        carrying a ready message + a signed link to the invoice PDF."""
        invoice = self.get_object()
        self._shareable(invoice)
        phone = (invoice.customer.phone or "").strip()
        if not phone:
            raise ApiError("This customer has no phone number. Add one on the Customers page first.", "no_phone", 400)
        profile = get_profile(request.user)
        link = sharing.share_url(request, invoice.pk)
        message = sharing.invoice_message(invoice, self._business_name(invoice, profile), link)
        return Response({"url": link, "message": message, "phone": phone, "customer_name": invoice.customer.name,
                         "whatsapp_url": sharing.whatsapp_url(phone, message)})

    @action(detail=True, methods=["post"], url_path="send-email", throttle_classes=[ScopedRateThrottle],
            throttle_scope="share")
    def send_email(self, request, pk=None):
        """Emails the invoice (PDF attached) to the customer's email address."""
        invoice = self.get_object()
        self._shareable(invoice)
        to = (invoice.customer.email or "").strip()
        if not to:
            raise ApiError("This customer has no email address. Add one on the Customers page first.", "no_email", 400)
        profile = get_profile(request.user)
        business = self._business_name(invoice, profile)
        body = sharing.invoice_message(invoice, business, sharing.share_url(request, invoice.pk))
        mail = EmailMessage(
            subject=f"Invoice {invoice.invoice_number} from {business}",
            body=body, from_email=settings.DEFAULT_FROM_EMAIL, to=[to],
            reply_to=[profile.email] if profile.email else None,
        )
        mail.attach(invoice.pdf_filename, render_invoice_pdf(invoice, profile), "application/pdf")
        try:
            mail.send(fail_silently=False)
        except Exception:  # SMTP down, bad credentials, rejected recipient ...
            raise ApiError("The email couldn't be sent right now. Please try again in a moment.", "email_failed", 502)
        return Response({"sent_to": to, "detail": f"Invoice emailed to {to}."})

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Tab counts for the invoice list: All / Paid / Pending / Overdue / Draft."""
        today = timezone.localdate()
        agg = Invoice.objects.aggregate(
            all=Count("id"),
            paid=Count("id", filter=Q(status="paid")),
            draft=Count("id", filter=Q(status="draft")),
            cancelled=Count("id", filter=Q(status="cancelled")),
            pending=Count("id", filter=Q(status__in=["sent", "partial"], due_date__gte=today)),
            overdue=Count("id", filter=Q(status__in=["sent", "partial"], due_date__lt=today)),
        )
        return Response(agg)


# --------------------------------------------------------------------------- dashboard
def _month_start(d: date) -> date:
    return d.replace(day=1)


def _add_months(d: date, n: int) -> date:
    month = d.month - 1 + n
    return date(d.year + month // 12, month % 12 + 1, 1)


class DashboardView(APIView):
    """PRD US-08. Everything is computed inside the tenant's own schema, so it can't leak across tenants."""

    def get(self, request):
        today = timezone.localdate()
        this_start = _month_start(today)
        next_start = _add_months(this_start, 1)
        last_start = _add_months(this_start, -1)

        billable = Invoice.objects.exclude(status__in=[Invoice.DRAFT, Invoice.CANCELLED])
        zero = Decimal("0.00")

        def revenue(start, end):
            return billable.filter(invoice_date__gte=start, invoice_date__lt=end).aggregate(t=Sum("grand_total"))["t"] or zero

        this_rev, last_rev = revenue(this_start, next_start), revenue(last_start, this_start)
        change = None if not last_rev else round(float((this_rev - last_rev) / last_rev * 100), 1)

        open_q = Q(status__in=["sent", "partial"])
        counts = billable.aggregate(
            total=Count("id"),
            paid=Count("id", filter=Q(status="paid")),
            pending=Count("id", filter=open_q & Q(due_date__gte=today)),
            overdue=Count("id", filter=open_q & Q(due_date__lt=today)),
        )
        outstanding = billable.filter(open_q).aggregate(
            t=Sum(ExpressionWrapper(F("grand_total") - F("amount_paid"),
                                    output_field=DecimalField(max_digits=14, decimal_places=2))))["t"] or zero
        overdue_amount = billable.filter(open_q, due_date__lt=today).aggregate(
            t=Sum(ExpressionWrapper(F("grand_total") - F("amount_paid"),
                                    output_field=DecimalField(max_digits=14, decimal_places=2))))["t"] or zero

        from .models import Payment
        collected = Payment.objects.filter(payment_date__gte=this_start, payment_date__lt=next_start) \
            .exclude(invoice__status=Invoice.CANCELLED).aggregate(t=Sum("amount"))["t"] or zero

        recent = Invoice.objects.select_related("customer").order_by("-created_at")[:10]  # AC4
        top = (billable.filter(invoice_date__gte=this_start, invoice_date__lt=next_start)  # AC5
               .values("customer_id", "customer__name")
               .annotate(revenue=Sum("grand_total"), invoices=Count("id")).order_by("-revenue")[:5])

        first_trend = _add_months(this_start, -5)
        by_month = {
            row["m"]: row["t"]
            for row in billable.filter(invoice_date__gte=first_trend, invoice_date__lt=next_start)
            .annotate(m=TruncMonth("invoice_date")).values("m").annotate(t=Sum("grand_total")).values("m", "t")
        }
        trend = []
        for i in range(6):
            m = _add_months(first_trend, i)
            trend.append({"month": m.strftime("%b"), "year": m.year, "revenue": by_month.get(m, zero)})

        return Response({
            "revenue": {"this_month": this_rev, "last_month": last_rev, "change_percent": change,
                        "collected_this_month": collected},
            "counts": {**counts, "draft": Invoice.objects.filter(status=Invoice.DRAFT).count()},
            "outstanding": outstanding,
            "overdue_amount": overdue_amount,
            "recent_invoices": InvoiceListSerializer(recent, many=True).data,
            "top_customers": [
                {"customer_id": r["customer_id"], "name": r["customer__name"], "revenue": r["revenue"], "invoices": r["invoices"]}
                for r in top
            ],
            "trend": trend,
            "month_label": this_start.strftime("%B %Y"),
        })


# --------------------------------------------------------------------------- payment details
class PaymentViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.UpdateModelMixin,
                     mixins.DestroyModelMixin, viewsets.GenericViewSet):
    """The Payment details section: every recorded payment, with view / edit / delete / receipt."""

    serializer_class = PaymentRecordSerializer
    http_method_names = ["get", "patch", "put", "delete", "head", "options"]

    def get_queryset(self):
        qs = Payment.objects.select_related("invoice", "invoice__customer").order_by("-payment_date", "-id")
        p = self.request.query_params
        if p.get("q", "").strip():
            q = p["q"].strip()
            cond = (Q(invoice__invoice_number__icontains=q) | Q(invoice__customer__name__icontains=q)
                    | Q(reference__icontains=q))
            if q.upper().startswith("PR-") and q[3:].isdigit():  # a receipt number
                cond |= Q(pk=int(q[3:]))
            qs = qs.filter(cond)
        if p.get("mode"):
            qs = qs.filter(mode=p["mode"])
        if p.get("invoice"):
            qs = qs.filter(invoice_id=p["invoice"])
        if p.get("date_from"):
            qs = qs.filter(payment_date__gte=p["date_from"])
        if p.get("date_to"):
            qs = qs.filter(payment_date__lte=p["date_to"])
        return qs

    def update(self, request, *args, **kwargs):
        payment = self.get_object()
        ser = PaymentWriteSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        services.update_payment(payment.pk, ser.validated_data)
        payment = self.get_queryset().get(pk=payment.pk)
        return Response(self.get_serializer(payment).data)

    def destroy(self, request, *args, **kwargs):
        payment = self.get_object()
        services.delete_payment(payment.invoice_id, payment.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Totals for the current filters (shown above the table)."""
        qs = self.get_queryset()
        month_start = timezone.localdate().replace(day=1)
        total = qs.aggregate(t=Sum("amount"), n=Count("id"))
        month = qs.filter(payment_date__gte=month_start).aggregate(t=Sum("amount"))["t"]
        return Response({"count": total["n"] or 0, "total": total["t"] or Decimal("0.00"),
                         "this_month": month or Decimal("0.00")})

    @action(detail=True, methods=["get"])
    def receipt(self, request, pk=None):
        payment = self.get_object()
        pdf = render_receipt_pdf(payment, get_profile(request.user))
        response = HttpResponse(pdf, content_type="application/pdf")
        disposition = "inline" if request.query_params.get("inline") else "attachment"
        response["Content-Disposition"] = f'{disposition}; filename="{payment.receipt_number}.pdf"'
        return response


# --------------------------------------------------------------------------- public signed invoice link
def shared_invoice_pdf(request, token: str):
    """What the customer opens from the WhatsApp message / email: the invoice PDF, no login. Valid only for a
    signed token issued by THIS business, only for an issued (non-draft) invoice, and only while unexpired."""
    tenant = request.tenant
    invoice_id = sharing.read_share_token(token, tenant.schema_name)
    if invoice_id is None or not tenant.is_active:
        raise Http404
    invoice = Invoice.objects.select_related("customer").exclude(status=Invoice.DRAFT).filter(pk=invoice_id).first()
    if invoice is None:
        raise Http404
    from accounts.models import BusinessProfile

    pdf = render_invoice_pdf(invoice, BusinessProfile.objects.first())
    response = HttpResponse(pdf, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{invoice.pdf_filename}"'
    response["Cache-Control"] = "private, no-store"
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response

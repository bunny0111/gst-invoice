from decimal import Decimal

from django.conf import settings
from django.db import models
from django.db.models import Case, CharField, F, Q, Value, When
from django.utils import timezone

from common.gst import GST_RATE_CHOICES, PAYMENT_MODES, STATE_CHOICES, UNITS


class Customer(models.Model):
    """billing_customer (PRD 5.2). Never hard-deleted while invoices exist (PROTECT on Invoice)."""

    name = models.CharField(max_length=200)
    gstin = models.CharField("GSTIN", max_length=15, blank=True, help_text="Filled = B2B, empty = B2C")
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=15, blank=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    pincode = models.CharField(max_length=6, blank=True)
    state = models.CharField(max_length=2, choices=STATE_CHOICES, help_text="Determines CGST/SGST vs IGST")
    is_active = models.BooleanField(default=True, help_text="Soft delete")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["is_active", "name"])]

    def __str__(self) -> str:
        return self.name

    @property
    def is_b2b(self) -> bool:
        return bool(self.gstin)


class Product(models.Model):
    """Product / service catalogue (US-04). Invoice lines COPY these values - never reference them."""

    GOODS, SERVICE = "goods", "service"
    ITEM_TYPES = [(GOODS, "Goods"), (SERVICE, "Service")]

    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    item_type = models.CharField(max_length=10, choices=ITEM_TYPES, default=GOODS)
    hsn_sac_code = models.CharField("HSN/SAC", max_length=10, blank=True)
    unit = models.CharField(max_length=10, choices=UNITS, default="pcs")
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2, choices=GST_RATE_CHOICES, default=Decimal("18"))
    is_active = models.BooleanField(default=True, help_text="Soft delete")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [models.Index(fields=["is_active", "name"])]

    def __str__(self) -> str:
        return self.name


class InvoiceSequence(models.Model):
    """Gapless per-financial-year counter. Row-locked while an invoice number is allocated."""

    financial_year = models.CharField(max_length=7, unique=True)  # "2026-27"
    last_number = models.PositiveIntegerField(default=0)


class InvoiceQuerySet(models.QuerySet):
    def with_status(self):
        """Annotate `eff_status`: sent/partial invoices past their due date read as 'overdue' (US-07 AC4)."""
        today = timezone.localdate()
        return self.annotate(
            eff_status=Case(
                When(Q(status__in=["sent", "partial"]) & Q(due_date__lt=today), then=Value("overdue")),
                default=F("status"),
                output_field=CharField(),
            )
        )


class Invoice(models.Model):
    DRAFT, SENT, PARTIAL, PAID, CANCELLED = "draft", "sent", "partial", "paid", "cancelled"
    STATUS_CHOICES = [
        (DRAFT, "Draft"), (SENT, "Sent"), (PARTIAL, "Partially Paid"), (PAID, "Paid"), (CANCELLED, "Cancelled"),
    ]
    INTRA, INTER, EXPORT = "intrastate", "interstate", "export"
    SUPPLY_CHOICES = [(INTRA, "Intra-state (CGST + SGST)"), (INTER, "Inter-state (IGST)"), (EXPORT, "Export / SEZ (zero-rated)")]

    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="invoices")
    # Allocated when the invoice is FINALIZED so the GST series has no gaps from deleted drafts.
    invoice_number = models.CharField(max_length=50, unique=True, null=True, blank=True)
    financial_year = models.CharField(max_length=7, blank=True)
    invoice_date = models.DateField()
    due_date = models.DateField()
    supply_type = models.CharField(max_length=15, choices=SUPPLY_CHOICES)
    place_of_supply = models.CharField(max_length=2, choices=STATE_CHOICES)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default=DRAFT)
    notes = models.TextField(blank=True)
    terms = models.TextField(blank=True)

    # Stored for performance (PRD 7.3) - always produced by billing.calc, never typed in.
    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    taxable_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cgst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    igst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    round_off = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    # Frozen at finalize so later profile / customer edits can never change an issued invoice.
    business_snapshot = models.JSONField(null=True, blank=True)
    customer_snapshot = models.JSONField(null=True, blank=True)

    finalized_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = InvoiceQuerySet.as_manager()

    class Meta:
        ordering = ["-invoice_date", "-id"]
        indexes = [
            models.Index(fields=["status", "due_date"]),
            models.Index(fields=["invoice_date"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self) -> str:
        return self.invoice_number or f"Draft #{self.pk}"

    @property
    def balance_due(self) -> Decimal:
        return self.grand_total - self.amount_paid

    @property
    def display_status(self) -> str:
        if self.status in (self.SENT, self.PARTIAL) and self.due_date < timezone.localdate():
            return "overdue"
        return self.status

    @property
    def pdf_filename(self) -> str:
        return f"{(self.invoice_number or f'draft-{self.pk}').replace('/', '-')}.pdf"


class InvoiceLineItem(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="items")
    position = models.PositiveSmallIntegerField(default=0)

    # COPIED from the catalogue (or typed manually) - never a foreign key (US-04 AC5).
    item_name = models.CharField(max_length=200)
    description = models.CharField(max_length=300, blank=True)
    hsn_sac_code = models.CharField(max_length=10, blank=True)
    unit = models.CharField(max_length=10, default="pcs")
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2)

    quantity = models.DecimalField(max_digits=10, decimal_places=3, help_text="Supports fractional quantities")
    discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    # CALCULATED (billing.calc.calculate_line) and stored, not recomputed on every load.
    gross_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    taxable_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cgst_rate = models.DecimalField(max_digits=5, decimal_places=3, default=0)
    cgst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst_rate = models.DecimalField(max_digits=5, decimal_places=3, default=0)
    sgst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    igst_rate = models.DecimalField(max_digits=5, decimal_places=3, default=0)
    igst_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        ordering = ["position", "id"]


class Payment(models.Model):
    """One row per payment received - keeps the date/mode history of partial payments."""

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    mode = models.CharField(max_length=20, choices=PAYMENT_MODES)
    reference = models.CharField(max_length=100, blank=True, help_text="UPI ref / cheque no. / txn id")
    notes = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-payment_date", "-id"]

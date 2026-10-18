import re
from decimal import Decimal

from rest_framework import serializers

from common.gst import GST_RATES, LEGACY_GST_RATES, GST_RATE_CUTOVER, PAYMENT_MODES, rate_label, rates_allowed_on, STATE_CHOICES, STATE_NAMES, UNIT_CODES, is_valid_gstin
from common.words import amount_in_words

from .models import Customer, Invoice, InvoiceLineItem, Payment, Product
from .services import business_snapshot, customer_snapshot

_PHONE = re.compile(r"^\+?[0-9][0-9 \-]{6,14}$")


# --------------------------------------------------------------------------- customers
class CustomerSerializer(serializers.ModelSerializer):
    """Customer rules: phone mandatory for everyone, email optional for everyone, GSTIN mandatory for
    B2B customers and optional for B2C."""

    state = serializers.ChoiceField(choices=STATE_CHOICES)
    state_name = serializers.SerializerMethodField()
    invoice_count = serializers.IntegerField(read_only=True, default=0)
    customer_type = serializers.ChoiceField(choices=Customer.TYPE_CHOICES, required=False)
    phone = serializers.CharField(
        max_length=15, error_messages={"required": "Phone number is required.", "blank": "Phone number is required.",
                                        "null": "Phone number is required."})

    class Meta:
        model = Customer
        fields = ["id", "name", "customer_type", "gstin", "email", "phone", "address", "city", "pincode", "state",
                  "state_name", "is_active", "invoice_count", "created_at"]
        read_only_fields = ["is_active", "created_at"]

    def get_state_name(self, obj):
        return STATE_NAMES.get(obj.state, "")

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Customer name is required.")
        return value

    def validate_gstin(self, value):  # US-03 AC7: auto-uppercased
        value = value.strip().upper()
        if value and not is_valid_gstin(value):
            raise serializers.ValidationError("GST number must be exactly 15 letters/digits.")
        return value

    def validate_pincode(self, value):
        if value and not re.fullmatch(r"\d{6}", value.strip()):
            raise serializers.ValidationError("Pincode must be 6 digits.")
        return value.strip()

    def validate_phone(self, value):
        value = value.strip()
        if not _PHONE.match(value):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value

    def validate(self, attrs):
        existing = self.instance
        gstin = attrs["gstin"] if "gstin" in attrs else (existing.gstin if existing else "")
        ctype = attrs.get("customer_type") or (existing.customer_type if existing else None)
        if ctype is None:  # API clients that don't send a type: a GSTIN means B2B (the old rule)
            ctype = Customer.B2B if gstin else Customer.B2C
        attrs["customer_type"] = ctype
        if ctype == Customer.B2B and not gstin:
            raise serializers.ValidationError({"gstin": ["GST number is required for B2B customers."]})
        return attrs


# --------------------------------------------------------------------------- products
def validate_gst_rate(value):
    # field-level: any slab that has ever been valid. Whether a legacy slab (12% / 28%) is allowed is date-dependent
    # and decided where the date is known (invoice date for line items, "already on the product" for products).
    if Decimal(value) not in GST_RATES + LEGACY_GST_RATES:  # US-04 AC2
        raise serializers.ValidationError("GST rate must be one of " + ", ".join(rate_label(r) for r in GST_RATES) + ".")
    return value


def _legacy_rate_message(rate) -> str:
    return (f"The {rate_label(rate)} slab was removed on {GST_RATE_CUTOVER:%d %b %Y}. Use one of "
            + ", ".join(rate_label(r) for r in GST_RATES) + ".")


class ProductSerializer(serializers.ModelSerializer):
    unit = serializers.ChoiceField(choices=[(u, u) for u in UNIT_CODES])
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, validators=[validate_gst_rate])
    selling_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))

    class Meta:
        model = Product
        fields = ["id", "name", "description", "item_type", "hsn_sac_code", "unit", "selling_price", "gst_rate",
                  "is_active", "created_at"]
        read_only_fields = ["is_active", "created_at"]

    def validate_gst_rate(self, value):
        # a product saved before the 2025 slab change may keep its old rate until someone edits that field
        if Decimal(value) in LEGACY_GST_RATES and not (self.instance and Decimal(self.instance.gst_rate) == Decimal(value)):
            raise serializers.ValidationError(_legacy_rate_message(value))
        return value

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Product name is required.")
        return value

    def validate_hsn_sac_code(self, value):
        value = value.strip()
        if value and not re.fullmatch(r"\d{2,8}", value):
            raise serializers.ValidationError("HSN/SAC must be 2-8 digits.")
        return value


# --------------------------------------------------------------------------- invoices (write)
class LineItemWriteSerializer(serializers.Serializer):
    item_name = serializers.CharField(max_length=200)
    description = serializers.CharField(max_length=300, allow_blank=True, required=False, default="")
    hsn_sac_code = serializers.CharField(max_length=10, allow_blank=True, required=False, default="")
    unit = serializers.ChoiceField(choices=[(u, u) for u in UNIT_CODES], default="pcs")
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2, min_value=Decimal("0"),
                                                max_value=Decimal("100"), default=Decimal("0"))
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, validators=[validate_gst_rate])

    def validate_item_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Item name is required.")
        return value


class InvoiceWriteSerializer(serializers.Serializer):
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.filter(is_active=True))
    invoice_date = serializers.DateField()
    due_date = serializers.DateField(required=False)
    supply_type = serializers.ChoiceField(choices=["auto", "export"], default="auto")
    notes = serializers.CharField(allow_blank=True, required=False)
    terms = serializers.CharField(allow_blank=True, required=False)
    items = LineItemWriteSerializer(many=True, allow_empty=False, max_length=100)

    def validate(self, attrs):
        invoice_date = attrs.get("invoice_date")
        due_date = attrs.get("due_date")
        if invoice_date and due_date and due_date < invoice_date:
            raise serializers.ValidationError({"due_date": ["Due date can't be before the invoice date."]})
        if invoice_date:
            allowed = rates_allowed_on(invoice_date)
            for idx, item in enumerate(attrs.get("items", [])):
                if Decimal(item["gst_rate"]) not in allowed:
                    raise serializers.ValidationError({"items": {idx: {"gst_rate": [_legacy_rate_message(item["gst_rate"])]}}})
        return attrs


# --------------------------------------------------------------------------- invoices (read)
class LineItemReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLineItem
        exclude = ["invoice"]


class PaymentSerializer(serializers.ModelSerializer):
    mode_label = serializers.SerializerMethodField()
    receipt_number = serializers.CharField(read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "receipt_number", "amount", "payment_date", "mode", "mode_label", "reference", "notes", "created_at"]

    def get_mode_label(self, obj):
        return dict(PAYMENT_MODES).get(obj.mode, obj.mode)


class PaymentWriteSerializer(serializers.Serializer):
    """Used to record a payment (all of amount/date/mode required) and, with partial=True, to edit one."""

    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    payment_date = serializers.DateField()
    mode = serializers.ChoiceField(choices=PAYMENT_MODES)
    reference = serializers.CharField(max_length=100, allow_blank=True, required=False, default="")
    notes = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


class PaymentRecordSerializer(serializers.ModelSerializer):
    """A payment with the invoice context the Payment details page needs."""

    mode_label = serializers.SerializerMethodField()
    receipt_number = serializers.CharField(read_only=True)
    invoice = serializers.IntegerField(source="invoice_id", read_only=True)
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    invoice_status = serializers.CharField(source="invoice.display_status", read_only=True)
    invoice_total = serializers.DecimalField(source="invoice.grand_total", max_digits=12, decimal_places=2, read_only=True)
    invoice_paid = serializers.DecimalField(source="invoice.amount_paid", max_digits=12, decimal_places=2, read_only=True)
    invoice_balance = serializers.DecimalField(source="invoice.balance_due", max_digits=12, decimal_places=2, read_only=True)
    customer_name = serializers.CharField(source="invoice.customer.name", read_only=True)

    class Meta:
        model = Payment
        fields = ["id", "receipt_number", "amount", "payment_date", "mode", "mode_label", "reference", "notes",
                  "created_at", "invoice", "invoice_number", "invoice_status", "invoice_total", "invoice_paid",
                  "invoice_balance", "customer_name"]

    def get_mode_label(self, obj):
        return dict(PAYMENT_MODES).get(obj.mode, obj.mode)


class InvoiceListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    status = serializers.CharField(source="display_status", read_only=True)  # includes computed 'overdue'
    stored_status = serializers.CharField(source="status", read_only=True)
    balance_due = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = Invoice
        fields = ["id", "invoice_number", "customer", "customer_name", "invoice_date", "due_date", "supply_type",
                  "grand_total", "amount_paid", "balance_due", "status", "stored_status", "created_at"]


class InvoiceDetailSerializer(InvoiceListSerializer):
    items = LineItemReadSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    amount_in_words = serializers.SerializerMethodField()
    bill_from = serializers.SerializerMethodField()
    bill_to = serializers.SerializerMethodField()
    place_of_supply_name = serializers.SerializerMethodField()
    is_editable = serializers.SerializerMethodField()

    class Meta(InvoiceListSerializer.Meta):
        fields = InvoiceListSerializer.Meta.fields + [
            "financial_year", "place_of_supply", "place_of_supply_name", "notes", "terms", "subtotal",
            "discount_total", "taxable_amount", "cgst_amount", "sgst_amount", "igst_amount", "round_off",
            "finalized_at", "cancelled_at", "items", "payments", "amount_in_words", "bill_from", "bill_to",
            "is_editable", "updated_at",
        ]

    def get_amount_in_words(self, obj):
        return amount_in_words(obj.grand_total)

    def get_place_of_supply_name(self, obj):
        return STATE_NAMES.get(obj.place_of_supply, "")

    def get_is_editable(self, obj):
        return obj.status == Invoice.DRAFT

    def get_bill_from(self, obj):
        snap = obj.business_snapshot
        if snap is None:  # draft: show live profile
            snap = business_snapshot(self.context["profile"])
        logo = snap.get("logo")
        return {**snap, "logo_url": f"/media/{logo}" if logo else None}

    def get_bill_to(self, obj):
        return obj.customer_snapshot or customer_snapshot(obj.customer)

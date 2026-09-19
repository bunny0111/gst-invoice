import re
from decimal import Decimal

from rest_framework import serializers

from common.gst import GST_RATES, PAYMENT_MODES, STATE_CHOICES, STATE_NAMES, UNIT_CODES, is_valid_gstin
from common.words import amount_in_words

from .models import Customer, Invoice, InvoiceLineItem, Payment, Product
from .services import business_snapshot, customer_snapshot

_PHONE = re.compile(r"^\+?[0-9][0-9 \-]{6,14}$")


# --------------------------------------------------------------------------- customers
class CustomerSerializer(serializers.ModelSerializer):
    state = serializers.ChoiceField(choices=STATE_CHOICES)
    state_name = serializers.SerializerMethodField()
    invoice_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Customer
        fields = ["id", "name", "gstin", "email", "phone", "address", "city", "pincode", "state", "state_name",
                  "is_active", "invoice_count", "created_at"]
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
            raise serializers.ValidationError("GSTIN must be exactly 15 letters/digits.")
        return value

    def validate_pincode(self, value):
        if value and not re.fullmatch(r"\d{6}", value.strip()):
            raise serializers.ValidationError("Pincode must be 6 digits.")
        return value.strip()

    def validate_phone(self, value):
        if value and not _PHONE.match(value.strip()):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value.strip()


# --------------------------------------------------------------------------- products
def validate_gst_rate(value):
    if Decimal(value) not in GST_RATES:  # US-04 AC2
        raise serializers.ValidationError("GST rate must be one of " + ", ".join(f"{r}%" for r in GST_RATES) + ".")
    return value


class ProductSerializer(serializers.ModelSerializer):
    unit = serializers.ChoiceField(choices=[(u, u) for u in UNIT_CODES])
    gst_rate = serializers.DecimalField(max_digits=5, decimal_places=2, validators=[validate_gst_rate])
    selling_price = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))

    class Meta:
        model = Product
        fields = ["id", "name", "description", "item_type", "hsn_sac_code", "unit", "selling_price", "gst_rate",
                  "is_active", "created_at"]
        read_only_fields = ["is_active", "created_at"]

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
        return attrs


# --------------------------------------------------------------------------- invoices (read)
class LineItemReadSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLineItem
        exclude = ["invoice"]


class PaymentSerializer(serializers.ModelSerializer):
    mode_label = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = ["id", "amount", "payment_date", "mode", "mode_label", "reference", "notes", "created_at"]

    def get_mode_label(self, obj):
        return dict(PAYMENT_MODES).get(obj.mode, obj.mode)


class PaymentWriteSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    payment_date = serializers.DateField()
    mode = serializers.ChoiceField(choices=PAYMENT_MODES)
    reference = serializers.CharField(max_length=100, allow_blank=True, required=False, default="")
    notes = serializers.CharField(max_length=200, allow_blank=True, required=False, default="")


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

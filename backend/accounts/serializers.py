import re

from rest_framework import serializers

from common import crypto
from common.gst import (GST_RATES, STATE_CHOICES, STATE_NAMES, gstin_checksum_ok, gstin_state, is_valid_gstin, is_valid_pan,
                        is_valid_pincode, normalize_phone)

from .models import BusinessProfile

MAX_LOGO_BYTES = 2 * 1024 * 1024  # PRD US-02 AC4
_UPI_ID = re.compile(r"^[A-Za-z0-9._\-]{2,256}@[A-Za-z][A-Za-z0-9.\-]{1,64}$")


class BusinessProfileSerializer(serializers.ModelSerializer):
    state = serializers.ChoiceField(choices=STATE_CHOICES)
    logo_url = serializers.SerializerMethodField()
    # plain text in, so "sharmafurniture.in" reaches validate_website() (which adds https://) instead of failing first
    website = serializers.CharField(max_length=200, required=False, allow_blank=True)
    signature_url = serializers.CharField(read_only=True)
    payment_qr_url = serializers.CharField(read_only=True)
    is_complete = serializers.BooleanField(read_only=True)
    missing_fields = serializers.ListField(read_only=True)
    # The password is write-only: the app only ever learns whether one is saved.
    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=200)
    smtp_password_set = serializers.SerializerMethodField()
    # Not a column: the number the next finalized invoice gets. Writing it moves the running counter forward.
    next_invoice_number = serializers.IntegerField(required=False, min_value=1, max_value=999999)
    next_invoice_preview = serializers.SerializerMethodField()

    class Meta:
        model = BusinessProfile
        fields = [
            "business_name", "gstin", "pan", "state", "address_line1", "address_line2", "city", "pincode",
            "phone", "email", "website", "business_type", "business_nature", "logo_url", "signatory_name", "signature_url",
            "bank_name", "bank_branch", "account_type", "account_holder_name", "account_number", "ifsc_code",
            "upi_id", "payment_qr_url", "payment_instructions",
            "invoice_prefix", "invoice_number_format", "next_invoice_number", "next_invoice_preview",
            "default_gst_rate", "default_payment_terms", "default_notes", "default_terms",
            "smtp_enabled", "smtp_host", "smtp_port", "smtp_security", "smtp_username", "smtp_password",
            "smtp_password_set", "smtp_from_email", "smtp_from_name",
            "is_complete", "missing_fields",
        ]

    def get_logo_url(self, obj):
        return obj.logo_url

    def get_smtp_password_set(self, obj):
        return bool(obj.smtp_password)

    def get_next_invoice_preview(self, obj):
        from billing.numbering import preview_next_number
        return preview_next_number(obj)

    def to_representation(self, obj):
        from billing.numbering import next_sequence_number
        data = super().to_representation(obj)
        data["next_invoice_number"] = next_sequence_number(obj)
        return data

    # --- AC2 / AC3: GSTIN and PAN are auto-uppercased and length checked
    def validate_gstin(self, value):
        value = value.strip().upper()
        if value and not is_valid_gstin(value):
            raise serializers.ValidationError("GSTIN must be exactly 15 letters/digits.")
        if value and not gstin_checksum_ok(value):
            raise serializers.ValidationError("This GSTIN has a typo - its last character (a check digit) doesn't match the rest. Copy it from the GST certificate.")
        if value and not gstin_state(value):
            raise serializers.ValidationError("The first two digits of a GSTIN are its state code (e.g. 07 for Delhi).")
        return value

    def validate_pan(self, value):
        value = value.strip().upper()
        if value and not is_valid_pan(value):
            raise serializers.ValidationError("PAN must be exactly 10 letters/digits.")
        return value

    def validate_pincode(self, value):
        if not is_valid_pincode(value.strip()):
            raise serializers.ValidationError("Pincode must be 6 digits and can't start with 0.")
        return value.strip()

    def validate_phone(self, value):
        phone = normalize_phone(value)
        if not phone:
            raise serializers.ValidationError("Enter a 10-digit phone number.")
        return phone

    def validate_website(self, value):
        value = value.strip()
        if value and not re.match(r"^https?://", value, re.I):
            value = "https://" + value  # people type "sharmafurniture.in"
        if value:
            serializers.URLField().run_validators(value)
        return value

    def validate_upi_id(self, value):
        value = value.strip()
        if value and not _UPI_ID.match(value):
            raise serializers.ValidationError("Enter a UPI ID like yourname@okhdfcbank.")
        return value

    def validate_default_gst_rate(self, value):
        if value not in GST_RATES:
            raise serializers.ValidationError("Choose one of the current GST rates.")
        return value

    def validate_smtp_host(self, value):
        value = value.strip()
        if value and not re.fullmatch(r"[A-Za-z0-9.\-]{3,200}", value):
            raise serializers.ValidationError("Enter a server name like smtp.gmail.com.")
        return value

    def validate_smtp_port(self, value):
        if not 1 <= value <= 65535:
            raise serializers.ValidationError("Enter a port between 1 and 65535 (usually 587 or 465).")
        return value

    def validate_ifsc_code(self, value):
        value = value.strip().upper()
        if value and not re.fullmatch(r"[A-Z0-9]{11}", value):
            raise serializers.ValidationError("IFSC must be exactly 11 characters.")
        return value

    def validate_account_number(self, value):
        value = value.strip()
        if value and not re.fullmatch(r"\d{6,20}", value):
            raise serializers.ValidationError("Account number must be 6-20 digits.")
        return value

    def validate_invoice_prefix(self, value):
        # A GST invoice number may be at most 16 characters - the length per format is checked in validate().
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{1,10}", value):
            raise serializers.ValidationError("Use letters or digits only (e.g. INV, TC, GST).")
        return value

    def validate_next_invoice_number(self, value):
        from billing.numbering import next_sequence_number
        current = next_sequence_number(self.instance)
        if value < current:
            raise serializers.ValidationError(
                f"Numbers below {current} may already be used. The next number can only move forward.")
        return value

    def validate(self, attrs):
        def get(key):
            return attrs[key] if key in attrs else getattr(self.instance, key, None)

        errors = {}
        gstin, state = get("gstin"), get("state")
        if gstin and state and gstin_state(gstin) != state:
            errors["gstin"] = [f"This GSTIN is registered in {STATE_NAMES.get(gstin_state(gstin), 'another state')} "
                               f"(code {gstin[:2]}), but your state is {STATE_NAMES.get(state, state)}."]
        prefix, fmt = get("invoice_prefix") or "INV", get("invoice_number_format") or "fy"
        limit = 4 if fmt == "fy" else 10  # INV/2026-27/001 = prefix + 12 chars; INV-0001 = prefix + 5
        if len(prefix) > limit:
            errors["invoice_prefix"] = [f"Use at most {limit} characters with this numbering format "
                                        "(GST allows 16 characters in an invoice number)."]
        if get("smtp_enabled"):
            for field, label in (("smtp_host", "Server"), ("smtp_from_email", "From email")):
                if not get(field):
                    errors[field] = [f"{label} is required to send from your own email."]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def update(self, instance, validated_data):
        from billing.numbering import set_next_number

        next_number = validated_data.pop("next_invoice_number", None)
        password = validated_data.pop("smtp_password", "")
        if password:  # blank = keep the saved one
            instance.smtp_password = crypto.encrypt(password)
        instance = super().update(instance, validated_data)
        if next_number:
            set_next_number(instance, next_number)
        return instance

    def validate_default_payment_terms(self, value):
        if value > 365:
            raise serializers.ValidationError("Payment terms can be at most 365 days.")
        return value


def validate_logo_file(upload):
    """PNG / JPG only, max 2 MB - verified from the file contents, not the filename (PRD 7.2)."""
    from PIL import Image, UnidentifiedImageError

    if upload.size > MAX_LOGO_BYTES:
        raise serializers.ValidationError("Logo must be 2 MB or smaller.")
    try:
        image = Image.open(upload)
        image.verify()
        fmt = (image.format or "").upper()
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        # Pillow raises SyntaxError for corrupt PNG chunks - treat every decode failure as a 400, never a 500.
        raise serializers.ValidationError("Upload a valid PNG or JPG image.")
    finally:
        upload.seek(0)
    if fmt not in {"PNG", "JPEG"}:
        raise serializers.ValidationError("Only PNG and JPG logos are allowed.")
    return fmt

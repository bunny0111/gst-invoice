import re

from rest_framework import serializers

from common.gst import STATE_CHOICES, is_valid_gstin, is_valid_pan

from .models import BusinessProfile

MAX_LOGO_BYTES = 2 * 1024 * 1024  # PRD US-02 AC4
_PHONE = re.compile(r"^\+?[0-9][0-9 \-]{6,14}$")


class BusinessProfileSerializer(serializers.ModelSerializer):
    state = serializers.ChoiceField(choices=STATE_CHOICES)
    logo_url = serializers.SerializerMethodField()
    is_complete = serializers.BooleanField(read_only=True)
    missing_fields = serializers.ListField(read_only=True)

    class Meta:
        model = BusinessProfile
        fields = [
            "business_name", "gstin", "pan", "state", "address_line1", "address_line2", "city", "pincode",
            "phone", "email", "logo_url", "bank_name", "account_holder_name", "account_number", "ifsc_code",
            "invoice_prefix", "default_payment_terms", "default_notes", "default_terms",
            "is_complete", "missing_fields",
        ]

    def get_logo_url(self, obj):
        return obj.logo_url

    # --- AC2 / AC3: GSTIN and PAN are auto-uppercased and length checked
    def validate_gstin(self, value):
        value = value.strip().upper()
        if value and not is_valid_gstin(value):
            raise serializers.ValidationError("GSTIN must be exactly 15 letters/digits.")
        return value

    def validate_pan(self, value):
        value = value.strip().upper()
        if value and not is_valid_pan(value):
            raise serializers.ValidationError("PAN must be exactly 10 letters/digits.")
        return value

    def validate_pincode(self, value):
        if not re.fullmatch(r"\d{6}", value.strip()):
            raise serializers.ValidationError("Pincode must be 6 digits.")
        return value.strip()

    def validate_phone(self, value):
        if not _PHONE.match(value.strip()):
            raise serializers.ValidationError("Enter a valid phone number.")
        return value.strip()

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
        # A GST invoice number may be at most 16 characters: PREFIX/2026-27/001 -> keep the prefix short.
        value = value.strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{1,4}", value):
            raise serializers.ValidationError("Use 1-4 letters or digits (e.g. INV, TC, GST).")
        return value

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

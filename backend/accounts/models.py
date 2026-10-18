import hashlib
import hmac
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import models
from django.utils import timezone

from common.gst import STATE_CHOICES

User = get_user_model()

REQUIRED_FOR_INVOICES = ["business_name", "state", "address_line1", "city", "pincode", "phone"]


def logo_upload_path(instance, filename: str) -> str:
    """Legacy (logos used to be files on disk). Kept only because migration 0001 refers to it."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "png"
    return f"business_logos/logo-{secrets.token_hex(6)}.{ext}"


class LogoImage(models.Model):
    """A business logo stored in the database. Rows are never edited: a new upload makes a new row, so an invoice
    that was finalized with an earlier logo keeps showing exactly that one."""

    data = models.BinaryField()
    content_type = models.CharField(max_length=20, default="image/png")
    sha256 = models.CharField(max_length=64, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"logo {self.pk} ({len(self.data) // 1024} KB)"


class BusinessProfile(models.Model):
    """Company identity printed on every invoice (PRD 5.2). One user, one profile (US-02 AC7)."""

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    business_name = models.CharField(max_length=200)
    gstin = models.CharField("GSTIN", max_length=15, blank=True)
    pan = models.CharField("PAN", max_length=10, blank=True)
    state = models.CharField(max_length=2, blank=True, choices=STATE_CHOICES, help_text="Drives CGST/SGST vs IGST")
    address_line1 = models.CharField(max_length=200, blank=True)
    address_line2 = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=100, blank=True)
    pincode = models.CharField(max_length=6, blank=True)
    phone = models.CharField(max_length=15, blank=True)
    email = models.EmailField(blank=True)
    logo_image = models.ForeignKey(LogoImage, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")

    bank_name = models.CharField(max_length=100, blank=True)
    account_holder_name = models.CharField(max_length=150, blank=True)
    account_number = models.CharField(max_length=30, blank=True)
    ifsc_code = models.CharField(max_length=11, blank=True)

    invoice_prefix = models.CharField(max_length=10, default="INV", help_text="e.g. TC, INV, GST")
    default_payment_terms = models.PositiveIntegerField(default=30, help_text="Days until due date")
    default_notes = models.TextField(blank=True)
    default_terms = models.TextField(blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.business_name

    @property
    def logo_url(self) -> str | None:
        return f"/api/logo/{self.logo_image_id}/" if self.logo_image_id else None

    @property
    def missing_fields(self) -> list[str]:
        return [f for f in REQUIRED_FOR_INVOICES if not getattr(self, f)]

    @property
    def is_complete(self) -> bool:
        return not self.missing_fields


class PasswordResetOTP(models.Model):
    """Six digit code emailed for password reset (hashed at rest, 10 min expiry, 5 attempts)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_otps")
    code_hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used = models.BooleanField(default=False)

    MAX_ATTEMPTS = 5
    TTL = timedelta(minutes=10)

    @staticmethod
    def _hash(user_id: int, code: str) -> str:
        return hmac.new(settings.SECRET_KEY.encode(), f"{user_id}:{code}".encode(), hashlib.sha256).hexdigest()

    @classmethod
    def issue(cls, user) -> str:
        cls.objects.filter(user=user, used=False).update(used=True)  # only the latest code is valid
        code = f"{secrets.randbelow(1_000_000):06d}"
        cls.objects.create(user=user, code_hash=cls._hash(user.pk, code), expires_at=timezone.now() + cls.TTL)
        return code

    def matches(self, code: str) -> bool:
        return hmac.compare_digest(self.code_hash, self._hash(self.user_id, code))

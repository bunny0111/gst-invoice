from django.db import models
from django.utils import timezone
from django_tenants.models import DomainMixin, TenantMixin

from .plans import PLANS


class Business(TenantMixin):
    """A tenant. One row per registered business; lives in the public schema (PRD 5.1)."""

    PLAN_CHOICES = [(key, plan["name"]) for key, plan in PLANS.items()]

    # schema_name (VARCHAR(63), unique) comes from TenantMixin - PostgreSQL schema, no hyphens.
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=50, unique=True, help_text="URL-safe name -> subdomain")
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="free")
    plan_expires_on = models.DateField(null=True, blank=True, help_text="NULL for the free plan")
    razorpay_subscription_id = models.CharField(max_length=100, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    created_on = models.DateField(auto_now_add=True)
    is_active = models.BooleanField(default=True, help_text="Soft disable")

    auto_create_schema = True  # create + migrate the PostgreSQL schema on first save()
    auto_drop_schema = False  # never drop a customer's data implicitly

    class Meta:
        verbose_name_plural = "businesses"

    def __str__(self) -> str:
        return f"{self.name} ({self.schema_name})"

    @property
    def effective_plan(self) -> str:
        """A paid plan whose period has lapsed behaves as Free until it is renewed."""
        if self.plan != "free" and self.plan_expires_on and self.plan_expires_on < timezone.localdate():
            return "free"
        return self.plan


class Domain(DomainMixin):
    """{slug}.localhost in dev, {slug}.app.techcognixium.com in production (PRD 5.1)."""


class SubscriptionPayment(models.Model):
    """Receipt trail for Razorpay subscription charges (shown on the Subscription page)."""

    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name="payments")
    plan = models.CharField(max_length=20)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=3, default="INR")
    razorpay_payment_id = models.CharField(max_length=100, unique=True)
    razorpay_subscription_id = models.CharField(max_length=100, blank=True)
    status = models.CharField(max_length=20, default="captured")
    is_demo = models.BooleanField(default=False)
    paid_at = models.DateTimeField(default=timezone.now)
    period_end = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-paid_at"]

    @property
    def receipt_number(self) -> str:
        return f"TC-R-{self.pk:06d}"

    def __str__(self) -> str:
        return f"{self.receipt_number} - {self.business.name}"

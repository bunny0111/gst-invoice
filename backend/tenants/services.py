"""Business (tenant) helpers shared by registration, subscription and webhook code."""
import re
from datetime import date, timedelta

from django.conf import settings
from django.utils import timezone
from django.utils.text import slugify

from .models import Business, SubscriptionPayment

# Slugs that can never be a tenant: infrastructure names + the public schema itself.
RESERVED_SLUGS = {
    "public", "www", "admin", "api", "app", "static", "media", "assets", "mail", "smtp", "ftp",
    "support", "help", "docs", "status", "blog", "login", "logout", "register", "signup", "billing",
    "dashboard", "localhost", "techcognixium", "cognixium", "test", "demo", "staging", "root",
}


def make_slug(business_name: str) -> str:
    """PRD US-01 AC2 - slugify(business_name). Capped so `t_<slug>` fits a 63 char schema name."""
    return slugify(business_name)[:50].strip("-")


def schema_name_for(slug: str) -> str:
    # PostgreSQL identifiers must not contain hyphens and should not start with a digit.
    return "t_" + slug.replace("-", "_")


def tenant_base_url(request, slug: str | None = None) -> str:
    """http://sharma.localhost:5173 (dev) / https://sharma.app.techcognixium.com (prod)."""
    scheme = "https" if request.is_secure() else "http"
    host = request.get_host()
    port = host.split(":")[1] if ":" in host else ""
    port = "" if port in ("", "80", "443") else f":{port}"
    prefix = f"{slug}." if slug else ""
    return f"{scheme}://{prefix}{settings.TENANT_BASE_DOMAIN}{port}"


def normalize_plan(business: Business) -> Business:
    """If a paid plan has lapsed, persist the fall-back to Free so every reader agrees."""
    if business.plan != "free" and business.effective_plan == "free":
        business.plan = "free"
        business.plan_expires_on = None
        business.cancel_at_period_end = False
        business.razorpay_subscription_id = ""
        business.save(update_fields=["plan", "plan_expires_on", "cancel_at_period_end", "razorpay_subscription_id"])
    return business


_SLUG_OK = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def slug_problem(slug: str) -> str | None:
    """Why a slug can't be used, or None when it is free."""
    if not slug or not _SLUG_OK.match(slug):
        return "Business name must contain letters or numbers (A-Z, 0-9)."
    if slug in RESERVED_SLUGS:
        return "This name is reserved. Please choose another one."
    if Business.objects.filter(slug=slug).exists():
        return "Business name already taken"  # exact wording from PRD US-01 AC6
    return None


def activate_plan(business: Business, plan_key: str, subscription_id: str, period_end: date | None) -> Business:
    business.plan = plan_key
    business.razorpay_subscription_id = subscription_id
    business.plan_expires_on = period_end or (timezone.localdate() + timedelta(days=30))
    business.cancel_at_period_end = False
    business.save(update_fields=["plan", "razorpay_subscription_id", "plan_expires_on", "cancel_at_period_end"])
    return business


def record_payment(business: Business, plan_key: str, payment_id: str, subscription_id: str,
                   amount, period_end: date | None, is_demo: bool = False) -> tuple[SubscriptionPayment, bool]:
    return SubscriptionPayment.objects.get_or_create(
        razorpay_payment_id=payment_id,
        defaults={
            "business": business, "plan": plan_key, "amount": amount,
            "razorpay_subscription_id": subscription_id, "period_end": period_end, "is_demo": is_demo,
        },
    )

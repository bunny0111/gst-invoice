"""Plan usage + limit enforcement (PRD section 6). Checked BEFORE a record is created."""
from django.utils import timezone

from common.api import PlanLimitExceeded
from tenants.plans import PLANS, plan_limit

from .models import Customer, Invoice, Product

LABELS = {"invoices_per_month": "invoices this month", "customers": "customers", "products": "products/services"}


def get_usage() -> dict:
    """Invoices reset on the 1st of the calendar month; customers/products are cumulative totals.
    Draft invoices DO count toward the monthly limit (PRD section 6)."""
    now = timezone.localtime()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return {
        "invoices_per_month": Invoice.objects.filter(created_at__gte=month_start).count(),
        "customers": Customer.objects.filter(is_active=True).count(),
        "products": Product.objects.filter(is_active=True).count(),
    }


def enforce_limit(request, resource: str) -> None:
    plan = request.tenant.effective_plan
    limit = plan_limit(plan, resource)
    if limit is None:
        return
    used = get_usage()[resource]
    if used >= limit:
        raise PlanLimitExceeded(
            resource=resource, limit=limit, used=used, plan=plan,
            message=f"You've reached the {PLANS[plan]['name']} plan limit of {limit} {LABELS[resource]}. "
                    f"Upgrade to add more.",
        )

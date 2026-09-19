"""Plan catalogue and limits (PRD section 6). Limits are ENFORCED from here, never from the UI."""

UNLIMITED = None

PLANS = {
    "free": {
        "key": "free",
        "name": "Free",
        "price": 0,
        "tagline": "Everything you need to get started",
        "limits": {"invoices_per_month": 10, "customers": 10, "products": 20},
    },
    "starter": {
        "key": "starter",
        "name": "Starter",
        "price": 199,
        "tagline": "For growing shops and freelancers",
        "limits": {"invoices_per_month": 100, "customers": 100, "products": 200},
    },
    "pro": {
        "key": "pro",
        "name": "Pro",
        "price": 499,
        "tagline": "For busy businesses & teams",
        "limits": {"invoices_per_month": UNLIMITED, "customers": UNLIMITED, "products": UNLIMITED},
    },
}
PLAN_KEYS = list(PLANS)
PAID_PLAN_KEYS = ["starter", "pro"]

# Feature comparison (PRD section 6). `soon` marks features that the PRD schedules for Phase 2.
COMPARISON = [
    {"feature": "Invoices per month", "free": "10", "starter": "100", "pro": "Unlimited"},
    {"feature": "Customers (total)", "free": "10", "starter": "100", "pro": "Unlimited"},
    {"feature": "Products / services (total)", "free": "20", "starter": "200", "pro": "Unlimited"},
    {"feature": "PDF invoice download", "free": True, "starter": True, "pro": True},
    {"feature": "Dashboard", "free": "Basic", "starter": "Monthly summary", "pro": "Full + export", "soon": False},
    {"feature": "WhatsApp / Email sharing", "free": False, "starter": True, "pro": True, "soon": True},
    {"feature": "Payment reminders", "free": False, "starter": False, "pro": "Automated", "soon": True},
    {"feature": "GSTR-1 export", "free": False, "starter": False, "pro": True, "soon": True},
    {"feature": "Multi-user (up to 5)", "free": False, "starter": False, "pro": True, "soon": True},
    {"feature": "Support", "free": "Community", "starter": "Email", "pro": "Email + Chat"},
]


def plan_limit(plan_key: str, resource: str):
    return PLANS.get(plan_key, PLANS["free"])["limits"][resource]

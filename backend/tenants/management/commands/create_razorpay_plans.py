"""Create the Starter / Pro monthly plans on Razorpay and print the IDs to paste into .env.

    python manage.py create_razorpay_plans
"""
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from tenants import razorpay_service as rz
from tenants.plans import PAID_PLAN_KEYS, PLANS


class Command(BaseCommand):
    help = "Create monthly Razorpay plans for the paid tiers."

    def handle(self, *args, **options):
        if not settings.RAZORPAY_CONFIGURED:
            raise CommandError("Set real RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env first (they are still placeholders).")
        for key in PAID_PLAN_KEYS:
            plan = PLANS[key]
            try:
                created = rz.create_plan(f"GST Billing {plan['name']}", plan["price"])
            except rz.RazorpayError as exc:
                raise CommandError(str(exc))
            self.stdout.write(f"RAZORPAY_PLAN_{key.upper()}={created['id']}")
        self.stdout.write(self.style.SUCCESS("Add the lines above to .env and restart the server."))

"""Create the public tenant + its domains. Idempotent - safe to run on every deploy.

    python manage.py migrate_schemas --shared
    python manage.py bootstrap_public
"""
from django.conf import settings
from django.core.management.base import BaseCommand

from tenants.models import Business, Domain


class Command(BaseCommand):
    help = "Create the public (marketing / registration) tenant and its domains."

    def handle(self, *args, **options):
        public, created = Business.objects.get_or_create(
            schema_name="public", defaults={"name": "Tech Cognixium", "slug": "public", "plan": "pro"},
        )
        domains = [settings.TENANT_BASE_DOMAIN]
        if settings.DEBUG:
            domains.append("127.0.0.1")
        for i, domain in enumerate(domains):
            _, made = Domain.objects.get_or_create(domain=domain, defaults={"tenant": public, "is_primary": i == 0})
            if made:
                self.stdout.write(self.style.SUCCESS(f"Added public domain {domain}"))
        self.stdout.write(self.style.SUCCESS("Public tenant ready." if not created else "Public tenant created."))

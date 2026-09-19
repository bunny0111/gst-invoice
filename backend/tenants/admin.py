from django.contrib import admin

from .models import Business, Domain, SubscriptionPayment


class DomainInline(admin.TabularInline):
    model = Domain
    extra = 0


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "schema_name", "plan", "plan_expires_on", "is_active", "created_on")
    list_filter = ("plan", "is_active")
    search_fields = ("name", "slug", "schema_name")
    inlines = [DomainInline]


@admin.register(SubscriptionPayment)
class SubscriptionPaymentAdmin(admin.ModelAdmin):
    list_display = ("receipt_number", "business", "plan", "amount", "status", "is_demo", "paid_at")
    list_filter = ("plan", "status", "is_demo")

from django.urls import include, path
from rest_framework.routers import SimpleRouter

from .views import CustomerViewSet, DashboardView, InvoiceViewSet, ProductViewSet

router = SimpleRouter()
router.register("customers", CustomerViewSet, basename="customer")
router.register("products", ProductViewSet, basename="product")
router.register("invoices", InvoiceViewSet, basename="invoice")

urlpatterns = [
    path("api/dashboard/", DashboardView.as_view()),
    path("api/", include(router.urls)),
]

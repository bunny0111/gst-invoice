from django.urls import path

from .subscription_views import CancelView, CheckoutView, ReceiptPdfView, SubscriptionView, VerifyView

urlpatterns = [
    path("api/subscription/", SubscriptionView.as_view()),
    path("api/subscription/checkout/", CheckoutView.as_view()),
    path("api/subscription/verify/", VerifyView.as_view()),
    path("api/subscription/cancel/", CancelView.as_view()),
    path("api/subscription/receipts/<int:pk>/pdf/", ReceiptPdfView.as_view()),
]

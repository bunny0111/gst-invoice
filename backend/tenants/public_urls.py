from django.urls import path

from .public_views import CheckNameView, FindBusinessView, RazorpayWebhookView, RegisterView

urlpatterns = [
    path("api/public/register/", RegisterView.as_view()),
    path("api/public/check-name/", CheckNameView.as_view()),
    path("api/public/find-business/", FindBusinessView.as_view()),
    path("api/public/razorpay/webhook/", RazorpayWebhookView.as_view()),
]

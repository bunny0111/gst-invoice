"""URLs served on a TENANT subdomain (sharma.localhost): the business workspace."""
from django.urls import include, path, re_path

from billing.views import shared_invoice_pdf
from common.views import serve_media, spa_index

urlpatterns = [
    path("", include("common.urls")),
    path("", include("accounts.urls")),
    path("", include("billing.urls")),
    path("", include("tenants.subscription_urls")),
    path("share/invoice/<str:token>/", shared_invoice_pdf),
    re_path(r"^media/(?P<path>.+)$", serve_media),
    re_path(r"^(?!api/|media/|static/|share/).*$", spa_index),
]

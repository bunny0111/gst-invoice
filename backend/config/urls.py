"""URLs served on a TENANT subdomain (sharma.localhost): the business workspace."""
from django.urls import include, path, re_path

from common.views import serve_media, spa_index

urlpatterns = [
    path("", include("common.urls")),
    path("", include("accounts.urls")),
    path("", include("billing.urls")),
    path("", include("tenants.subscription_urls")),
    re_path(r"^media/(?P<path>.+)$", serve_media),
    re_path(r"^(?!api/|media/|static/).*$", spa_index),
]

"""URLs served on the PUBLIC domain (localhost / app.techcognixium.com): marketing site + registration."""
from django.contrib import admin
from django.urls import include, path, re_path

from common.views import spa_index

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("common.urls")),
    path("", include("tenants.public_urls")),
    re_path(r"^(?!api/|media/|static/|admin/).*$", spa_index),
]

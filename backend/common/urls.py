from django.urls import path

from . import views

urlpatterns = [
    path("api/csrf/", views.csrf),
    path("api/tenant/", views.tenant_info),
    path("api/plans/", views.plans),
    path("api/meta/", views.meta),
]

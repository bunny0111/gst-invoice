"""Classes referenced from REST_FRAMEWORK settings.

Kept in their own module (no `rest_framework.views` import at load time) to avoid a circular import
while DRF reads its own defaults.
"""
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import BasePermission
from rest_framework.response import Response


class StandardPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = "page_size"
    max_page_size = 100


class IsTenantUser(BasePermission):
    """Logged in, and the business account has not been disabled by the operator."""

    message = "This business account is disabled."

    def has_permission(self, request, view):
        tenant = getattr(request, "tenant", None)
        return bool(request.user and request.user.is_authenticated and (tenant is None or tenant.is_active))


def exception_handler(exc, context):
    from rest_framework.views import exception_handler as drf_exception_handler

    if isinstance(exc, ProtectedError):
        return Response(
            {"detail": "This record is used by invoices and cannot be deleted.", "code": "protected"},
            status=status.HTTP_409_CONFLICT,
        )
    response = drf_exception_handler(exc, context)
    payload = getattr(exc, "payload", None)
    if response is not None and payload is not None:
        response.data = payload
    elif response is not None and isinstance(response.data, dict) and "detail" in response.data:
        response.data["detail"] = str(response.data["detail"])
        response.data.setdefault("code", getattr(exc, "default_code", "error"))
    return response

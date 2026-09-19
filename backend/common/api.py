"""Shared DRF plumbing: pagination, error shape, CSRF for anonymous endpoints, plan-limit error."""
from rest_framework import exceptions, status
from rest_framework.authentication import CSRFCheck
from rest_framework.permissions import SAFE_METHODS


class PlanLimitExceeded(exceptions.APIException):
    """Raised BEFORE a record is created when the tenant's plan limit is reached (PRD section 6)."""

    status_code = status.HTTP_403_FORBIDDEN
    default_code = "plan_limit"

    def __init__(self, resource: str, limit: int, used: int, plan: str, message: str):
        # DRF stringifies every value inside `detail`; `payload` keeps limit/used as real numbers.
        self.payload = {"detail": message, "code": "plan_limit", "resource": resource,
                        "limit": limit, "used": used, "plan": plan}
        super().__init__(detail=message, code="plan_limit")


class ApiError(exceptions.APIException):
    """A 4xx with a machine readable `code` next to the human message."""

    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str, code: str = "error", status_code: int | None = None, **extra):
        if status_code:
            self.status_code = status_code
        self.payload = {"detail": message, "code": code, **extra}
        super().__init__(detail=message, code=code)


def enforce_csrf(request) -> None:
    """DRF only checks CSRF for session-authenticated requests. Anonymous POSTs (login,
    register, OTP ...) go through the same check so *every* form is CSRF protected (PRD 7.2)."""
    check = CSRFCheck(lambda r: None)
    check.process_request(request)
    reason = check.process_view(request, None, (), {})
    if reason:
        raise exceptions.PermissionDenied(f"CSRF check failed: {reason}")


class CsrfProtectedMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in SAFE_METHODS:
            enforce_csrf(request)


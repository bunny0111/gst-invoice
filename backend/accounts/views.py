import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from common.api import ApiError, CsrfProtectedMixin

from .models import BusinessProfile, PasswordResetOTP
from .serializers import BusinessProfileSerializer, validate_logo_file

log = logging.getLogger(__name__)
User = get_user_model()


def get_profile(user) -> BusinessProfile:
    profile, _ = BusinessProfile.objects.get_or_create(user=user, defaults={"business_name": user.email})
    return profile


def me_payload(request) -> dict:
    profile = get_profile(request.user)
    tenant = request.tenant
    return {
        "id": request.user.id,
        "email": request.user.email,
        "business": {"name": tenant.name, "slug": tenant.slug, "plan": tenant.effective_plan},
        "profile_complete": profile.is_complete,
        "missing_fields": profile.missing_fields,
        "logo_url": f"/media/{profile.logo.name}" if profile.logo else None,
        "business_name": profile.business_name,
    }


class LoginView(CsrfProtectedMixin, APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        if not request.tenant.is_active:
            raise ApiError("This business account is disabled. Please contact support.", "tenant_disabled", 403)
        email = str(request.data.get("email", "")).strip().lower()
        password = str(request.data.get("password", ""))
        user = authenticate(request, username=email, password=password)
        if user is None:
            raise ApiError("Invalid email or password.", "invalid_credentials", 400)
        login(request, user)
        return Response(me_payload(request))


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({"ok": True})


class MeView(APIView):
    def get(self, request):
        return Response(me_payload(request))


class ForgotPasswordView(CsrfProtectedMixin, APIView):
    """Emails a 6 digit OTP. Always answers 200 so the endpoint can't be used to find valid emails."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp"

    def post(self, request):
        email = str(request.data.get("email", "")).strip().lower()
        user = User.objects.filter(username=email, is_active=True).first()
        if user:
            recent = PasswordResetOTP.objects.filter(user=user, created_at__gt=timezone.now() - timedelta(seconds=45))
            if not recent.exists():
                code = PasswordResetOTP.issue(user)
                send_mail(
                    subject=f"{code} is your Tech Cognixium password reset code",
                    message=(
                        f"Hi,\n\nYour password reset code for {request.tenant.name} is {code}.\n"
                        "It expires in 10 minutes. If you did not ask for this, you can ignore this email.\n\n"
                        "- Tech Cognixium"
                    ),
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[user.email],
                    fail_silently=True,
                )
        return Response({"ok": True, "detail": "If that email is registered, a 6-digit code is on its way."})


class ResetPasswordView(CsrfProtectedMixin, APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp"

    def post(self, request):
        email = str(request.data.get("email", "")).strip().lower()
        code = str(request.data.get("otp", "")).strip()
        new_password = str(request.data.get("new_password", ""))
        try:
            validate_password(new_password)
        except DjangoValidationError:
            raise serializers.ValidationError({"new_password": ["Password must be at least 8 characters."]})

        user = User.objects.filter(username=email, is_active=True).first()
        otp = PasswordResetOTP.objects.filter(user=user, used=False).order_by("-created_at").first() if user else None
        bad = ApiError("That code is invalid or has expired. Request a new one.", "invalid_otp", 400)
        if not otp or otp.expires_at < timezone.now() or otp.attempts >= PasswordResetOTP.MAX_ATTEMPTS:
            raise bad
        if not otp.matches(code):
            otp.attempts += 1
            otp.save(update_fields=["attempts"])
            raise bad
        user.set_password(new_password)
        user.save(update_fields=["password"])
        otp.used = True
        otp.save(update_fields=["used"])
        return Response({"ok": True, "detail": "Password updated. You can now log in."})


class ProfileView(APIView):
    """PRD US-02 - business profile (GET / PATCH)."""

    def get(self, request):
        return Response(BusinessProfileSerializer(get_profile(request.user)).data)

    def patch(self, request):
        profile = get_profile(request.user)
        ser = BusinessProfileSerializer(profile, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(BusinessProfileSerializer(profile).data)


class LogoView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request):
        upload = request.FILES.get("logo")
        if not upload:
            raise serializers.ValidationError({"logo": ["Choose an image file."]})
        try:
            validate_logo_file(upload)
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({"logo": exc.detail})
        profile = get_profile(request.user)
        profile.logo = upload  # stored under MEDIA_ROOT/<schema>/business_logos/ (tenant isolated)
        profile.save(update_fields=["logo", "updated_at"])
        return Response(BusinessProfileSerializer(profile).data)

    def delete(self, request):
        profile = get_profile(request.user)
        profile.logo = None
        profile.save(update_fields=["logo", "updated_at"])
        return Response(BusinessProfileSerializer(profile).data)

import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import send_mail
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.http import require_GET
from rest_framework import serializers
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from common.api import ApiError, CsrfProtectedMixin

from .logo import store_logo
from .models import BusinessProfile, LogoImage, PasswordResetOTP
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
        "logo_url": profile.logo_url,
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
        # "Keep me signed in": a longer (still sliding) session for this device. Unticked = the 1-day default.
        # Changing the password later invalidates every session, remembered or not (Django's session auth hash).
        if request.data.get("remember") in (True, "true", "1", 1):
            request.session.set_expiry(settings.SESSION_REMEMBER_ME_AGE)
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
    """Upload / remove one of the profile's images. The same view serves the logo, the signature and the payment
    QR code: `form_field` is the multipart field name, `profile_field` the BusinessProfile foreign key."""
    parser_classes = [MultiPartParser]
    form_field = "logo"
    profile_field = "logo_image"

    def post(self, request):
        key = self.form_field
        upload = request.FILES.get(key)
        if not upload:
            raise serializers.ValidationError({key: ["Choose an image file."]})
        try:
            validate_logo_file(upload)
            image = store_logo(upload)  # shrunk, saved in the tenant's own database schema
        except serializers.ValidationError as exc:
            raise serializers.ValidationError({key: exc.detail})
        profile = get_profile(request.user)
        setattr(profile, self.profile_field, image)
        profile.save(update_fields=[self.profile_field, "updated_at"])
        return Response(BusinessProfileSerializer(profile).data)

    def delete(self, request):
        # the image row stays: invoices finalized with it keep showing it
        profile = get_profile(request.user)
        setattr(profile, self.profile_field, None)
        profile.save(update_fields=[self.profile_field, "updated_at"])
        return Response(BusinessProfileSerializer(profile).data)


class SignatureView(LogoView):
    form_field = "signature"
    profile_field = "signature_image"


class PaymentQrView(LogoView):
    form_field = "qr"
    profile_field = "payment_qr_image"


class SmtpTestView(APIView):
    """Send a test email through the business's own mail server, to the logged-in user, using the settings in the
    request (so they can be tried before saving). A blank password means "use the one already saved"."""
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "share"

    def post(self, request):
        from common import crypto
        from common.mailer import smtp_connection, smtp_error_message

        profile = get_profile(request.user)
        data = request.data
        host = str(data.get("smtp_host") or "").strip()
        from_email = str(data.get("smtp_from_email") or "").strip()
        if not host or not from_email:
            raise ApiError("Enter the server and the From email first.", "smtp_incomplete", 400)
        try:
            port = int(data.get("smtp_port") or 587)
        except (TypeError, ValueError):
            raise ApiError("The port must be a number (usually 587 or 465).", "smtp_port", 400)
        password = str(data.get("smtp_password") or "") or crypto.decrypt(profile.smtp_password)
        connection = smtp_connection(host, port, str(data.get("smtp_security") or "starttls"),
                                     str(data.get("smtp_username") or "").strip(), password)
        name = str(data.get("smtp_from_name") or profile.business_name).strip()
        from django.core.mail import EmailMessage
        message = EmailMessage(
            subject="Test email from GST Billing",
            body=f"This is a test from GST Billing.\n\nYour invoices will be sent from {from_email} "
                 f"through {host}:{port}. Everything is working.",
            from_email=f"{name} <{from_email}>", to=[request.user.email], connection=connection)
        try:
            message.send(fail_silently=False)
        except Exception as exc:  # noqa: BLE001 - any SMTP/socket/TLS failure becomes a readable message
            log.info("SMTP test failed for %s: %s", host, exc)
            raise ApiError(smtp_error_message(exc), "smtp_failed", 400)
        return Response({"detail": f"Test email sent to {request.user.email}."})


@require_GET
def logo_image(request, pk: int):
    """Serve a stored image. Looked up in the CURRENT tenant's schema only, so another business's image is a 404.
    A row never changes, so browsers may cache it forever (a new upload gets a new id and a new URL).
    Without a login only the CURRENT logo is served (the login page shows it); signatures, QR codes and older logos
    need a signed-in user."""
    if not request.user.is_authenticated:
        profile = BusinessProfile.objects.only("logo_image_id").first()
        if not profile or profile.logo_image_id != pk:
            return HttpResponse(status=404)
    image = get_object_or_404(LogoImage, pk=pk)
    response = HttpResponse(bytes(image.data), content_type=image.content_type)
    response["Cache-Control"] = ("public" if not request.user.is_authenticated else "private") + ", max-age=31536000, immutable"
    response["X-Content-Type-Options"] = "nosniff"
    return response

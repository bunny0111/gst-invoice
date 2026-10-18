"""
Django settings for the Tech Cognixium GST Invoicing & Billing SaaS.

Multi-tenancy is schema based (django-tenants):
  * public schema  -> Business (tenant) + Domain + subscription payments
  * tenant schemas -> users, business profile, customers, products, invoices ...
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent

# The .env lives in the project root (GST_Invoice/.env). A local backend/.env wins if present.
load_dotenv(ROOT_DIR / ".env")
load_dotenv(BASE_DIR / ".env", override=True)

# WeasyPrint needs the Pango/GTK libraries. On Windows they come from MSYS2 (see README).
if sys.platform == "win32":
    _dll_dir = os.environ.get("WEASYPRINT_DLL_DIRECTORIES", r"C:\msys64\mingw64\bin")
    if os.path.isdir(_dll_dir):
        os.environ["WEASYPRINT_DLL_DIRECTORIES"] = _dll_dir


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


# --------------------------------------------------------------------------- core
DEBUG = env_bool("DEBUG", False)

SECRET_KEY = os.environ.get("SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-change-me"
    else:
        raise RuntimeError("SECRET_KEY must be set in the environment (.env) when DEBUG is off.")

# Base domain that tenants hang off: {slug}.{TENANT_BASE_DOMAIN}
#   dev  -> localhost                 (sharma.localhost)
#   prod -> app.techcognixium.com     (sharma.app.techcognixium.com)
TENANT_BASE_DOMAIN = os.environ.get("TENANT_BASE_DOMAIN", "localhost")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")
if DEBUG:
    ALLOWED_HOSTS += [".localhost"]
ALLOWED_HOSTS += [f".{TENANT_BASE_DOMAIN}"] if TENANT_BASE_DOMAIN != "localhost" else []

# --------------------------------------------------------------------------- apps
SHARED_APPS = [
    "django_tenants",  # must be first
    "tenants",
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.admin",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
]

TENANT_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "accounts",
    "billing",
]

INSTALLED_APPS = list(SHARED_APPS) + [app for app in TENANT_APPS if app not in SHARED_APPS]

TENANT_MODEL = "tenants.Business"
TENANT_DOMAIN_MODEL = "tenants.Domain"

MIDDLEWARE = [
    "django_tenants.middleware.main.TenantMainMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
PUBLIC_SCHEMA_URLCONF = "config.urls_public"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --------------------------------------------------------------------------- database
DATABASES = {
    "default": {
        "ENGINE": "django_tenants.postgresql_backend",
        "NAME": os.environ.get("DB_NAME", "gst_billing_db"),
        "USER": os.environ.get("DB_USER", "postgres"),
        "PASSWORD": os.environ.get("DB_PASSWORD", ""),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
    }
}
if os.environ.get("DATABASE_URL"):  # Railway style connection string
    import urllib.parse as _up

    _u = _up.urlparse(os.environ["DATABASE_URL"])
    DATABASES["default"].update(
        NAME=_u.path.lstrip("/"), USER=_u.username, PASSWORD=_up.unquote(_u.password or ""),
        HOST=_u.hostname, PORT=str(_u.port or 5432),
    )
    _sslmode = _up.parse_qs(_u.query).get("sslmode", [""])[0]  # Neon / Render need sslmode=require
    if _sslmode:
        DATABASES["default"]["OPTIONS"] = {"sslmode": _sslmode}

DATABASE_ROUTERS = ("django_tenants.routers.TenantSyncRouter",)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --------------------------------------------------------------------------- auth / security
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
]

# PRD 7.2 - passwords are stored as bcrypt hashes. PBKDF2 stays for reading legacy hashes only.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

# PRD 7.2 - sessions expire after 24 hours of inactivity.
SESSION_COOKIE_AGE = 60 * 60 * 24                 # default: 1 day (slides - SAVE_EVERY_REQUEST - so active users stay in)
SESSION_REMEMBER_ME_AGE = 60 * 60 * 24 * 30       # "Keep me signed in": 30 days, also sliding
SESSION_SAVE_EVERY_REQUEST = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if DEBUG:
    CSRF_TRUSTED_ORIGINS += [
        "http://localhost:5173", "http://*.localhost:5173",
        "http://localhost:8000", "http://*.localhost:8000",
    ]
if TENANT_BASE_DOMAIN != "localhost":
    CSRF_TRUSTED_ORIGINS += [f"https://{TENANT_BASE_DOMAIN}", f"https://*.{TENANT_BASE_DOMAIN}"]

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_HSTS_SECONDS = 31536000
    X_FRAME_OPTIONS = "DENY"

# --------------------------------------------------------------------------- DRF
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["common.drf.IsTenantUser"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_PAGINATION_CLASS": "common.drf.StandardPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        "login": "20/min",
        "register": "15/min",
        "otp": "10/min",
        "lookup": "60/min",
        "share": "30/min",
    },
    "EXCEPTION_HANDLER": "common.drf.exception_handler",
}

# --------------------------------------------------------------------------- i18n
LANGUAGE_CODE = "en-in"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

# --------------------------------------------------------------------------- static & media
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

FRONTEND_DIST = ROOT_DIR / "frontend" / "dist"
if FRONTEND_DIST.is_dir():
    WHITENOISE_ROOT = FRONTEND_DIST  # serves the built React app's /assets, favicon ...

MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))
MULTITENANT_RELATIVE_MEDIA_ROOT = "%s"  # -> MEDIA_ROOT/<schema_name>/business_logos/...

STORAGES = {
    "default": {"BACKEND": "django_tenants.files.storage.TenantFileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

FILE_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024

# --------------------------------------------------------------------------- email (Resend)
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "Tech Cognixium <noreply@techcognixium.com>")
if RESEND_API_KEY:
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = "smtp.resend.com"
    EMAIL_PORT = 587
    EMAIL_HOST_USER = "resend"
    EMAIL_HOST_PASSWORD = RESEND_API_KEY
    EMAIL_USE_TLS = True
else:  # dev: OTP emails are printed in the runserver console
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# --------------------------------------------------------------------------- Razorpay
RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
RAZORPAY_WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET", "")
RAZORPAY_PLAN_IDS = {
    "starter": os.environ.get("RAZORPAY_PLAN_STARTER", ""),
    "pro": os.environ.get("RAZORPAY_PLAN_PRO", ""),
}
_placeholder = (not RAZORPAY_KEY_ID) or RAZORPAY_KEY_ID.startswith("dummy") or RAZORPAY_KEY_SECRET.startswith("dummy")
# Demo checkout is only ever available with placeholder keys AND DEBUG on - never in production.
RAZORPAY_MOCK = _placeholder and DEBUG
RAZORPAY_CONFIGURED = not _placeholder

# --------------------------------------------------------------------------- logging
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {"django.request": {"level": "ERROR"}},
}

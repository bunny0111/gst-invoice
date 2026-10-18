import mimetypes
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404, HttpResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django_tenants.utils import get_public_schema_name
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from tenants.plans import COMPARISON, PLANS

from .gst import GST_RATE_CUTOVER, GST_RATES, LEGACY_GST_RATES, PAYMENT_MODES, STATES, UNITS


def is_public(request) -> bool:
    return request.tenant.schema_name == get_public_schema_name()


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def csrf(request):
    """Sets the CSRF cookie; the React app echoes it back as X-CSRFToken on every write."""
    return Response({"csrfToken": get_token(request)})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def tenant_info(request):
    """Tells the React app which 'site' it is running on: marketing/registration or a business workspace."""
    if is_public(request):
        return Response({"is_public": True, "base_domain": settings.TENANT_BASE_DOMAIN})
    tenant = request.tenant
    return Response({
        "is_public": False, "base_domain": settings.TENANT_BASE_DOMAIN,
        "name": tenant.name, "slug": tenant.slug, "active": tenant.is_active,
    })


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def plans(request):
    return Response({"plans": list(PLANS.values()), "comparison": COMPARISON})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def meta(request):
    return Response({
        "states": [{"code": c, "name": n, "gst_code": g} for c, n, g in STATES],
        "gst_rates": [float(r) if r % 1 else int(r) for r in GST_RATES],
        "legacy_gst_rates": [int(r) for r in LEGACY_GST_RATES],
        "gst_rate_cutover": GST_RATE_CUTOVER.isoformat(),
        "units": [{"code": c, "name": n} for c, n in UNITS],
        "payment_modes": [{"code": c, "name": n} for c, n in PAYMENT_MODES],
    })


def robots_txt(request):
    """Only the public marketing domain may be crawled. Every tenant subdomain is a private
    workspace and is blocked outright - the strongest layer, ahead of the per-page <meta
    name="robots"> set in the React app (src/lib/seo.ts), which a non-JS crawler never sees."""
    if is_public(request):
        origin = f"{'https' if request.is_secure() else 'http'}://{request.get_host()}"
        body = f"User-agent: *\nAllow: /\n\nSitemap: {origin}/sitemap.xml\n"
    else:
        body = "User-agent: *\nDisallow: /\n"
    return HttpResponse(body, content_type="text/plain")


def sitemap_xml(request):
    """Hand-written sitemap for the handful of public marketing pages. Served empty (no <url>
    entries) on tenant subdomains, which carry nothing worth indexing."""
    urls: list[str] = []
    if is_public(request):
        origin = f"{'https' if request.is_secure() else 'http'}://{request.get_host()}"
        urls = [f"{origin}/", f"{origin}/register"]
    entries = "".join(f"<url><loc>{u}</loc></url>" for u in urls)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return HttpResponse(xml, content_type="application/xml")


def serve_media(request, path: str):
    """Serve uploaded logos from the CURRENT tenant's own media folder (tenant isolated)."""
    if not path.startswith("business_logos/") or Path(path).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise Http404
    try:
        if not default_storage.exists(path):
            raise Http404
        handle = default_storage.open(path, "rb")
    except (SuspiciousFileOperation, FileNotFoundError):
        raise Http404
    response = FileResponse(handle, content_type=mimetypes.guess_type(path)[0] or "image/png")
    response["Cache-Control"] = "private, max-age=300"
    return response


def spa_index(request, *args, **kwargs):
    """Serves the built React app for every non-API route (client-side routing).

    A handful of public marketing routes get a PRERENDERED snapshot instead (see
    scripts/prerender.py): real text + the already-correct <title>/meta/OG tags in the raw
    HTML, for crawlers that don't execute JavaScript. The snapshot still loads the same bundled
    script, so the browser hydrates it into the normal interactive SPA.
    """
    dist = Path(settings.FRONTEND_DIST)
    if is_public(request):
        snapshot = dist / request.path.strip("/") / "index.html"  # "" -> dist/index.html (root)
        if snapshot.is_file():
            return HttpResponse(snapshot.read_text(encoding="utf-8"), content_type="text/html")

    index = dist / "index.html"
    if index.is_file():
        return HttpResponse(index.read_text(encoding="utf-8"), content_type="text/html")
    return HttpResponse(
        "<h2 style='font-family:sans-serif'>GST Billing API is running.</h2>"
        "<p style='font-family:sans-serif'>Frontend not built. Run <code>npm run dev</code> in /frontend "
        "(http://localhost:5173) or <code>npm run build</code> to serve it from here.</p>",
        content_type="text/html",
    )

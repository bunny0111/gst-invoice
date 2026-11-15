import mimetypes
from html import escape
from pathlib import Path

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404, HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from django_tenants.utils import get_public_schema_name
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from tenants.plans import COMPARISON, PLANS

from .seo import render_index
from .gst import ACCOUNT_TYPES, BUSINESS_NATURES, BUSINESS_TYPES, GST_RATE_CUTOVER, GST_RATES, LEGACY_GST_RATES, PAYMENT_MODES, STATES, UNIT_DETAILS


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
    from accounts.models import BusinessProfile  # tenant app: queried inside this business's own schema

    profile = BusinessProfile.objects.only("logo_image_id").first()
    return Response({
        "is_public": False, "base_domain": settings.TENANT_BASE_DOMAIN,
        "name": tenant.name, "slug": tenant.slug, "active": tenant.is_active,
        "logo_url": profile.logo_url if profile else None,  # the login page shows the business's own logo
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
        "units": [{"code": c, "name": n, "group": g, "uqc": q} for c, n, g, q in UNIT_DETAILS],
        "payment_modes": [{"code": c, "name": n} for c, n in PAYMENT_MODES],
        "business_types": [{"code": c, "name": n} for c, n in BUSINESS_TYPES],
        "business_natures": [{"code": c, "name": n} for c, n in BUSINESS_NATURES],
        "account_types": [{"code": c, "name": n} for c, n in ACCOUNT_TYPES],
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


def _home_screen_label(name: str, limit: int = 10) -> str:
    """Launchers cut long labels mid-word ("Sharma Furni"), so keep whole words that fit in `limit` characters."""
    label = ""
    for word in name.split():
        candidate = f"{label} {word}".strip()
        if len(candidate) > limit:
            break
        label = candidate
    return label or name.strip()[:limit] or "GST Billing"


@require_GET
def web_manifest(request):
    """The PWA manifest, per host: a business workspace installs as ITS OWN app (its name, opens straight at its
    login / dashboard), while the public site installs as a generic "GST Billing" that opens the workspace finder."""
    icons = [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ]
    if is_public(request):
        data = {"name": "GST Billing by Tech Cognixium", "short_name": "GST Billing", "start_url": "/login", "shortcuts": []}
    else:
        name = request.tenant.name
        data = {
            "name": f"{name} · GST Billing", "short_name": _home_screen_label(name), "start_url": "/",
            "shortcuts": [
                {"name": "New invoice", "url": "/invoices/new", "icons": [{"src": "/icon-192.png", "sizes": "192x192"}]},
                {"name": "Payment details", "url": "/payments", "icons": [{"src": "/icon-192.png", "sizes": "192x192"}]},
                {"name": "Customers", "url": "/customers", "icons": [{"src": "/icon-192.png", "sizes": "192x192"}]},
            ],
        }
    data.update({
        "id": "/", "scope": "/", "display": "standalone", "lang": "en-IN",
        "description": "GST invoicing & billing for small businesses — CGST/SGST/IGST invoices, PDFs and payment tracking.",
        "background_color": "#f6f5fc", "theme_color": "#4f3fe0", "categories": ["business", "finance"], "icons": icons,
    })
    response = JsonResponse(data, content_type="application/manifest+json")
    response["Cache-Control"] = "public, max-age=3600"
    return response


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


def _origin(request) -> str:
    return f"{'https' if request.is_secure() else 'http'}://{request.get_host()}"


def workspace_not_found(request):
    """django-tenants calls this (settings.DEFAULT_NOT_FOUND_TENANT_VIEW) for a subdomain with no business behind it,
    e.g. a typo in the address. A friendly page with the way back, instead of a bare "Not Found"."""
    if request.path.startswith("/api/"):
        return JsonResponse({"detail": "No business workspace at this address.", "code": "no_workspace"}, status=404)
    host = request.get_host().split(":")[0]
    base = settings.TENANT_BASE_DOMAIN
    slug = host[: -len(base) - 1] if host.endswith("." + base) else host
    port = request.get_host().partition(":")[2]
    home = f"{'https' if request.is_secure() else 'http'}://{base}{':' + port if port else ''}"
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Workspace not found · GST Billing</title><link rel="icon" href="{home}/favicon.svg">
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f5fc;font-family:Inter,system-ui,sans-serif;color:#1e1b3a}}
main{{max-width:420px;padding:32px 20px;text-align:center}}h1{{font-size:1.6rem;margin:16px 0 8px}}p{{color:#57537a;line-height:1.6}}
code{{background:#ebe8ff;padding:2px 6px;border-radius:6px;word-break:break-all}}
a.btn{{display:inline-block;margin:8px 4px 0;padding:12px 20px;border-radius:12px;font-weight:700;text-decoration:none}}
.p{{background:#4f3fe0;color:#fff}}.s{{background:#fff;color:#4f3fe0;border:1px solid #d6d1fb}}
@media (prefers-color-scheme:dark){{body{{background:#100e22;color:#f1effe}}p{{color:#b3afd6}}code{{background:#2a2550}}.s{{background:#1b1838;border-color:#3a3470;color:#c9c1ff}}}}</style></head>
<body><main><img src="{home}/icon-192.png" alt="" width="64" height="64" style="border-radius:16px">
<h1>We couldn't find this workspace</h1>
<p>There is no business at <code>{escape(slug)}</code>. Check the address for a typo, or look your business up by name.</p>
<a class="btn p" href="{home}/login">Find your workspace</a><a class="btn s" href="{home}/register">Create a free account</a>
</main></body></html>"""
    return HttpResponse(page, status=404, content_type="text/html; charset=utf-8")


def spa_index(request, *args, **kwargs):
    """Serves the built React app for every non-API route (client-side routing).

    A handful of public marketing routes get a PRERENDERED snapshot instead (see
    scripts/prerender.py): real text + the already-correct <title>/meta/OG tags in the raw
    HTML, for crawlers that don't execute JavaScript. The snapshot still loads the same bundled
    script, so the browser hydrates it into the normal interactive SPA.
    """
    dist = Path(settings.FRONTEND_DIST)
    public = is_public(request)
    if public:
        snapshot = dist / request.path.strip("/") / "index.html"  # "" -> dist/index.html (root)
        html = snapshot.read_text(encoding="utf-8") if snapshot.is_file() else ""
        if html and '<div id="root"></div>' not in html:  # a real prerendered snapshot, not the empty shell
            return HttpResponse(html, content_type="text/html; charset=utf-8")

    index = dist / "index.html"
    if index.is_file():
        # absolute og:url / og:image everywhere; per-page title, description and content on the marketing routes
        path = "/" + request.path.strip("/") if request.path.strip("/") else "/"
        html = render_index(index.read_text(encoding="utf-8"), _origin(request), path, public)
        return HttpResponse(html, content_type="text/html; charset=utf-8")
    return HttpResponse(
        "<h2 style='font-family:sans-serif'>GST Billing API is running.</h2>"
        "<p style='font-family:sans-serif'>Frontend not built. Run <code>npm run dev</code> in /frontend "
        "(http://localhost:5173) or <code>npm run build</code> to serve it from here.</p>",
        content_type="text/html; charset=utf-8",
    )

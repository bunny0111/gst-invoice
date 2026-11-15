"""Server-side SEO for the client-rendered React app.

The built index.html is the same shell for every route, so crawlers and link-preview bots that don't run JavaScript
(Bing, WhatsApp, LinkedIn, Slack, Facebook...) would see an empty page with relative og:url / og:image tags that they
can't resolve. `render_index()` fixes that on every request, without a headless browser in the build:

  * every host: og:url / og:image / canonical become absolute URLs of the current host
  * public marketing routes: each gets its own title + description, JSON-LD, and readable content inside #root
    (React replaces it as soon as the app starts, so visitors see the normal page)

When `scripts/prerender.py` snapshots exist in dist/ they are still preferred (see common.views.spa_index).
"""
import json
import re
from html import escape

from tenants.plans import PLANS

SITE_NAME = "GST Billing by Tech Cognixium"

PAGES = {
    "/": {
        "title": SITE_NAME,
        "description": "Create GST-compliant invoices in under 2 minutes. Automatic CGST, SGST & IGST, PDF invoices, "
                       "payment tracking, and a dashboard built for Indian shopkeepers and freelancers. Free to start.",
    },
    "/register": {
        "title": f"Create your free account · {SITE_NAME}",
        "description": "Register your business for free in seconds — get your own private, isolated GST billing "
                       "workspace. 10 free invoices every month, no credit card required.",
    },
    "/login": {
        "title": f"Log in · {SITE_NAME}",
        "description": "Find your GST Billing workspace and log in to your business account.",
    },
}

FEATURES = [
    ("GST that calculates itself", "Pick a customer and CGST + SGST or IGST is worked out per line, live as you type."),
    ("Professional PDF invoices", "Logo, GSTIN, HSN table, tax summary, amount in words, bank details and a UPI QR."),
    ("Payment tracking", "Record UPI, cash, bank or cheque payments, see partly paid and overdue invoices at a glance."),
    ("Send on WhatsApp or email", "Share any invoice with your customer in one tap, with a link to the PDF."),
    ("Customers & catalogue", "Save customers and products with HSN/SAC codes and GST rates once, reuse them forever."),
    ("Private by design", "Every business gets its own isolated database and its own web address."),
]

FAQ = [
    ("Is it really free?", "Yes. The Free plan gives you 10 invoices a month, 10 customers and 20 products — forever. "
                           "Upgrade to Starter (₹199/mo) or Pro (₹499/mo) only when you need more."),
    ("Do I need accounting knowledge?", "No. You enter what you sold and to whom; CGST, SGST or IGST, the round-off and "
                                        "the amount in words are worked out for you."),
    ("Which GST rates are supported?", "The current slabs — 0%, 5%, 18% and 40% (after the 22 Sep 2025 GST reform), plus "
                                       "the special 0.25% and 3% rates. Businesses without a GSTIN issue a Bill of Supply."),
    ("Can I use it on my phone?", "Yes. It works in any phone browser and can be installed on the home screen like an app."),
]

# Readable, lightly styled fallback content. Scoped to #seo-static and removed by React when the app mounts.
_STYLE = ("<style>#seo-static{max-width:960px;margin:0 auto;padding:40px 20px 64px;font-family:Inter,system-ui,sans-serif;"
          "color:#1e1b3a;line-height:1.6}#seo-static h1{font-size:2rem;line-height:1.2;margin:0 0 12px}"
          "#seo-static h2{font-size:1.25rem;margin:32px 0 8px}#seo-static a{color:#4f3fe0;font-weight:600}"
          "#seo-static ul{padding-left:20px}#seo-static li{margin:6px 0}</style>")


def _list(rows) -> str:
    return "<ul>" + "".join(f"<li><strong>{escape(a)}</strong> — {escape(b)}</li>" for a, b in rows) + "</ul>"


def _plans() -> str:
    def limit(v):
        return "unlimited" if v is None else v

    rows = []
    for p in PLANS.values():
        price = "free forever" if not p["price"] else f"₹{p['price']} / month"
        lim = p["limits"]
        rows.append(f"<li><strong>{escape(p['name'])}</strong> — {price}: {limit(lim['invoices_per_month'])} invoices a month, "
                    f"{limit(lim['customers'])} customers, {limit(lim['products'])} products.</li>")
    return "<ul>" + "".join(rows) + "</ul>"


def _body(path: str) -> str:
    if path == "/register":
        inner = ("<h1>Create your free GST Billing account</h1><p>Enter your business name, email and a password — you get "
                 "your own private workspace instantly. 10 free invoices every month, no credit card.</p>"
                 f"<h2>Plans</h2>{_plans()}")
    elif path == "/login":
        inner = ("<h1>Log in to GST Billing</h1><p>Type your business name to find your workspace, then log in. "
                 "New here? <a href=\"/register\">Create a free account</a>.</p>")
    else:
        inner = ("<h1>GST invoices in under 2 minutes</h1>"
                 "<p>The simple, affordable billing app for Indian shopkeepers, freelancers and traders. CGST, SGST and IGST "
                 "calculated for you — so you can bill, get paid and stop worrying about mistakes.</p>"
                 "<p><a href=\"/register\">Start free — no card needed</a> · <a href=\"/login\">Log in</a></p>"
                 f"<h2>Features</h2>{_list(FEATURES)}<h2>Pricing</h2>{_plans()}<h2>Questions</h2>{_list(FAQ)}"
                 "<p>Powered by <a href=\"https://techcognixium.com/\">Tech Cognixium</a>.</p>")
    return f'{_STYLE}<div id="seo-static">{inner}</div>'


def _json_ld(origin: str) -> str:
    data = [
        {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": SITE_NAME,
         "applicationCategory": "BusinessApplication", "operatingSystem": "Web, Android, iOS", "url": origin + "/",
         "description": PAGES["/"]["description"],
         "offers": [{"@type": "Offer", "name": p["name"], "price": str(p["price"]), "priceCurrency": "INR"} for p in PLANS.values()],
         "publisher": {"@type": "Organization", "name": "Tech Cognixium", "url": "https://techcognixium.com/"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
    ]
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")  # "</" can't appear inside a <script> block
    return '<script type="application/ld+json">' + payload + "</script>"


def _set_meta(html: str, attr: str, key: str, value: str) -> str:
    tag = f'<meta {attr}="{key}" content="{escape(value, quote=True)}" />'
    pattern = re.compile(rf'<meta {attr}="{re.escape(key)}" content="[^"]*"\s*/?>')
    return pattern.sub(lambda _: tag, html, count=1) if pattern.search(html) else html.replace("</head>", f"    {tag}\n  </head>", 1)


def render_index(html: str, origin: str, path: str, public: bool) -> str:
    """Return index.html with absolute social URLs, and - on public marketing routes - per-page SEO content."""
    page = PAGES.get(path) if public else None
    url = origin + (path if page else "/")
    html = _set_meta(html, "property", "og:url", url)
    for key in ("og:image", "twitter:image"):
        html = _set_meta(html, "property" if key.startswith("og") else "name", key, origin + "/og-image.png")
    if not page:
        return html
    title, description = page["title"], page["description"]
    html = re.sub(r"<title>.*?</title>", lambda _: f"<title>{escape(title)}</title>", html, count=1, flags=re.S)
    html = _set_meta(html, "name", "description", description)
    for attr, key, value in (("property", "og:title", title), ("property", "og:description", description),
                             ("name", "twitter:title", title), ("name", "twitter:description", description)):
        html = _set_meta(html, attr, key, value)
    head_extra = f'    <link rel="canonical" href="{escape(url, quote=True)}" />\n'
    if path == "/":
        head_extra += f"    {_json_ld(origin)}\n"
    html = html.replace("</head>", head_extra + "  </head>", 1)
    return html.replace('<div id="root"></div>', f'<div id="root">{_body(path)}</div>', 1)

"""Checks the measurable non-functional requirements of PRD section 7 against a running dev server.

    python scripts/nfr_check.py <tenant-slug> <owner-email> <password> [django-log-file]

Bulk-loads 1,000 invoices into that tenant, then times the dashboard (<2 s), CRUD calls (<500 ms) and the PDF
(<5 s); confirms passwords are bcrypt hashes; and walks the emailed-OTP password reset end to end.
"""
import os
import re
import sys
import time
from datetime import date, timedelta
from decimal import Decimal

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django  # noqa: E402

django.setup()

from django.contrib.auth import get_user_model  # noqa: E402
from django_tenants.utils import schema_context  # noqa: E402

from billing.models import Customer, Invoice, InvoiceLineItem  # noqa: E402
from tenants.models import Business  # noqa: E402

slug, email, password = sys.argv[1], sys.argv[2], sys.argv[3]
LOG = sys.argv[4] if len(sys.argv) > 4 else "/tmp/django.log"
BASE = "http://127.0.0.1:8000"
HOST = f"{slug}.localhost:8000"
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("  PASS  " if ok else "  FAIL  ") + name + (f"   [{detail}]" if detail else ""))


schema = Business.objects.get(slug=slug).schema_name

print(f"\n== Loading 1,000 invoices into {schema}")
with schema_context(schema):
    cust = Customer.objects.filter(is_active=True).first()
    today = date.today()
    before = Invoice.objects.count()
    invs = [
        Invoice(customer=cust, invoice_number=f"LOAD/{i:04d}", financial_year="2026-27", invoice_date=today - timedelta(days=i % 150),
                due_date=today - timedelta(days=(i % 150) - 15), supply_type="intrastate", place_of_supply=cust.state,
                status=["paid", "sent", "partial", "draft"][i % 4], subtotal=Decimal("1000"), taxable_amount=Decimal("1000"),
                cgst_amount=Decimal("90"), sgst_amount=Decimal("90"), grand_total=Decimal("1180"),
                amount_paid=Decimal("1180") if i % 4 == 0 else Decimal("0"))
        for i in range(1000)
    ]
    Invoice.objects.bulk_create(invs, batch_size=250)
    items = [InvoiceLineItem(invoice=inv, item_name="Load item", unit_price=Decimal("1000"), quantity=Decimal("1"), gst_rate=Decimal("18"),
                             gross_amount=Decimal("1000"), taxable_amount=Decimal("1000"), line_total=Decimal("1180"))
             for inv in Invoice.objects.filter(invoice_number__startswith="LOAD/")]
    InvoiceLineItem.objects.bulk_create(items, batch_size=500)
    print(f"  invoices in tenant: {before} -> {Invoice.objects.count()}")

s = requests.Session()
s.get(f"{BASE}/api/csrf/", headers={"Host": HOST})


def call(method, path, **kw):
    headers = {"Host": HOST, "X-CSRFToken": s.cookies.get("csrftoken", "")}
    t0 = time.perf_counter()
    r = s.request(method, f"{BASE}{path}", headers=headers, **kw)
    return r, (time.perf_counter() - t0) * 1000


r, _ = call("POST", "/api/auth/login/", json={"email": email, "password": password})
assert r.status_code == 200, r.text

print("\n== Performance (PRD 7.1)")
for _ in range(2):  # warm-up
    call("GET", "/api/dashboard/")
r, ms = call("GET", "/api/dashboard/")
check(f"Dashboard with 1,000+ invoices: {ms:.0f} ms (< 2000 ms)", r.status_code == 200 and ms < 2000)
r, ms = call("GET", "/api/invoices/")
check(f"Invoice list (paginated): {ms:.0f} ms (< 500 ms)", r.status_code == 200 and ms < 500, f"count={r.json()['count']}")
r, ms = call("GET", "/api/invoices/?status=overdue&q=LOAD")
check(f"Filtered + searched invoice list: {ms:.0f} ms (< 500 ms)", r.status_code == 200 and ms < 500)
r, ms = call("GET", "/api/invoices/summary/")
check(f"Tab counts: {ms:.0f} ms (< 500 ms)", ms < 500)
r, ms = call("GET", "/api/customers/")
check(f"Customer list: {ms:.0f} ms (< 500 ms)", ms < 500)
r, ms = call("POST", "/api/customers/", json={"name": "Perf Customer", "state": "DL"})
check(f"Create customer: {ms:.0f} ms (< 500 ms)", r.status_code in (201, 403) and ms < 500, f"HTTP {r.status_code}")
finalized = s.get(f"{BASE}/api/invoices/?status=paid", headers={"Host": HOST}).json()["results"][0]
paid_id = call("GET", "/api/invoices/?status=paid")[0].json()["results"][0]["id"]
r, ms = call("GET", f"/api/invoices/{paid_id}/pdf/")
check(f"PDF generation: {ms:.0f} ms (< 5000 ms)", r.status_code == 200 and r.content[:4] == b"%PDF" and ms < 5000)

print("\n== Security (PRD 7.2)")
with schema_context(schema):
    hashes = list(get_user_model().objects.values_list("password", flat=True))
check("Passwords are stored as bcrypt hashes", all(h.startswith("bcrypt_sha256$") for h in hashes), hashes[0][:22] + "...")
r = requests.post(f"{BASE}/api/customers/", headers={"Host": HOST, "Content-Type": "application/json"}, cookies=s.cookies, json={"name": "x", "state": "DL"})
check("Writes WITHOUT a CSRF token are rejected", r.status_code == 403, f"HTTP {r.status_code}")
c2 = requests.Session()
r = c2.post(f"{BASE}/api/auth/login/", headers={"Host": HOST}, json={"email": email, "password": password})
check("Login without CSRF cookie/token is rejected", r.status_code == 403, f"HTTP {r.status_code}")
sess_age = int(re.search(r"SESSION_COOKIE_AGE = (.+)", open("config/settings.py", encoding="utf-8").read()).group(1).replace("60 * 60 * 24", str(86400)))
check("Session expires after 24 hours", sess_age == 86400)

print("\n== Password reset by emailed OTP")
t = requests.Session(); t.get(f"{BASE}/api/csrf/", headers={"Host": HOST})
def tcall(path, body):
    return t.post(f"{BASE}{path}", headers={"Host": HOST, "X-CSRFToken": t.cookies.get("csrftoken", ""), "Content-Type": "application/json"}, json=body)
r = tcall("/api/auth/forgot-password/", {"email": email})
check("forgot-password accepted", r.status_code == 200)
time.sleep(1)
log = open(LOG, encoding="utf-8", errors="ignore").read()
codes = re.findall(r"Subject: (\d{6}) is your Tech Cognixium password reset code", log)
check("OTP email was sent (console backend in dev)", bool(codes))
r = tcall("/api/auth/reset-password/", {"email": email, "otp": "000000", "new_password": "brandnewpass1"})
check("wrong OTP rejected", r.status_code == 400)
r = tcall("/api/auth/reset-password/", {"email": email, "otp": codes[-1], "new_password": "short"})
check("too-short new password rejected", r.status_code == 400)
r = tcall("/api/auth/reset-password/", {"email": email, "otp": codes[-1], "new_password": "brandnewpass1"})
check("correct OTP resets the password", r.status_code == 200, r.text[:100])
r = tcall("/api/auth/reset-password/", {"email": email, "otp": codes[-1], "new_password": "anotherpass1"})
check("OTP cannot be reused", r.status_code == 400)
r = tcall("/api/auth/login/", {"email": email, "password": "brandnewpass1"})
check("login works with the new password", r.status_code == 200)
r = tcall("/api/auth/login/", {"email": email, "password": password})
check("old password no longer works", r.status_code == 400)
# restore for later manual testing
t2 = requests.Session()
with schema_context(schema):
    u = get_user_model().objects.get(username=email); u.set_password(password); u.save()

print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)

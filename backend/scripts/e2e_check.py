"""End-to-end API check of Phase 1 against a running dev server (python scripts/e2e_check.py).

Registers two throw-away tenants and walks the whole PRD: registration, profile, customers, products,
GST invoices (intra / inter state), finalize + numbering, payments, PDF, dashboard, plan limits,
tenant isolation and the (demo) subscription upgrade.
"""
import sys
import time
import uuid
from datetime import date, timedelta

import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
PUBLIC_HOST = "localhost:8000"
RUN = uuid.uuid4().hex[:6]
PASSED, FAILED = [], []


def check(name, cond, extra=""):
    (PASSED if cond else FAILED).append(name)
    print(("  PASS  " if cond else "  FAIL  ") + name + (f"   [{extra}]" if extra and not cond else ""))


class Client:
    """One browser session against one host (tenant)."""

    def __init__(self, host):
        self.host, self.s = host, requests.Session()
        self.s.get(f"{BASE}/api/csrf/", headers={"Host": host})

    def call(self, method, path, **kw):
        headers = {"Host": self.host, "X-CSRFToken": self.s.cookies.get("csrftoken", "")}
        if "json" in kw:
            headers["Content-Type"] = "application/json"
        return self.s.request(method, f"{BASE}{path}", headers=headers, **kw)

    def get(self, p, **kw): return self.call("GET", p, **kw)
    def post(self, p, body=None, **kw): return self.call("POST", p, json=body if body is not None else {}, **kw)
    def patch(self, p, body): return self.call("PATCH", p, json=body)
    def delete(self, p): return self.call("DELETE", p)


def register(name):
    pub = Client(PUBLIC_HOST)
    t0 = time.time()
    r = pub.post("/api/public/register/", {"business_name": name, "email": f"owner@{RUN}.test", "password": "supersecret1"})
    return pub, r, time.time() - t0


print(f"\n== 1. Registration (US-01)   run id {RUN}")
pub = Client(PUBLIC_HOST)
r = pub.post("/api/public/register/", {"business_name": "X", "email": "bad", "password": "short"})
check("validation rejects bad email + short password", r.status_code == 400 and "password" in r.json() and "email" in r.json(), r.text)
r = pub.post("/api/public/register/", {"business_name": "Public", "email": "a@b.co", "password": "supersecret1"})
check("reserved slug 'public' is rejected", r.status_code == 400, r.text)
r = pub.post("/api/public/register/", {"business_name": "अ आ", "email": "a@b.co", "password": "supersecret1"})
check("name that slugifies to empty is rejected", r.status_code == 400, r.text)

nameA, nameB = f"Sharma Traders {RUN}", f"Priya Designs {RUN}"
_, r, secs = register(nameA)
check(f"tenant A registered in {secs:.1f}s -> 201", r.status_code == 201, r.text)
slugA = r.json()["business"]["slug"]
check("subdomain URL returned (AC7)", r.json()["subdomain_url"].startswith(f"http://{slugA}.localhost"), r.text)
_, r, _ = register(nameA)
check("duplicate business name -> 'Business name already taken' (AC6)", r.status_code == 400 and "already taken" in r.text, r.text)
_, r, secs = register(nameB)
check(f"tenant B registered in {secs:.1f}s -> 201", r.status_code == 201, r.text)
slugB = r.json()["business"]["slug"]

A, B = Client(f"{slugA}.localhost:8000"), Client(f"{slugB}.localhost:8000")
print("\n== 2. Auth")
check("tenant info resolves by subdomain", A.get("/api/tenant/").json().get("slug") == slugA)
check("anonymous API access is refused", A.get("/api/customers/").status_code in (401, 403))
r = A.post("/api/auth/login/", {"email": f"owner@{RUN}.test", "password": "wrong-password"})
check("wrong password -> 400", r.status_code == 400)
r = A.post("/api/auth/login/", {"email": f"owner@{RUN}.test", "password": "supersecret1"})
check("login OK", r.status_code == 200 and r.json()["profile_complete"] is False, r.text)
r = B.post("/api/auth/login/", {"email": f"owner@{RUN}.test", "password": "supersecret1"})
check("login B OK", r.status_code == 200)
check("session cookie of A does NOT work on B's host", Client(f"{slugB}.localhost:8000").get("/api/auth/me/").status_code in (401, 403))

print("\n== 3. Profile (US-02)")
r = A.post("/api/invoices/", {"customer": 1, "invoice_date": str(date.today()), "items": []})
check("cannot create invoice with incomplete profile (AC8)", r.status_code == 403 and r.json().get("code") == "profile_incomplete", r.text)
r = A.patch("/api/profile/", {"gstin": "bad"})
check("GSTIN validated (15 chars)", r.status_code == 400 and "gstin" in r.json())
r = A.patch("/api/profile/", {"business_name": nameA, "gstin": "07aabcs1234f1z5", "pan": "aabcs1234f", "state": "DL",
                              "address_line1": "12 Chandni Chowk", "city": "New Delhi", "pincode": "110006",
                              "phone": "9876543210", "email": "owner@sharma.test", "bank_name": "HDFC Bank",
                              "account_holder_name": "Sharma Traders", "account_number": "50100123456789",
                              "ifsc_code": "hdfc0000123", "invoice_prefix": "tc", "default_payment_terms": 15,
                              "default_terms": "Goods once sold will not be taken back."})
p = r.json()
check("profile saved; GSTIN/PAN/IFSC/prefix upper-cased", r.status_code == 200 and p["gstin"] == "07AABCS1234F1Z5"
      and p["pan"] == "AABCS1234F" and p["ifsc_code"] == "HDFC0000123" and p["invoice_prefix"] == "TC", r.text)
check("profile now complete", p["is_complete"] is True)
r = A.patch("/api/profile/", {"invoice_prefix": "TOOLONGPREFIX"})
check("invoice prefix limited to 4 chars (16-char GST invoice number rule)", r.status_code == 400)
import io
from PIL import Image
_buf = io.BytesIO()
Image.new("RGB", (120, 60), (79, 63, 224)).save(_buf, "PNG")
png = _buf.getvalue()
r = requests.post(f"{BASE}/api/profile/logo/", files={"logo": ("logo.png", png, "image/png")},
                  headers={"Host": A.host, "X-CSRFToken": A.s.cookies.get("csrftoken", "")}, cookies=A.s.cookies)
check("PNG logo upload accepted", r.status_code == 200 and r.json()["logo_url"], r.text)
r = requests.post(f"{BASE}/api/profile/logo/", files={"logo": ("evil.png", b"not an image", "image/png")},
                  headers={"Host": A.host, "X-CSRFToken": A.s.cookies.get("csrftoken", "")}, cookies=A.s.cookies)
check("fake image rejected (validated by content)", r.status_code == 400)
r = requests.post(f"{BASE}/api/profile/logo/", files={"logo": ("bad.png", png[:60] + b"garbage" + png[70:], "image/png")},
                  headers={"Host": A.host, "X-CSRFToken": A.s.cookies.get("csrftoken", "")}, cookies=A.s.cookies)
check("corrupt PNG -> clean 400, not a 500", r.status_code == 400, str(r.status_code))
_gif = io.BytesIO(); Image.new("P", (10, 10)).save(_gif, "GIF")
r = requests.post(f"{BASE}/api/profile/logo/", files={"logo": ("x.png", _gif.getvalue(), "image/png")},
                  headers={"Host": A.host, "X-CSRFToken": A.s.cookies.get("csrftoken", "")}, cookies=A.s.cookies)
check("GIF disguised as .png rejected (only PNG/JPG)", r.status_code == 400)
logo_url = A.get("/api/profile/").json()["logo_url"]
_logo = A.get(logo_url)
check("logo is stored in the database and served from tenant A", logo_url.startswith("/api/logo/") and _logo.status_code == 200
      and _logo.headers["Content-Type"] == "image/png" and "immutable" in _logo.headers["Cache-Control"], logo_url)
check("logo NOT served on tenant B's host", B.get(logo_url).status_code == 404)


def upload_logo(raw, name="logo.png"):
    return requests.post(f"{BASE}/api/profile/logo/", files={"logo": (name, raw, "image/png")},
                         headers={"Host": A.host, "X-CSRFToken": A.s.cookies.get("csrftoken", "")}, cookies=A.s.cookies)


_big = io.BytesIO(); Image.new("RGB", (2400, 1200), (20, 120, 60)).save(_big, "PNG")
r = upload_logo(_big.getvalue(), "big.png")
_shrunk = Image.open(io.BytesIO(A.get(r.json()["logo_url"]).content)) if r.status_code == 200 else None
check("oversized logo is shrunk before storing (<= 800x400)", _shrunk is not None and _shrunk.size[0] <= 800 and _shrunk.size[1] <= 400,
      str(_shrunk and _shrunk.size))
r = upload_logo(png)
check("original logo re-uploaded", r.status_code == 200)
logo_url = r.json()["logo_url"]

print("\n== 4. Customers & products (US-03, US-04)")
def cust(name, state, gstin="", **kw): return A.post("/api/customers/", {"name": name, "state": state, "gstin": gstin, "phone": "9800000000", **kw})
c_intra = cust("Ramesh Electronics", "DL", "07abcde1234f1z5", phone="9811111111", email="ramesh@example.com").json()
c_inter = cust("Suresh Cloth House", "MH", "27abcde1234f1z5").json()
check("customer GSTIN upper-cased", c_intra["gstin"] == "07ABCDE1234F1Z5")
check("customer with a GSTIN and no explicit type is B2B", c_intra["customer_type"] == "b2b" and c_inter["customer_type"] == "b2b")

print("\n== 4b. Customer rules (phone mandatory, email optional, GSTIN mandatory for B2B only)")
G = "07ABCDE1234F1Z5"
for ctype, extra in (("b2c", {}), ("b2b", {"gstin": G})):
    r = A.post("/api/customers/", {"name": "No Phone", "state": "DL", "customer_type": ctype, **extra})
    check(f"{ctype.upper()}: phone is mandatory", r.status_code == 400 and "Phone number is required" in r.text, r.text)
r = A.post("/api/customers/", {"name": "Blank Phone", "state": "DL", "customer_type": "b2c", "phone": "  "})
check("blank / whitespace phone rejected", r.status_code == 400 and "phone" in r.json(), r.text)
r = A.post("/api/customers/", {"name": "Bad Phone", "state": "DL", "customer_type": "b2c", "phone": "abc"})
check("malformed phone rejected", r.status_code == 400 and "phone" in r.json(), r.text)
r = A.post("/api/customers/", {"name": "No GST B2B", "state": "DL", "customer_type": "b2b", "phone": "9800000001"})
check("B2B: GST number is mandatory", r.status_code == 400 and "GST number is required for B2B" in r.text, r.text)
r = A.post("/api/customers/", {"name": "Short GST B2B", "state": "DL", "customer_type": "b2b", "phone": "9800000001", "gstin": "123"})
check("B2B: a malformed GST number is rejected", r.status_code == 400 and "gstin" in r.json(), r.text)
r1 = A.post("/api/customers/", {"name": "Walk-in B2C", "state": "DL", "customer_type": "b2c", "phone": "9800000002"})
check("B2C: GST number is optional (and so is email)", r1.status_code == 201 and r1.json()["customer_type"] == "b2c" and r1.json()["email"] == "", r1.text)
r2 = A.post("/api/customers/", {"name": "B2C With GST", "state": "DL", "customer_type": "b2c", "phone": "9800000003", "gstin": G.lower()})
check("B2C may still give a GST number (stored upper-cased)", r2.status_code == 201 and r2.json()["gstin"] == G, r2.text)
r3 = A.post("/api/customers/", {"name": "B2B With Email", "state": "DL", "customer_type": "b2b", "phone": "9800000004", "gstin": G, "email": "ap@b2b.example"})
check("B2B: email is optional but accepted", r3.status_code == 201 and r3.json()["email"] == "ap@b2b.example", r3.text)
r = A.post("/api/customers/", {"name": "Bad Email", "state": "DL", "customer_type": "b2c", "phone": "9800000005", "email": "not-an-email"})
check("a provided email must still be valid", r.status_code == 400 and "email" in r.json(), r.text)
r = A.patch(f"/api/customers/{r1.json()['id']}/", {"phone": ""})
check("editing: phone cannot be cleared", r.status_code == 400 and "phone" in r.json(), r.text)
r = A.patch(f"/api/customers/{r3.json()['id']}/", {"gstin": ""})
check("editing: a B2B customer's GST number cannot be cleared", r.status_code == 400 and "gstin" in r.json(), r.text)
r = A.patch(f"/api/customers/{r3.json()['id']}/", {"customer_type": "b2c", "gstin": ""})
check("editing: switching B2B -> B2C lets the GST number go", r.status_code == 200 and r.json()["customer_type"] == "b2c", r.text)
for made in (r1, r2, r3):  # free their slots again so the plan-limit section below counts only what it expects
    A.delete(f"/api/customers/{made.json()['id']}/")
check("customer requires state", A.post("/api/customers/", {"name": "No State"}).status_code == 400)
check("search is case-insensitive on name / gstin / phone",
      A.get("/api/customers/?q=ramesh").json()["count"] == 1 and A.get("/api/customers/?q=9811").json()["count"] == 1
      and A.get("/api/customers/?q=27abcde").json()["count"] == 1)
r = A.post("/api/products/", {"name": "LED Monitor", "hsn_sac_code": "8528", "unit": "pcs", "selling_price": "10000", "gst_rate": 18})
prod = r.json()
check("product created", r.status_code == 201, r.text)
check("GST rate outside 0/5/12/18/28 rejected (AC2)", A.post("/api/products/", {"name": "x", "selling_price": 1, "gst_rate": 7, "unit": "pcs"}).status_code == 400)
check("product search on HSN", A.get("/api/products/?q=8528").json()["count"] == 1)

print("\n== 5. Invoices (US-05)")
today = date.today()
body = lambda c: {"customer": c["id"], "invoice_date": str(today), "items": [
    {"item_name": prod["name"], "hsn_sac_code": "8528", "unit": "pcs", "quantity": 2, "unit_price": "10000", "discount_percent": 10, "gst_rate": 18},
    {"item_name": "HDMI cable", "unit": "pcs", "quantity": 1, "unit_price": "250.50", "gst_rate": 5}]}
r = A.post("/api/invoices/", body(c_intra))
inv1 = r.json()
check("intra-state draft: CGST+SGST, no IGST", r.status_code == 201 and inv1["supply_type"] == "intrastate"
      and inv1["igst_amount"] == "0.00" and inv1["cgst_amount"] == inv1["sgst_amount"] != "0.00", r.text)
check("taxable 18250.50, CGST=SGST=1626.26, round-off -0.02, grand total 21503.00",
      inv1["taxable_amount"] == "18250.50" and inv1["cgst_amount"] == "1626.26" and inv1["round_off"] == "-0.02"
      and inv1["grand_total"] == "21503.00", str((inv1["taxable_amount"], inv1["cgst_amount"], inv1["round_off"], inv1["grand_total"])))
check("draft has NO invoice number yet (gapless series)", inv1["invoice_number"] is None and inv1["status"] == "draft")
check("due date defaults to profile payment terms (15 days)", inv1["due_date"] == str(today + timedelta(days=15)))
r = A.post("/api/invoices/", body(c_inter))
inv2 = r.json()
check("inter-state draft: IGST only", inv2["supply_type"] == "interstate" and inv2["cgst_amount"] == "0.00" and inv2["igst_amount"] != "0.00", r.text)
check("same taxable value both ways", inv1["taxable_amount"] == inv2["taxable_amount"])
r = A.post("/api/invoices/", {**body(c_inter), "supply_type": "export"})
check("export -> zero-rated", r.json()["igst_amount"] == "0.00" and r.json()["cgst_amount"] == "0.00", r.text)
check("tampered totals are ignored (server recalculates)", A.post("/api/invoices/", {**body(c_intra), "grand_total": "1"}).json()["grand_total"] == inv1["grand_total"])
check("PDF blocked for drafts (AC8)", A.get(f"/api/invoices/{inv1['id']}/pdf/").status_code == 409)
r = A.patch(f"/api/invoices/{inv1['id']}/", {**body(c_inter)})
check("draft is editable; changing customer flips supply type", r.status_code == 200 and r.json()["supply_type"] == "interstate", r.text)
r = A.patch(f"/api/invoices/{inv1['id']}/", {**body(c_intra)})
r = A.post(f"/api/invoices/{inv1['id']}/finalize/")
f1 = r.json()
check("finalize -> INV number in {PREFIX}/{FY}/001 (AC7)", r.status_code == 200 and f1["invoice_number"] == "TC/2026-27/001", r.text)
check("finalized status 'sent'", f1["status"] == "sent" and f1["amount_in_words"].startswith("Rupees"))
check("finalized invoice is locked (AC8)", A.patch(f"/api/invoices/{inv1['id']}/", body(c_intra)).status_code == 409)
check("finalized invoice cannot be deleted", A.delete(f"/api/invoices/{inv1['id']}/").status_code == 409)
_issued_logo = A.get(f"/api/invoices/{inv1['id']}/").json()["bill_from"]["logo_url"]
check("finalized invoice carries the logo it was issued with", _issued_logo == logo_url and A.get(_issued_logo).status_code == 200, str(_issued_logo))
_other = io.BytesIO(); Image.new("RGB", (90, 90), (200, 30, 30)).save(_other, "PNG")
_new_url = upload_logo(_other.getvalue(), "other.png").json()["logo_url"]
check("replacing the logo gives a new url", _new_url != logo_url)
check("...but the issued invoice still shows its original logo",
      A.get(f"/api/invoices/{inv1['id']}/").json()["bill_from"]["logo_url"] == logo_url and A.get(logo_url).status_code == 200)
f2 = A.post(f"/api/invoices/{inv2['id']}/finalize/").json()
check("second invoice gets 002 (sequential)", f2["invoice_number"] == "TC/2026-27/002", f2.get("invoice_number"))
A.patch("/api/profile/", {"state": "DL", "address_line1": "CHANGED ADDRESS"})
check("issued invoice keeps its snapshot after profile edit", A.get(f"/api/invoices/{inv1['id']}/").json()["bill_from"]["address_line1"] == "12 Chandni Chowk")
r = A.get(f"/api/invoices/{inv1['id']}/pdf/")
check("PDF downloads, is a real PDF, named by number (AC7)", r.status_code == 200 and r.content[:4] == b"%PDF"
      and "TC-2026-27-001.pdf" in r.headers.get("Content-Disposition", ""), r.text[:200])
open("scripts/_sample_invoice.pdf", "wb").write(r.content)

print("\n== 6. Payments (US-07)")
tot = float(f1["grand_total"])
r = A.post(f"/api/invoices/{inv1['id']}/payments/", {"amount": "5000", "payment_date": str(today), "mode": "upi", "reference": "UPI123"})
check("partial payment -> 'partial', balance auto", r.json()["status"] == "partial" and float(r.json()["balance_due"]) == tot - 5000, r.text)
check("cannot overpay", A.post(f"/api/invoices/{inv1['id']}/payments/", {"amount": str(tot), "payment_date": str(today), "mode": "cash"}).status_code == 400)
r = A.post(f"/api/invoices/{inv1['id']}/payments/", {"amount": str(tot - 5000), "payment_date": str(today), "mode": "bank_transfer"})
check("mark as paid -> 'paid', balance 0", r.json()["status"] == "paid" and float(r.json()["balance_due"]) == 0, r.text)
pid = r.json()["payments"][0]["id"]
r = A.delete(f"/api/invoices/{inv1['id']}/payments/{pid}/")
check("undoing a payment recomputes status", r.status_code == 200 and r.json()["status"] == "partial", r.text)
past = A.post("/api/invoices/", {**body(c_intra), "invoice_date": str(today - timedelta(days=40)), "due_date": str(today - timedelta(days=10))}).json()
A.post(f"/api/invoices/{past['id']}/finalize/")
check("overdue is auto-applied when due date passed (AC4)", A.get(f"/api/invoices/{past['id']}/").json()["status"] == "overdue")
check("list filter: overdue", A.get("/api/invoices/?status=overdue").json()["count"] == 1)
check("list filter: pending / draft / paid", A.get("/api/invoices/?status=pending").json()["count"] >= 1
      and A.get("/api/invoices/?status=draft").json()["count"] >= 1 and A.get("/api/invoices/?status=paid").json()["count"] == 0)
r = A.post(f"/api/invoices/{f2['id']}/cancel/")
check("cancel finalized invoice", r.json()["status"] == "cancelled")
check("cancelled invoice cannot take payments", A.post(f"/api/invoices/{f2['id']}/payments/", {"amount": "1", "payment_date": str(today), "mode": "cash"}).status_code == 409)

print("\n== 7. Dashboard (US-08)")
d = A.get("/api/dashboard/").json()
check("dashboard: revenue, counts, outstanding, recent, top customers, trend",
      all(k in d for k in ("revenue", "counts", "outstanding", "recent_invoices", "top_customers", "trend")) and len(d["trend"]) == 6, str(d)[:300])
check("cancelled invoices excluded from revenue", d["counts"]["total"] == 2, str(d["counts"]))
check("outstanding receivables > 0", float(d["outstanding"]) > 0)

print("\n== 8. Tenant isolation (US-01 DoD)")
check("B sees none of A's customers", B.get("/api/customers/").json()["count"] == 0)
check("B sees none of A's invoices", B.get("/api/invoices/").json()["count"] == 0)
check("B cannot open A's invoice by id", B.get(f"/api/invoices/{inv1['id']}/").status_code == 404)
check("B cannot download A's PDF", B.get(f"/api/invoices/{inv1['id']}/pdf/").status_code == 404)
check("B's dashboard is empty", float(B.get("/api/dashboard/").json()["revenue"]["this_month"]) == 0)

print("\n== 8b. Payment details (list / view / edit / delete / receipt)")
pl = A.get("/api/payments/").json()
check("payments list returns every recorded payment", pl["count"] >= 1, str(pl)[:200])
pay = pl["results"][0]
check("each payment carries its receipt no, invoice no, customer, mode",
      pay["receipt_number"].startswith("PR-") and pay["invoice_number"] == f1["invoice_number"]
      and pay["customer_name"] == "Ramesh Electronics" and pay["mode_label"] == "UPI", str(pay))
sm = A.get("/api/payments/summary/").json()
check("summary totals the payments", sm["count"] == pl["count"] and float(sm["total"]) == 5000.0, str(sm))
check("view details: one payment by id", A.get(f"/api/payments/{pay['id']}/").json()["id"] == pay["id"])
check("filter by mode", A.get("/api/payments/?mode=upi").json()["count"] == 1 and A.get("/api/payments/?mode=cash").json()["count"] == 0)
check("search by customer / invoice no / receipt no",
      A.get("/api/payments/?q=ramesh").json()["count"] == 1 and A.get(f"/api/payments/?q={f1['invoice_number']}").json()["count"] == 1
      and A.get(f"/api/payments/?q={pay['receipt_number']}").json()["count"] == 1 and A.get("/api/payments/?q=zzz").json()["count"] == 0)
r = A.patch(f"/api/payments/{pay['id']}/", {"amount": "6000", "mode": "bank_transfer", "reference": "REF-77", "notes": "corrected"})
check("edit payment: amount / mode / reference saved", r.status_code == 200 and float(r.json()["amount"]) == 6000.0
      and r.json()["mode"] == "bank_transfer" and r.json()["reference"] == "REF-77", r.text)
check("edit payment: invoice paid total + balance recomputed", float(r.json()["invoice_paid"]) == 6000.0
      and float(r.json()["invoice_balance"]) == tot - 6000 and r.json()["invoice_status"] == "partial", r.text)
r = A.patch(f"/api/payments/{pay['id']}/", {"amount": "9"})
check("edit payment: fields not sent are left alone", r.json()["reference"] == "REF-77" and r.json()["notes"] == "corrected", r.text)
check("edit payment: cannot exceed the invoice total", A.patch(f"/api/payments/{pay['id']}/", {"amount": str(tot + 1)}).status_code == 400)
check("edit payment: zero / negative amount rejected", A.patch(f"/api/payments/{pay['id']}/", {"amount": "0"}).status_code == 400)
r = A.patch(f"/api/payments/{pay['id']}/", {"amount": str(tot)})
check("edit payment up to the full total marks the invoice Paid", r.status_code == 200 and r.json()["invoice_status"] == "paid", r.text)
r = A.patch(f"/api/payments/{pay['id']}/", {"amount": "6000"})
check("...and back down reverts it to Partially paid", r.json()["invoice_status"] == "partial", r.text)
rc = A.get(f"/api/payments/{pay['id']}/receipt/")
check("generate receipt: a real PDF named by receipt no", rc.status_code == 200 and rc.content[:4] == b"%PDF"
      and f"{pay['receipt_number']}.pdf" in rc.headers.get("Content-Disposition", ""), rc.text[:150])
open("scripts/_sample_receipt.pdf", "wb").write(rc.content)
check("tenant B cannot see / open / change A's payments", B.get("/api/payments/").json()["count"] == 0
      and B.get(f"/api/payments/{pay['id']}/").status_code == 404 and B.get(f"/api/payments/{pay['id']}/receipt/").status_code == 404
      and B.patch(f"/api/payments/{pay['id']}/", {"amount": "1"}).status_code == 404 and B.delete(f"/api/payments/{pay['id']}/").status_code == 404)
r = A.delete(f"/api/payments/{pay['id']}/")
check("delete payment (undo)", r.status_code == 204)
inv_after = A.get(f"/api/invoices/{inv1['id']}/").json()
check("...the invoice goes back to Sent with nothing paid", inv_after["status"] == "sent" and float(inv_after["amount_paid"]) == 0, str(inv_after["status"]))
check("...and the payment is gone from the list", A.get(f"/api/payments/{pay['id']}/").status_code == 404)

print("\n== 8c. Send to WhatsApp / Send to Email")
import re as _re
from urllib.parse import unquote
sh = A.post(f"/api/invoices/{inv1['id']}/share/")
check("share: wa.me link addressed to the customer's phone (+91 added)", sh.status_code == 200
      and sh.json()["whatsapp_url"].startswith("https://wa.me/919811111111?text="), sh.text[:300])
msg = unquote(sh.json()["whatsapp_url"].split("?text=", 1)[1])
check("share: message names the customer, invoice no, amount and the PDF link",
      "Ramesh Electronics" in msg and f1["invoice_number"] in msg and "Amount: \u20b9" in msg and sh.json()["url"] in msg, msg)
link_path = _re.sub(r"^https?://[^/]+", "", sh.json()["url"])
anon = requests.Session()
pdf_resp = anon.get(f"{BASE}{link_path}", headers={"Host": A.host})
check("the signed link opens the PDF with NO login", pdf_resp.status_code == 200 and pdf_resp.content[:4] == b"%PDF", str(pdf_resp.status_code))
check("the same link does NOT work on another business's host", anon.get(f"{BASE}{link_path}", headers={"Host": B.host}).status_code == 404)
check("a tampered link is rejected", anon.get(f"{BASE}{link_path[:-3]}xx/", headers={"Host": A.host}).status_code == 404)
draft_for_share = A.post("/api/invoices/", body(c_intra)).json()
check("share / email are blocked for a draft (finalize first)", A.post(f"/api/invoices/{draft_for_share['id']}/share/").status_code == 409
      and A.post(f"/api/invoices/{draft_for_share['id']}/send-email/").status_code == 409)
check("...and for a cancelled invoice", A.post(f"/api/invoices/{f2['id']}/share/").status_code == 409
      and A.post(f"/api/invoices/{f2['id']}/send-email/").status_code == 409)
em = A.post(f"/api/invoices/{inv1['id']}/send-email/")
check("send to email: sent to the customer's address", em.status_code == 200 and em.json()["sent_to"] == "ramesh@example.com", em.text)
no_email = A.post("/api/invoices/", body(c_inter)).json()
A.post(f"/api/invoices/{no_email['id']}/finalize/")
r = A.post(f"/api/invoices/{no_email['id']}/send-email/")
check("send to email: a clear error when the customer has no email", r.status_code == 400 and r.json()["code"] == "no_email", r.text)
check("send to WhatsApp still works for that customer (phone is mandatory)", A.post(f"/api/invoices/{no_email['id']}/share/").status_code == 200)
check("tenant B cannot share A's invoice", B.post(f"/api/invoices/{inv1['id']}/share/").status_code == 404
      and B.post(f"/api/invoices/{inv1['id']}/send-email/").status_code == 404)

print("\n== 9. Plan limits (section 6)")
for i in range(10 - A.get("/api/subscription/").json()["usage"]["customers"]):  # fill up to the Free limit of 10
    cust(f"Filler {i}", "DL")
r = cust("One too many", "DL")
check("11th customer blocked BEFORE creation on Free plan (AC5)", r.status_code == 403 and r.json()["code"] == "plan_limit" and r.json()["limit"] == 10, r.text)
sub = A.get("/api/subscription/").json()
check("usage endpoint reports 10/10 customers", sub["usage"]["customers"] == 10 and sub["plan"] == "free")
c0 = A.get("/api/customers/?q=Filler").json()["results"][0]
A.delete(f"/api/customers/{c0['id']}/")
check("soft delete frees a slot (is_active=False, row kept)", cust("Now fits", "DL").status_code == 201)
check("customer with invoices is soft-deleted, never hard-deleted", A.delete(f"/api/customers/{c_intra['id']}/").status_code == 204
      and A.get(f"/api/invoices/{inv1['id']}/").status_code == 200)
A.post(f"/api/customers/{c_intra['id']}/restore/")

print("\n== 10. Subscription (Razorpay, demo mode)")
r = A.post("/api/subscription/checkout/", {"plan": "starter"})
co = r.json()
check("checkout creates a subscription", r.status_code == 200 and co["mode"] in ("mock", "razorpay"), r.text)
if co["mode"] == "mock":
    r = A.post("/api/subscription/verify/", {"plan": "starter", "razorpay_subscription_id": co["subscription_id"]})
    check("verify activates Starter", r.status_code == 200 and r.json()["plan"] == "starter" and r.json()["receipts"], r.text)
    check("limits raised to Starter (100 customers)", r.json()["limits"]["customers"] == 100)
    check("customer #11 now allowed", cust("Eleventh", "DL").status_code == 201)
    rid = r.json()["receipts"][0]["id"]
    rr = A.get(f"/api/subscription/receipts/{rid}/pdf/")
    check("receipt PDF", rr.status_code == 200 and rr.content[:4] == b"%PDF")
    check("cannot fake an upgrade with a made-up id", B.post("/api/subscription/verify/", {"plan": "pro", "razorpay_subscription_id": "sub_fake"}).status_code in (400, 503))
    check("tenant B is still on Free", B.get("/api/subscription/").json()["plan"] == "free")
    r = A.post("/api/subscription/cancel/")
    check("cancel keeps plan until period end", r.json()["cancel_at_period_end"] is True and r.json()["plan"] == "starter")

print("\n== 11. Password reset (OTP)")
r = A.post("/api/auth/forgot-password/", {"email": "nobody@nowhere.test"})
check("forgot-password never reveals whether the email exists", r.status_code == 200)
r = A.post("/api/auth/reset-password/", {"email": f"owner@{RUN}.test", "otp": "000000", "new_password": "newpassword1"})
check("wrong OTP rejected", r.status_code == 400)

print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
if FAILED:
    print("FAILED:", *FAILED, sep="\n  - ")
    sys.exit(1)

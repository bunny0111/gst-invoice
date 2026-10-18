"""Sharing an invoice with a customer: WhatsApp (wa.me link) and email (PDF attached).

Both put a link to the invoice PDF in the message. The link is a SIGNED token (no login needed for the
customer) that is bound to the tenant's schema - invoice ids repeat across tenants, so without the schema
in the signed payload a token from one business could be replayed against another.
"""
import re
from urllib.parse import quote

from django.core import signing

from .templatetags.billing_extras import inr

SHARE_SALT = "invoice-share-link"
SHARE_MAX_AGE = 60 * 60 * 24 * 60  # links stay valid for 60 days


def make_share_token(invoice_id: int, schema_name: str) -> str:
    return signing.dumps({"i": invoice_id, "s": schema_name}, salt=SHARE_SALT)


def read_share_token(token: str, schema_name: str) -> int | None:
    """Invoice id for a valid, unexpired token issued by THIS tenant; otherwise None."""
    try:
        data = signing.loads(token, salt=SHARE_SALT, max_age=SHARE_MAX_AGE)
    except signing.BadSignature:  # includes SignatureExpired
        return None
    if not isinstance(data, dict) or data.get("s") != schema_name or not isinstance(data.get("i"), int):
        return None
    return data["i"]


def share_url(request, invoice_id: int) -> str:
    token = make_share_token(invoice_id, request.tenant.schema_name)
    return request.build_absolute_uri(f"/share/invoice/{token}/")


def whatsapp_number(phone: str) -> str:
    """Digits-only international number for wa.me. A bare 10-digit (or 0-prefixed) Indian number gets +91;
    anything already carrying a country code is left alone."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10:
        digits = "91" + digits
    return digits


def invoice_message(invoice, business_name: str, link: str) -> str:
    greeting = f"Hello {invoice.customer.name},"
    return (
        f"{greeting}\n\n"
        f"Your invoice {invoice.invoice_number} from {business_name} is ready.\n"
        f"Amount: ₹{inr(invoice.grand_total)}\n"
        f"Due date: {invoice.due_date.strftime('%d %b %Y')}\n\n"
        f"View / download the PDF: {link}\n\n"
        f"Thank you for your business!"
    )


def whatsapp_url(phone: str, message: str) -> str:
    return f"https://wa.me/{whatsapp_number(phone)}?text={quote(message)}"

"""PDF invoice generation - WeasyPrint rendering an HTML template (PRD US-06)."""
import base64
import mimetypes
from urllib.parse import quote, urlencode

from django.core.files.storage import default_storage
from django.template.loader import render_to_string

from common.api import ApiError
from common.gst import ACCOUNT_TYPES, PAYMENT_MODES, STATE_GST_CODES, STATE_NAMES
from common.words import amount_in_words

from .services import business_snapshot, customer_snapshot


def _image_data_uri(image_id) -> str | None:
    from accounts.models import LogoImage

    image = LogoImage.objects.filter(pk=image_id).first() if image_id else None
    return f"data:{image.content_type};base64,{base64.b64encode(bytes(image.data)).decode()}" if image else None


def _logo_data_uri(seller: dict) -> str | None:
    if seller.get("logo_id"):
        return _image_data_uri(seller["logo_id"])
    name = seller.get("logo")  # legacy snapshot: a file under MEDIA_ROOT (may be gone on an ephemeral disk)
    if not name:
        return None
    try:
        with default_storage.open(name, "rb") as fh:
            data = fh.read()
    except (FileNotFoundError, OSError):
        return None
    mime = mimetypes.guess_type(name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def _tax_summary(items) -> list[dict]:
    """One row per GST rate: taxable value and the CGST/SGST/IGST on it (the HSN-wise tax box)."""
    rows: dict = {}
    for it in items:
        r = rows.setdefault(it.gst_rate, {"rate": it.gst_rate, "taxable": 0, "cgst": 0, "sgst": 0, "igst": 0})
        r["taxable"] += it.taxable_amount
        r["cgst"] += it.cgst_amount
        r["sgst"] += it.sgst_amount
        r["igst"] += it.igst_amount
    return [rows[k] for k in sorted(rows)]


def upi_payment_link(seller: dict, invoice) -> str | None:
    """upi://pay link for the amount still due - any UPI app (GPay, PhonePe, Paytm, BHIM) opens it pre-filled."""
    upi = seller.get("upi_id")
    if not upi or invoice.status in ("cancelled", "paid", "draft") or invoice.balance_due <= 0:
        return None
    params = {"pa": upi, "pn": (seller.get("account_holder_name") or seller.get("business_name") or "")[:50],
              "am": f"{invoice.balance_due:.2f}", "cu": "INR", "tn": f"Invoice {invoice.invoice_number}"[:50]}
    return "upi://pay?" + urlencode(params, safe="@/", quote_via=quote)  # UPI apps expect a literal "@"


def _payment_qr(seller: dict, invoice) -> str | None:
    """The QR printed under the bank details: the business's own uploaded QR if it has one, otherwise one we
    generate from its UPI ID with the balance due filled in."""
    uploaded = _image_data_uri(seller.get("payment_qr_id"))
    if uploaded:
        return uploaded
    link = upi_payment_link(seller, invoice)
    if not link:
        return None
    import segno

    return segno.make(link, error="m").svg_data_uri(scale=4, border=1, dark="#1e1b3a")


def _payment_terms(invoice) -> str:
    days = (invoice.due_date - invoice.invoice_date).days if invoice.due_date and invoice.invoice_date else 0
    return "Due on receipt" if days <= 0 else f"Net {days} days"


def render_invoice_pdf(invoice, profile) -> bytes:
    try:
        from weasyprint import HTML
    except OSError:  # Pango/GTK missing - see README
        raise ApiError("The PDF engine is not available on this server.", "pdf_unavailable", 503)

    seller = invoice.business_snapshot or business_snapshot(profile)
    buyer = invoice.customer_snapshot or customer_snapshot(invoice.customer)
    items = list(invoice.items.all())
    html = render_to_string("billing/invoice_pdf.html", {
        "invoice": invoice,
        "items": items,
        "tax_summary": _tax_summary(items),
        "payment_terms": _payment_terms(invoice),
        "seller": seller,
        "buyer": buyer,
        "seller_state_code": STATE_GST_CODES.get(seller.get("state"), ""),
        "buyer_state_code": STATE_GST_CODES.get(buyer.get("state"), ""),
        "pos_state_code": STATE_GST_CODES.get(invoice.place_of_supply, ""),
        "logo": _logo_data_uri(seller),
        "signature": _image_data_uri(seller.get("signature_id")),
        "payment_qr": _payment_qr(seller, invoice),
        "account_type": dict(ACCOUNT_TYPES).get(seller.get("account_type"), ""),
        "registered": bool(seller.get("gstin")),
        "amount_in_words": amount_in_words(invoice.grand_total),
        "place_of_supply_name": STATE_NAMES.get(invoice.place_of_supply, ""),
        "is_intra": invoice.supply_type == "intrastate",
        "is_export": invoice.supply_type == "export",
        "status": invoice.display_status,
    })
    return HTML(string=html).write_pdf()


def render_receipt_pdf(payment, profile) -> bytes:
    """A one-page receipt for a single recorded payment (the "Generate receipt" action)."""
    try:
        from weasyprint import HTML
    except OSError:
        raise ApiError("The PDF engine is not available on this server.", "pdf_unavailable", 503)

    invoice = payment.invoice
    seller = invoice.business_snapshot or business_snapshot(profile)
    buyer = invoice.customer_snapshot or customer_snapshot(invoice.customer)
    html = render_to_string("billing/receipt_pdf.html", {
        "payment": payment,
        "invoice": invoice,
        "seller": seller,
        "buyer": buyer,
        "logo": _logo_data_uri(seller),
        "amount_in_words": amount_in_words(payment.amount),
        "mode_label": dict(PAYMENT_MODES).get(payment.mode, payment.mode),
    })
    return HTML(string=html).write_pdf()

"""PDF invoice generation - WeasyPrint rendering an HTML template (PRD US-06)."""
import base64
import mimetypes

from django.core.files.storage import default_storage
from django.template.loader import render_to_string

from common.api import ApiError
from common.gst import PAYMENT_MODES, STATE_GST_CODES, STATE_NAMES
from common.words import amount_in_words

from .services import business_snapshot, customer_snapshot


def _logo_data_uri(seller: dict) -> str | None:
    from accounts.models import LogoImage

    if seller.get("logo_id"):
        image = LogoImage.objects.filter(pk=seller["logo_id"]).first()
        if image:
            return f"data:{image.content_type};base64,{base64.b64encode(bytes(image.data)).decode()}"
        return None
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

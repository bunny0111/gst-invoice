"""PDF invoice generation - WeasyPrint rendering an HTML template (PRD US-06)."""
import base64
import mimetypes

from django.core.files.storage import default_storage
from django.template.loader import render_to_string

from common.api import ApiError
from common.gst import STATE_NAMES
from common.words import amount_in_words

from .services import business_snapshot, customer_snapshot


def _logo_data_uri(name: str | None) -> str | None:
    if not name:
        return None
    try:
        with default_storage.open(name, "rb") as fh:
            data = fh.read()
    except (FileNotFoundError, OSError):
        return None
    mime = mimetypes.guess_type(name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def render_invoice_pdf(invoice, profile) -> bytes:
    try:
        from weasyprint import HTML
    except OSError:  # Pango/GTK missing - see README
        raise ApiError("The PDF engine is not available on this server.", "pdf_unavailable", 503)

    seller = invoice.business_snapshot or business_snapshot(profile)
    buyer = invoice.customer_snapshot or customer_snapshot(invoice.customer)
    html = render_to_string("billing/invoice_pdf.html", {
        "invoice": invoice,
        "items": invoice.items.all(),
        "seller": seller,
        "buyer": buyer,
        "logo": _logo_data_uri(seller.get("logo")),
        "amount_in_words": amount_in_words(invoice.grand_total),
        "place_of_supply_name": STATE_NAMES.get(invoice.place_of_supply, ""),
        "is_intra": invoice.supply_type == "intrastate",
        "is_export": invoice.supply_type == "export",
        "status": invoice.display_status,
    })
    return HTML(string=html).write_pdf()

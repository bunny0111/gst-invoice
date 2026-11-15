"""Invoice workflow: create / edit drafts, finalize (numbering + snapshot), cancel, payments."""
from dataclasses import asdict
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from common.api import ApiError
from common.gst import STATE_NAMES

from . import calc, numbering
from .models import Customer, Invoice, InvoiceLineItem, Payment

MAX_INVOICE_NUMBER_LENGTH = 16  # GST rule: the serial number may not exceed 16 characters


# --------------------------------------------------------------------------- snapshots
def business_snapshot(profile) -> dict:
    return {
        "business_name": profile.business_name, "gstin": profile.gstin, "pan": profile.pan,
        "state": profile.state, "state_name": STATE_NAMES.get(profile.state, ""),
        "address_line1": profile.address_line1, "address_line2": profile.address_line2,
        "city": profile.city, "pincode": profile.pincode, "phone": profile.phone, "email": profile.email,
        "logo": None, "logo_id": profile.logo_image_id,  # "logo" = legacy file name, only on older snapshots
        "website": profile.website, "business_type": profile.business_type, "business_nature": profile.business_nature,
        "signatory_name": profile.signatory_name, "signature_id": profile.signature_image_id,
        "bank_name": profile.bank_name, "bank_branch": profile.bank_branch, "account_type": profile.account_type,
        "account_holder_name": profile.account_holder_name,
        "account_number": profile.account_number, "ifsc_code": profile.ifsc_code,
        "upi_id": profile.upi_id, "payment_qr_id": profile.payment_qr_image_id,
        "payment_instructions": profile.payment_instructions,
    }


def customer_snapshot(customer: Customer) -> dict:
    return {
        "name": customer.name, "gstin": customer.gstin, "email": customer.email, "phone": customer.phone,
        "address": customer.address, "city": customer.city, "pincode": customer.pincode,
        "state": customer.state, "state_name": STATE_NAMES.get(customer.state, ""),
    }


# --------------------------------------------------------------------------- create / update
def resolve_supply_type(profile, customer: Customer, requested: str) -> str:
    if requested == calc.EXPORT:
        return calc.EXPORT
    return calc.detect_supply_type(profile.state, customer.state)


def _without_gst(items: list[dict]) -> list[dict]:
    """A seller without a GSTIN is not registered under GST: it may not collect GST, so every line is 0%."""
    return [{**item, "gst_rate": 0} for item in items]


def _write_items_and_totals(invoice: Invoice, items: list[dict], profile) -> None:
    if not profile.is_gst_registered:
        items = _without_gst(items)
    totals = calc.calculate_invoice(items, invoice.supply_type)
    InvoiceLineItem.objects.bulk_create([
        InvoiceLineItem(
            invoice=invoice, position=pos,
            item_name=item["item_name"], description=item.get("description", ""),
            hsn_sac_code=item.get("hsn_sac_code", ""), unit=item.get("unit", "pcs"),
            unit_price=item["unit_price"], gst_rate=item["gst_rate"],
            quantity=item["quantity"], discount_percent=item.get("discount_percent", 0),
            **asdict(line),
        )
        for pos, (item, line) in enumerate(zip(items, totals.lines))
    ])
    for field in ("subtotal", "discount_total", "taxable_amount", "cgst_amount", "sgst_amount",
                  "igst_amount", "round_off", "grand_total"):
        setattr(invoice, field, getattr(totals, field))


@transaction.atomic
def create_invoice(data: dict, user, profile) -> Invoice:
    customer = data["customer"]
    invoice_date = data["invoice_date"]
    invoice = Invoice(
        customer=customer, invoice_date=invoice_date,
        due_date=data.get("due_date") or invoice_date + timedelta(days=profile.default_payment_terms),
        supply_type=resolve_supply_type(profile, customer, data.get("supply_type", "auto")),
        place_of_supply=customer.state,
        notes=data["notes"] if "notes" in data else profile.default_notes,
        terms=data["terms"] if "terms" in data else profile.default_terms,
        created_by=user,
    )
    invoice.save()
    _write_items_and_totals(invoice, data["items"], profile)
    invoice.save()
    return invoice


@transaction.atomic
def update_invoice(invoice: Invoice, data: dict, profile) -> Invoice:
    invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
    if invoice.status != Invoice.DRAFT:  # US-05 AC8: finalized invoices are locked
        raise ApiError("This invoice is finalized and locked. Cancel it and create a new one to make changes.",
                       "invoice_locked", 409)
    customer = data.get("customer", invoice.customer)
    invoice.customer = customer
    invoice.place_of_supply = customer.state
    invoice.invoice_date = data.get("invoice_date", invoice.invoice_date)
    invoice.due_date = data.get("due_date") or invoice.due_date
    invoice.supply_type = resolve_supply_type(profile, customer, data.get("supply_type", "auto"))
    invoice.notes = data.get("notes", invoice.notes)
    invoice.terms = data.get("terms", invoice.terms)
    if "items" in data:
        invoice.items.all().delete()
        _write_items_and_totals(invoice, data["items"], profile)
    else:  # customer/date change can flip intra <-> inter: recompute from the stored lines
        items = list(invoice.items.values("item_name", "description", "hsn_sac_code", "unit", "unit_price",
                                          "gst_rate", "quantity", "discount_percent"))
        invoice.items.all().delete()
        _write_items_and_totals(invoice, items, profile)
    invoice.save()
    return invoice


# --------------------------------------------------------------------------- finalize / cancel
@transaction.atomic
def finalize_invoice(invoice_id: int, profile) -> Invoice:
    invoice = Invoice.objects.select_for_update().select_related("customer").get(pk=invoice_id)
    if invoice.status != Invoice.DRAFT:
        raise ApiError("Only draft invoices can be finalized.", "not_draft", 409)
    if not profile.is_complete:
        raise ApiError("Complete your business profile before finalizing invoices.", "profile_incomplete", 403)
    if not profile.is_gst_registered and invoice.items.exclude(gst_rate=0).exists():
        # drafted while the business still had a GSTIN: re-price it as a Bill of Supply before it is issued
        items = list(invoice.items.values("item_name", "description", "hsn_sac_code", "unit", "unit_price",
                                          "gst_rate", "quantity", "discount_percent"))
        invoice.items.all().delete()
        _write_items_and_totals(invoice, items, profile)
    if invoice.grand_total <= 0:
        raise ApiError("The invoice total must be greater than zero.", "zero_total", 400)

    number, fy = numbering.allocate(profile, invoice.invoice_date)  # rolled back with everything else on error
    if len(number) > MAX_INVOICE_NUMBER_LENGTH:
        raise ApiError(
            f"Invoice number '{number}' would exceed the 16 character GST limit. "
            "Use a shorter invoice prefix in Settings.", "number_too_long", 400)

    invoice.invoice_number = number
    invoice.financial_year = fy
    invoice.status = Invoice.SENT
    invoice.finalized_at = timezone.now()
    invoice.business_snapshot = business_snapshot(profile)
    invoice.customer_snapshot = customer_snapshot(invoice.customer)
    invoice.save()
    return invoice


@transaction.atomic
def cancel_invoice(invoice_id: int) -> Invoice:
    invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
    if invoice.status == Invoice.DRAFT:
        raise ApiError("Drafts are deleted, not cancelled.", "is_draft", 409)
    if invoice.status == Invoice.CANCELLED:
        raise ApiError("This invoice is already cancelled.", "already_cancelled", 409)
    if invoice.payments.exists():
        raise ApiError("Payments are recorded against this invoice. Delete them (or refund the customer) "
                       "before cancelling it.", "has_payments", 409)
    invoice.status = Invoice.CANCELLED
    invoice.cancelled_at = timezone.now()
    invoice.save(update_fields=["status", "cancelled_at", "updated_at"])
    return invoice


# --------------------------------------------------------------------------- payments
def check_payment_date(invoice: Invoice, payment_date) -> None:
    if payment_date > timezone.localdate():
        raise ApiError("The payment date can't be in the future.", "future_payment", 400)
    if payment_date < invoice.invoice_date:
        raise ApiError(f"The payment date can't be before the invoice date ({invoice.invoice_date:%d %b %Y}).",
                       "payment_before_invoice", 400)


def refresh_payment_state(invoice: Invoice) -> None:
    """amount_paid = sum(payments); status follows (US-07 AC3: balance is calculated automatically)."""
    invoice.amount_paid = invoice.payments.aggregate(total=Sum("amount"))["total"] or Decimal("0")
    if invoice.status in (Invoice.DRAFT, Invoice.CANCELLED):
        pass
    elif invoice.amount_paid >= invoice.grand_total:
        invoice.status = Invoice.PAID
    elif invoice.amount_paid > 0:
        invoice.status = Invoice.PARTIAL
    else:
        invoice.status = Invoice.SENT
    invoice.save(update_fields=["amount_paid", "status", "updated_at"])


@transaction.atomic
def add_payment(invoice_id: int, amount: Decimal, payment_date, mode: str, reference: str = "", notes: str = "") -> Invoice:
    invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
    if invoice.status == Invoice.DRAFT:
        raise ApiError("Finalize the invoice before recording payments.", "is_draft", 409)
    if invoice.status == Invoice.CANCELLED:
        raise ApiError("This invoice is cancelled.", "is_cancelled", 409)
    if invoice.status == Invoice.PAID:
        raise ApiError("This invoice is already fully paid.", "already_paid", 409)
    amount = calc.money(amount)
    if amount <= 0:
        raise ApiError("Enter an amount greater than zero.", "bad_amount", 400)
    if amount > invoice.balance_due:
        raise ApiError(f"Amount exceeds the outstanding balance of ₹{invoice.balance_due}.", "overpayment", 400)
    check_payment_date(invoice, payment_date)
    Payment.objects.create(invoice=invoice, amount=amount, payment_date=payment_date, mode=mode,
                           reference=reference, notes=notes)
    refresh_payment_state(invoice)
    return invoice


@transaction.atomic
def delete_payment(invoice_id: int, payment_id: int) -> Invoice:
    invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
    deleted, _ = invoice.payments.filter(pk=payment_id).delete()
    if not deleted:
        raise ApiError("Payment not found.", "not_found", 404)
    refresh_payment_state(invoice)
    return invoice


@transaction.atomic
def update_payment(payment_id: int, data: dict) -> Payment:
    """Edit a recorded payment. The invoice's paid total / status are recomputed, and the edited
    amount may not push the invoice past its grand total (same guard as recording a payment)."""
    payment = Payment.objects.select_related("invoice").get(pk=payment_id)
    invoice = Invoice.objects.select_for_update().get(pk=payment.invoice_id)
    amount = calc.money(data.get("amount", payment.amount))
    if amount <= 0:
        raise ApiError("Enter an amount greater than zero.", "bad_amount", 400)
    others = invoice.payments.exclude(pk=payment.pk).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    room = invoice.grand_total - others
    if amount > room:
        raise ApiError(f"Amount exceeds the outstanding balance of ₹{room} for this invoice.", "overpayment", 400)
    if "payment_date" in data:
        check_payment_date(invoice, data["payment_date"])
    payment.amount = amount
    for field in ("payment_date", "mode", "reference", "notes"):
        if field in data:
            setattr(payment, field, data[field])
    payment.save()
    refresh_payment_state(invoice)
    return payment

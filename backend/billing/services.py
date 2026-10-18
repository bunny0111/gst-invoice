"""Invoice workflow: create / edit drafts, finalize (numbering + snapshot), cancel, payments."""
from dataclasses import asdict
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from common.api import ApiError
from common.gst import STATE_NAMES

from . import calc
from .models import Customer, Invoice, InvoiceLineItem, InvoiceSequence, Payment

MAX_INVOICE_NUMBER_LENGTH = 16  # GST rule: the serial number may not exceed 16 characters


# --------------------------------------------------------------------------- snapshots
def business_snapshot(profile) -> dict:
    return {
        "business_name": profile.business_name, "gstin": profile.gstin, "pan": profile.pan,
        "state": profile.state, "state_name": STATE_NAMES.get(profile.state, ""),
        "address_line1": profile.address_line1, "address_line2": profile.address_line2,
        "city": profile.city, "pincode": profile.pincode, "phone": profile.phone, "email": profile.email,
        "logo": profile.logo.name if profile.logo else None,
        "bank_name": profile.bank_name, "account_holder_name": profile.account_holder_name,
        "account_number": profile.account_number, "ifsc_code": profile.ifsc_code,
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


def _write_items_and_totals(invoice: Invoice, items: list[dict]) -> None:
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
    _write_items_and_totals(invoice, data["items"])
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
        _write_items_and_totals(invoice, data["items"])
    else:  # customer/date change can flip intra <-> inter: recompute from the stored lines
        items = list(invoice.items.values("item_name", "description", "hsn_sac_code", "unit", "unit_price",
                                          "gst_rate", "quantity", "discount_percent"))
        invoice.items.all().delete()
        _write_items_and_totals(invoice, items)
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
    if invoice.grand_total <= 0:
        raise ApiError("The invoice total must be greater than zero.", "zero_total", 400)

    fy = calc.financial_year(invoice.invoice_date)
    try:
        with transaction.atomic():
            sequence, _ = InvoiceSequence.objects.get_or_create(financial_year=fy)
    except IntegrityError:  # two requests raced to create the FY row
        sequence = InvoiceSequence.objects.get(financial_year=fy)
    sequence = InvoiceSequence.objects.select_for_update().get(pk=sequence.pk)  # serialise numbering
    sequence.last_number += 1
    number = calc.format_invoice_number(profile.invoice_prefix, fy, sequence.last_number)
    if len(number) > MAX_INVOICE_NUMBER_LENGTH:
        raise ApiError(
            f"Invoice number '{number}' would exceed the 16 character GST limit. "
            "Use a shorter invoice prefix in Settings.", "number_too_long", 400)
    sequence.save(update_fields=["last_number"])

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
    invoice.status = Invoice.CANCELLED
    invoice.cancelled_at = timezone.now()
    invoice.save(update_fields=["status", "cancelled_at", "updated_at"])
    return invoice


# --------------------------------------------------------------------------- payments
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
    payment.amount = amount
    for field in ("payment_date", "mode", "reference", "notes"):
        if field in data:
            setattr(payment, field, data[field])
    payment.save()
    refresh_payment_state(invoice)
    return payment

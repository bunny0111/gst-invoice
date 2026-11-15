"""Invoice numbering: which counter an invoice draws from, what the number looks like, and moving the counter.

Two formats (Business profile -> Invoice settings):
  fy       INV/2026-27/001   one gapless counter per financial year, restarting at 001 every April
  running  INV-0001          one gapless counter for the life of the business

The business may move a counter FORWARD ("next invoice number" - e.g. to continue from their old software at 101),
never backwards, so a number can never be issued twice.
"""
from django.db import IntegrityError, transaction
from django.utils import timezone

from . import calc
from .models import InvoiceSequence

RUNNING_KEY = "running"  # the InvoiceSequence row used by the running format (fits the 7-char FY column)


def sequence_key(profile, on=None) -> str:
    on = on or timezone.localdate()
    return RUNNING_KEY if profile.invoice_number_format == "running" else calc.financial_year(on)


def format_number(profile, key: str, sequence: int) -> str:
    if key == RUNNING_KEY:
        return f"{profile.invoice_prefix}-{sequence:04d}"
    return calc.format_invoice_number(profile.invoice_prefix, key, sequence)


def next_sequence_number(profile, on=None) -> int:
    row = InvoiceSequence.objects.filter(financial_year=sequence_key(profile, on)).first()
    return (row.last_number if row else 0) + 1


def preview_next_number(profile) -> str:
    key = sequence_key(profile)
    return format_number(profile, key, next_sequence_number(profile))


def _locked_row(key: str) -> InvoiceSequence:
    try:
        with transaction.atomic():
            row, _ = InvoiceSequence.objects.get_or_create(financial_year=key)
    except IntegrityError:  # two requests raced to create the row
        row = InvoiceSequence.objects.get(financial_year=key)
    return InvoiceSequence.objects.select_for_update().get(pk=row.pk)  # serialise numbering


@transaction.atomic
def set_next_number(profile, number: int) -> None:
    row = _locked_row(sequence_key(profile))
    if number - 1 > row.last_number:
        row.last_number = number - 1
        row.save(update_fields=["last_number"])


def allocate(profile, invoice_date) -> tuple[str, str]:
    """Take the next number for an invoice dated `invoice_date`. Call inside the finalize transaction.
    Returns (invoice number, financial year)."""
    key = sequence_key(profile, invoice_date)
    row = _locked_row(key)
    row.last_number += 1
    row.save(update_fields=["last_number"])
    return format_number(profile, key, row.last_number), calc.financial_year(invoice_date)

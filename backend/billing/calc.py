"""GST calculation engine - the single source of truth for every rupee on an invoice.

Pure functions on Decimal (never float - PRD 7.3). The React invoice form mirrors this logic
for the live preview (PRD US-05 AC4) but the server always recomputes on save.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

TWO_PLACES = Decimal("0.01")
ZERO = Decimal("0")
HUNDRED = Decimal("100")

INTRA, INTER, EXPORT = "intrastate", "interstate", "export"


def money(value: Decimal) -> Decimal:
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


def detect_supply_type(business_state: str, customer_state: str) -> str:
    """US-05 AC2: same state = intra-state (CGST+SGST), different state = inter-state (IGST)."""
    return INTRA if business_state == customer_state else INTER


@dataclass
class LineResult:
    gross_amount: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    cgst_rate: Decimal
    cgst_amount: Decimal
    sgst_rate: Decimal
    sgst_amount: Decimal
    igst_rate: Decimal
    igst_amount: Decimal
    line_total: Decimal


def calculate_line(quantity, unit_price, discount_percent, gst_rate, supply_type: str) -> LineResult:
    quantity, unit_price = Decimal(quantity), Decimal(unit_price)
    discount_percent, gst_rate = Decimal(discount_percent), Decimal(gst_rate)

    gross = money(quantity * unit_price)
    discount = money(gross * discount_percent / HUNDRED)
    taxable = gross - discount

    cgst_rate = sgst_rate = igst_rate = ZERO
    if supply_type == INTRA:  # US-05 AC5: 18% GST = 9% CGST + 9% SGST
        cgst_rate = sgst_rate = gst_rate / 2
    elif supply_type == INTER:  # US-05 AC6: 18% GST = 18% IGST
        igst_rate = gst_rate
    # EXPORT / SEZ under LUT is zero-rated: every tax rate stays 0

    cgst = money(taxable * cgst_rate / HUNDRED)
    sgst = money(taxable * sgst_rate / HUNDRED)
    igst = money(taxable * igst_rate / HUNDRED)
    return LineResult(gross, discount, taxable, cgst_rate, cgst, sgst_rate, sgst, igst_rate, igst,
                      taxable + cgst + sgst + igst)


@dataclass
class InvoiceTotals:
    subtotal: Decimal = ZERO
    discount_total: Decimal = ZERO
    taxable_amount: Decimal = ZERO
    cgst_amount: Decimal = ZERO
    sgst_amount: Decimal = ZERO
    igst_amount: Decimal = ZERO
    round_off: Decimal = ZERO
    grand_total: Decimal = ZERO
    lines: list[LineResult] = field(default_factory=list)


def calculate_invoice(items: list[dict], supply_type: str) -> InvoiceTotals:
    """`items` need quantity, unit_price, discount_percent, gst_rate."""
    t = InvoiceTotals()
    for item in items:
        line = calculate_line(item["quantity"], item["unit_price"], item.get("discount_percent", 0),
                              item["gst_rate"], supply_type)
        t.lines.append(line)
        t.subtotal += line.gross_amount
        t.discount_total += line.discount_amount
        t.taxable_amount += line.taxable_amount
        t.cgst_amount += line.cgst_amount
        t.sgst_amount += line.sgst_amount
        t.igst_amount += line.igst_amount
    raw_total = t.taxable_amount + t.cgst_amount + t.sgst_amount + t.igst_amount
    t.grand_total = raw_total.quantize(Decimal("1"), rounding=ROUND_HALF_UP)  # US-05 AC10: nearest rupee
    t.round_off = t.grand_total - raw_total
    t.grand_total = money(t.grand_total)
    return t


def financial_year(d: date) -> str:
    """Indian financial year runs 1 Apr - 31 Mar: 15 Aug 2026 -> '2026-27', 10 Feb 2027 -> '2026-27'."""
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start}-{str(start + 1)[-2:]}"


def format_invoice_number(prefix: str, fy: str, sequence: int) -> str:
    """US-05 AC7: {PREFIX}/{FINANCIAL_YEAR}/{SEQUENCE}, e.g. INV/2026-27/001."""
    return f"{prefix}/{fy}/{sequence:03d}"

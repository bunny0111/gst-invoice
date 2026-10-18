"""GST reference data shared by the whole backend (and exposed to the React app via /api/meta/)."""
import re
from datetime import date
from decimal import Decimal

# (2-letter code, name, numeric GST state code used as the first two digits of a GSTIN)
# 28 states + 8 union territories = 36, as required by PRD US-02 AC1.
STATES = [
    ("AN", "Andaman & Nicobar Islands", "35"),
    ("AP", "Andhra Pradesh", "37"),
    ("AR", "Arunachal Pradesh", "12"),
    ("AS", "Assam", "18"),
    ("BR", "Bihar", "10"),
    ("CH", "Chandigarh", "04"),
    ("CG", "Chhattisgarh", "22"),
    ("DN", "Dadra & Nagar Haveli and Daman & Diu", "26"),
    ("DL", "Delhi", "07"),
    ("GA", "Goa", "30"),
    ("GJ", "Gujarat", "24"),
    ("HR", "Haryana", "06"),
    ("HP", "Himachal Pradesh", "02"),
    ("JK", "Jammu & Kashmir", "01"),
    ("JH", "Jharkhand", "20"),
    ("KA", "Karnataka", "29"),
    ("KL", "Kerala", "32"),
    ("LA", "Ladakh", "38"),
    ("LD", "Lakshadweep", "31"),
    ("MP", "Madhya Pradesh", "23"),
    ("MH", "Maharashtra", "27"),
    ("MN", "Manipur", "14"),
    ("ML", "Meghalaya", "17"),
    ("MZ", "Mizoram", "15"),
    ("NL", "Nagaland", "13"),
    ("OD", "Odisha", "21"),
    ("PY", "Puducherry", "34"),
    ("PB", "Punjab", "03"),
    ("RJ", "Rajasthan", "08"),
    ("SK", "Sikkim", "11"),
    ("TN", "Tamil Nadu", "33"),
    ("TS", "Telangana", "36"),
    ("TR", "Tripura", "16"),
    ("UP", "Uttar Pradesh", "09"),
    ("UK", "Uttarakhand", "05"),
    ("WB", "West Bengal", "19"),
]
STATE_CHOICES = [(code, name) for code, name, _ in STATES]
STATE_NAMES = {code: name for code, name, _ in STATES}
STATE_GST_CODES = {code: gst for code, _, gst in STATES}

# GST slabs - kept in ONE place so it is a one-line change if the GST Council revises them again.
# From 22 Sep 2025 (GST 2.0) the 12% and 28% slabs were replaced by 5% / 18% (and 40% for sin & luxury goods).
#   0.25% and 3% are the special rates for rough diamonds and gold/silver/jewellery - NOT covered by the
#   Cashfree article this was checked against, so verify them with your CA before relying on them.
GST_RATES = [Decimal("0"), Decimal("0.25"), Decimal("3"), Decimal("5"), Decimal("18"), Decimal("40")]
LEGACY_GST_RATES = [Decimal("12"), Decimal("28")]   # only valid on invoices dated BEFORE the cut-over
GST_RATE_CUTOVER = date(2025, 9, 22)
GST_RATE_CHOICES = [(r, f"{r}%") for r in GST_RATES]


def rates_allowed_on(on: date) -> list[Decimal]:
    """The slabs a tax invoice dated `on` may use."""
    return GST_RATES if on >= GST_RATE_CUTOVER else GST_RATES + LEGACY_GST_RATES


def rate_label(rate) -> str:
    rate = Decimal(rate)
    return f"{rate.normalize():f}%"

UNITS = [
    ("pcs", "Pieces"), ("nos", "Numbers"), ("kg", "Kilograms"), ("g", "Grams"),
    ("ltr", "Litres"), ("ml", "Millilitres"), ("mtr", "Metres"), ("sqft", "Sq. Feet"),
    ("sqm", "Sq. Metres"), ("box", "Boxes"), ("pack", "Packs"), ("set", "Sets"),
    ("pair", "Pairs"), ("dozen", "Dozens"), ("hrs", "Hours"), ("days", "Days"),
    ("month", "Months"), ("job", "Job / Service"),
]
UNIT_CODES = [u for u, _ in UNITS]

PAYMENT_MODES = [("cash", "Cash"), ("upi", "UPI"), ("bank_transfer", "Bank Transfer"), ("cheque", "Cheque")]

_ALNUM = re.compile(r"^[A-Za-z0-9]+$")


def is_valid_gstin(value: str) -> bool:
    """PRD US-02 AC2: exactly 15 characters, alphanumeric."""
    return len(value) == 15 and bool(_ALNUM.match(value))


def is_valid_pan(value: str) -> bool:
    """PRD US-02 AC3: exactly 10 characters."""
    return len(value) == 10 and bool(_ALNUM.match(value))

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

# Units of measurement: (code printed on the invoice, name, group, GST UQC).
# UQC = the GST "Unit Quantity Code" GSTR-1 / e-invoices expect; units the GST list doesn't have map to OTH (Others).
# Codes are stored on products and invoice lines, so existing ones (pcs, kg, mtr, ...) must never change.
UNIT_DETAILS = [
    # count
    ("pcs", "Pieces", "Count", "PCS"), ("nos", "Numbers", "Count", "NOS"), ("unt", "Units", "Count", "UNT"),
    ("set", "Sets", "Count", "SET"), ("pair", "Pairs", "Count", "PRS"), ("dozen", "Dozens", "Count", "DOZ"),
    ("gross", "Gross (144)", "Count", "GRS"), ("thd", "Thousands", "Count", "THD"),
    # packaging
    ("box", "Boxes", "Packaging", "BOX"), ("pack", "Packs", "Packaging", "PAC"), ("ctn", "Cartons", "Packaging", "CTN"),
    ("bag", "Bags", "Packaging", "BAG"), ("btl", "Bottles", "Packaging", "BTL"), ("can", "Cans", "Packaging", "CAN"),
    ("jar", "Jars", "Packaging", "OTH"), ("drum", "Drums", "Packaging", "DRM"), ("bdl", "Bundles", "Packaging", "BDL"),
    ("roll", "Rolls", "Packaging", "ROL"), ("tube", "Tubes", "Packaging", "TUB"), ("strip", "Strips", "Packaging", "OTH"),
    ("tab", "Tablets", "Packaging", "TBS"), ("bale", "Bales", "Packaging", "BAL"), ("bunch", "Bunches", "Packaging", "BUN"),
    ("sheet", "Sheets", "Packaging", "OTH"), ("ream", "Reams", "Packaging", "OTH"),
    # weight
    ("mg", "Milligrams", "Weight", "OTH"), ("g", "Grams", "Weight", "GMS"), ("kg", "Kilograms", "Weight", "KGS"),
    ("qtl", "Quintals", "Weight", "QTL"), ("ton", "Tonnes (metric tons)", "Weight", "TON"),
    ("ct", "Carats", "Weight", "OTH"),
    # volume
    ("ml", "Millilitres", "Volume", "MLT"), ("ltr", "Litres", "Volume", "LTR"), ("kl", "Kilolitres", "Volume", "KLR"),
    ("cc", "Cubic centimetres", "Volume", "CCM"), ("cbm", "Cubic metres", "Volume", "CBM"),
    ("cft", "Cubic feet", "Volume", "OTH"), ("gal", "Gallons (US)", "Volume", "UGS"),
    # length
    ("mm", "Millimetres", "Length", "OTH"), ("cm", "Centimetres", "Length", "CMS"), ("inch", "Inches", "Length", "OTH"),
    ("ft", "Feet", "Length", "OTH"), ("yd", "Yards", "Length", "YDS"), ("mtr", "Metres", "Length", "MTR"),
    ("km", "Kilometres", "Length", "KME"),
    # area
    ("sqin", "Square inches", "Area", "OTH"), ("sqft", "Square feet", "Area", "SQF"), ("sqyd", "Square yards", "Area", "SQY"),
    ("sqm", "Square metres", "Area", "SQM"), ("acre", "Acres", "Area", "OTH"),
    # time & services
    ("min", "Minutes", "Time & services", "OTH"), ("hrs", "Hours", "Time & services", "OTH"),
    ("days", "Days", "Time & services", "OTH"), ("week", "Weeks", "Time & services", "OTH"),
    ("month", "Months", "Time & services", "OTH"), ("year", "Years", "Time & services", "OTH"),
    ("job", "Job / Service", "Time & services", "OTH"), ("visit", "Visits", "Time & services", "OTH"),
    ("person", "Persons", "Time & services", "OTH"), ("trip", "Trips", "Time & services", "OTH"),
    # energy & other
    ("kwh", "Kilowatt-hours", "Other", "OTH"), ("oth", "Others", "Other", "OTH"),
]
UNITS = [(code, name) for code, name, _, _ in UNIT_DETAILS]
UNIT_CODES = [u for u, _ in UNITS]
UNIT_UQC = {code: uqc for code, _, _, uqc in UNIT_DETAILS}

PAYMENT_MODES = [("cash", "Cash"), ("upi", "UPI"), ("bank_transfer", "Bank Transfer"), ("cheque", "Cheque")]

_ALNUM = re.compile(r"^[A-Za-z0-9]+$")


def is_valid_gstin(value: str) -> bool:
    """PRD US-02 AC2: exactly 15 characters, alphanumeric."""
    return len(value) == 15 and bool(_ALNUM.match(value))


def is_valid_pan(value: str) -> bool:
    """PRD US-02 AC3: exactly 10 characters."""
    return len(value) == 10 and bool(_ALNUM.match(value))


# --------------------------------------------------------------------------- business / bank reference lists
BUSINESS_TYPES = [
    ("proprietorship", "Proprietorship"), ("partnership", "Partnership"), ("llp", "Limited Liability Partnership (LLP)"),
    ("private_limited", "Private Limited Company"), ("public_limited", "Public Limited Company"),
    ("opc", "One Person Company (OPC)"), ("huf", "Hindu Undivided Family (HUF)"),
    ("trust_society", "Trust / Society / NGO"), ("other", "Other"),
]
# "Nature of business activity" on a GST registration - what the business does (the list above is its legal form)
BUSINESS_NATURES = [
    ("retailer", "Retailer / shop"), ("wholesaler", "Wholesaler / distributor"), ("manufacturer", "Manufacturer"),
    ("service_provider", "Service provider"), ("trader", "Trader"), ("contractor", "Works contractor"),
    ("ecommerce", "E-commerce seller"), ("freelancer", "Freelancer / consultant"), ("other", "Other"),
]
ACCOUNT_TYPES = [("savings", "Savings"), ("current", "Current"), ("cash_credit", "Cash Credit"), ("overdraft", "Overdraft")]

_GST_STATE_CODES = {gst: code for code, _, gst in STATES}


def gstin_state(value: str) -> str | None:
    """The 2-letter state a GSTIN was issued in (its first two digits), or None if they aren't a real state code."""
    return _GST_STATE_CODES.get(value[:2]) if value else None


def normalize_phone(value: str) -> str | None:
    """An Indian phone number as exactly 10 digits, or None if it isn't one.
    Spaces/dashes and a leading +91, 91 or 0 are dropped: '+91 98765-43210' -> '9876543210'."""
    digits = re.sub(r"[\s\-()]", "", value or "")
    if digits.startswith("+"):
        digits = digits[1:]
        if not digits.startswith("91"):
            return None
    if not digits.isdigit():
        return None
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] == "0" or len(set(digits)) == 1:
        return None
    return digits


def normalize_international_phone(value: str) -> str | None:
    """A foreign number written with its country code ('+971 50 123 4567' -> '+971501234567'), or None.
    Only for customers (export invoices); +91 numbers go through normalize_phone() instead."""
    raw = re.sub(r"[\s\-()]", "", value or "")
    if not raw.startswith("+") or raw.startswith("+91") or not raw[1:].isdigit():
        return None
    return raw if 8 <= len(raw) - 1 <= 15 and raw[1] != "0" else None  # E.164: at most 15 digits


def is_valid_pincode(value: str) -> bool:
    """Indian PIN codes are 6 digits and never start with 0."""
    return bool(re.fullmatch(r"[1-9]\d{5}", value or ""))

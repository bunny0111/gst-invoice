"""Amount in words using the Indian numbering system (lakh / crore) - required on a GST invoice."""
from decimal import ROUND_HALF_UP, Decimal

_ONES = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
    "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _below_hundred(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")).strip()


def _below_thousand(n: int) -> str:
    words = []
    if n >= 100:
        words.append(_ONES[n // 100] + " Hundred")
        n %= 100
    if n:
        words.append(_below_hundred(n))
    return " ".join(words)


def number_to_words(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for divisor, name in ((10_000_000, "Crore"), (100_000, "Lakh"), (1_000, "Thousand")):
        chunk, n = divmod(n, divisor)
        if chunk:
            # crores may themselves exceed 99 (e.g. 120 crore) - recurse for that chunk only
            text = number_to_words(chunk) if chunk >= 100 and name == "Crore" else _below_hundred(chunk)
            parts.append(f"{text} {name}")
    if n:
        parts.append(_below_thousand(n))
    return " ".join(parts)


def amount_in_words(amount) -> str:
    """5200 -> 'Rupees Five Thousand Two Hundred Only'; 5200.50 -> '... and Fifty Paise Only'."""
    amount = Decimal(amount).quantize(Decimal("0.01"), ROUND_HALF_UP)
    rupees = int(amount)
    paise = int((amount - rupees) * 100)
    text = f"Rupees {number_to_words(rupees)}"
    if paise:
        text += f" and {number_to_words(paise)} Paise"
    return text + " Only"

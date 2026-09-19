from decimal import ROUND_HALF_UP, Decimal

from django import template

register = template.Library()


@register.filter
def inr(value):
    """1234567.5 -> '12,34,567.50' (Indian digit grouping)."""
    if value in (None, ""):
        return "0.00"
    amount = Decimal(value).quantize(Decimal("0.01"), ROUND_HALF_UP)
    sign = "-" if amount < 0 else ""
    whole, frac = f"{abs(amount):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups) + "," + tail
    return f"{sign}{whole}.{frac}"


@register.filter
def trim_zero(value):
    """18.00 -> 18, 2.500 -> 2.5"""
    text = f"{Decimal(value):f}"
    return text.rstrip("0").rstrip(".") if "." in text else text

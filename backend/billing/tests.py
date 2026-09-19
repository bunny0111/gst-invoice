"""Unit tests for the GST engine, using the worked examples from the PRD (US-05)."""
from datetime import date
from decimal import Decimal

from django.test import SimpleTestCase

from common.words import amount_in_words

from . import calc
from .templatetags.billing_extras import inr


class SupplyTypeTests(SimpleTestCase):
    def test_same_state_is_intra(self):
        self.assertEqual(calc.detect_supply_type("DL", "DL"), calc.INTRA)

    def test_different_state_is_inter(self):
        self.assertEqual(calc.detect_supply_type("DL", "MH"), calc.INTER)


class LineCalculationTests(SimpleTestCase):
    def test_intra_state_splits_gst_equally(self):
        """US-05 AC5: 18% GST = 9% CGST + 9% SGST."""
        r = calc.calculate_line(1, "1000", 0, 18, calc.INTRA)
        self.assertEqual((r.cgst_rate, r.sgst_rate, r.igst_rate), (Decimal("9"), Decimal("9"), Decimal("0")))
        self.assertEqual((r.cgst_amount, r.sgst_amount, r.igst_amount), (Decimal("90.00"), Decimal("90.00"), Decimal("0.00")))
        self.assertEqual(r.line_total, Decimal("1180.00"))

    def test_inter_state_uses_full_rate_as_igst(self):
        """US-05 AC6: 18% GST = 18% IGST, CGST = SGST = 0."""
        r = calc.calculate_line(1, "1000", 0, 18, calc.INTER)
        self.assertEqual((r.cgst_amount, r.sgst_amount, r.igst_amount), (Decimal("0.00"), Decimal("0.00"), Decimal("180.00")))
        self.assertEqual(r.line_total, Decimal("1180.00"))

    def test_export_is_zero_rated(self):
        r = calc.calculate_line(2, "500", 0, 18, calc.EXPORT)
        self.assertEqual(r.cgst_amount + r.sgst_amount + r.igst_amount, Decimal("0.00"))
        self.assertEqual(r.line_total, Decimal("1000.00"))

    def test_exempt_zero_percent(self):
        r = calc.calculate_line(3, "40", 0, 0, calc.INTRA)
        self.assertEqual(r.line_total, Decimal("120.00"))

    def test_discount_reduces_taxable_value_before_tax(self):
        r = calc.calculate_line(2, "500", 10, 18, calc.INTER)  # 1000 - 10% = 900
        self.assertEqual((r.gross_amount, r.discount_amount, r.taxable_amount), (Decimal("1000.00"), Decimal("100.00"), Decimal("900.00")))
        self.assertEqual(r.igst_amount, Decimal("162.00"))

    def test_fractional_quantity(self):
        r = calc.calculate_line("2.5", "199.99", 0, 5, calc.INTRA)  # 499.975 -> 499.98 (half up)
        self.assertEqual(r.taxable_amount, Decimal("499.98"))

    def test_odd_rate_halves_exactly(self):
        r = calc.calculate_line(1, "1000", 0, 5, calc.INTRA)
        self.assertEqual((r.cgst_rate, r.cgst_amount, r.sgst_amount), (Decimal("2.5"), Decimal("25.00"), Decimal("25.00")))


class InvoiceTotalsTests(SimpleTestCase):
    def test_round_off_to_nearest_rupee(self):
        """US-05 AC10."""
        t = calc.calculate_invoice([{"quantity": 1, "unit_price": "99.99", "gst_rate": 18}], calc.INTER)
        # 99.99 + 18.00 (17.9982 -> 18.00) = 117.99 -> 118
        self.assertEqual(t.grand_total, Decimal("118.00"))
        self.assertEqual(t.round_off, Decimal("0.01"))

    def test_multi_line_totals_add_up(self):
        items = [
            {"quantity": 2, "unit_price": "500", "discount_percent": 10, "gst_rate": 18},
            {"quantity": 1, "unit_price": "250.50", "gst_rate": 5},
        ]
        t = calc.calculate_invoice(items, calc.INTRA)
        self.assertEqual(t.subtotal, Decimal("1250.50"))
        self.assertEqual(t.discount_total, Decimal("100.00"))
        self.assertEqual(t.taxable_amount, Decimal("1150.50"))
        self.assertEqual(t.cgst_amount, t.sgst_amount)  # always symmetric
        self.assertEqual(t.igst_amount, Decimal("0.00"))
        raw = t.taxable_amount + t.cgst_amount + t.sgst_amount
        self.assertEqual(t.grand_total, raw.quantize(Decimal("1")) + Decimal("0.00"))

    def test_uses_decimal_never_float(self):
        t = calc.calculate_invoice([{"quantity": 3, "unit_price": "0.10", "gst_rate": 0}], calc.INTER)
        self.assertEqual(t.taxable_amount, Decimal("0.30"))  # 3 * 0.1 is 0.30000000000000004 as a float


class NumberingTests(SimpleTestCase):
    def test_financial_year_boundaries(self):
        self.assertEqual(calc.financial_year(date(2026, 4, 1)), "2026-27")
        self.assertEqual(calc.financial_year(date(2027, 3, 31)), "2026-27")
        self.assertEqual(calc.financial_year(date(2027, 4, 1)), "2027-28")
        self.assertEqual(calc.financial_year(date(2026, 1, 15)), "2025-26")

    def test_invoice_number_format(self):
        """US-05 AC7: INV/2026-27/001."""
        self.assertEqual(calc.format_invoice_number("INV", "2026-27", 1), "INV/2026-27/001")
        self.assertEqual(calc.format_invoice_number("TC", "2026-27", 142), "TC/2026-27/142")


class AmountInWordsTests(SimpleTestCase):
    def test_prd_example(self):
        """US-05 AC11."""
        self.assertEqual(amount_in_words(5200), "Rupees Five Thousand Two Hundred Only")

    def test_indian_grouping(self):
        self.assertEqual(amount_in_words(123456), "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only")
        self.assertEqual(amount_in_words(10_000_000), "Rupees One Crore Only")
        self.assertEqual(amount_in_words(1_200_000_000), "Rupees One Hundred Twenty Crore Only")

    def test_paise_and_zero(self):
        self.assertEqual(amount_in_words(Decimal("1180.50")), "Rupees One Thousand One Hundred Eighty and Fifty Paise Only")
        self.assertEqual(amount_in_words(0), "Rupees Zero Only")


class FormattingTests(SimpleTestCase):
    def test_inr_grouping(self):
        self.assertEqual(inr(Decimal("1234567.5")), "12,34,567.50")
        self.assertEqual(inr(Decimal("999")), "999.00")
        self.assertEqual(inr(Decimal("100000")), "1,00,000.00")

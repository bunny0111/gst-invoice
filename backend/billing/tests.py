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


# --------------------------------------------------------------------------- customer rules
class CustomerRuleTests(SimpleTestCase):
    """Phone mandatory for all; email optional for all; GSTIN mandatory for B2B, optional for B2C."""

    GSTIN = "07ABCDE1234F1Z5"

    def check(self, **data):
        from .serializers import CustomerSerializer

        ser = CustomerSerializer(data={"name": "Acme", "state": "DL", **data})
        ser.is_valid()
        return ser

    def test_phone_is_mandatory(self):
        for ctype, extra in (("b2c", {}), ("b2b", {"gstin": self.GSTIN})):
            ser = self.check(customer_type=ctype, **extra)
            self.assertIn("phone", ser.errors, ctype)
            self.assertEqual(str(ser.errors["phone"][0]), "Phone number is required.")

    def test_blank_phone_is_rejected(self):
        self.assertIn("phone", self.check(customer_type="b2c", phone="   ").errors)

    def test_email_is_optional_for_both_types(self):
        self.assertEqual(self.check(customer_type="b2c", phone="9811111111").errors, {})
        self.assertEqual(self.check(customer_type="b2b", gstin=self.GSTIN, phone="9811111111").errors, {})

    def test_b2b_requires_gstin(self):
        ser = self.check(customer_type="b2b", phone="9811111111")
        self.assertEqual(str(ser.errors["gstin"][0]), "GST number is required for B2B customers.")

    def test_b2c_gstin_is_optional(self):
        self.assertEqual(self.check(customer_type="b2c", phone="9811111111").errors, {})
        self.assertEqual(self.check(customer_type="b2c", phone="9811111111", gstin=self.GSTIN).errors, {})

    def test_gstin_still_validated_and_uppercased(self):
        self.assertIn("gstin", self.check(customer_type="b2c", phone="9811111111", gstin="123").errors)
        ser = self.check(customer_type="b2b", phone="9811111111", gstin=self.GSTIN.lower())
        self.assertEqual(ser.validated_data["gstin"], self.GSTIN)

    def test_type_is_inferred_for_api_clients_that_omit_it(self):
        self.assertEqual(self.check(phone="9811111111", gstin=self.GSTIN).validated_data["customer_type"], "b2b")
        self.assertEqual(self.check(phone="9811111111").validated_data["customer_type"], "b2c")


# --------------------------------------------------------------------------- sharing
class SharingTests(SimpleTestCase):
    def test_whatsapp_number_normalisation(self):
        from .sharing import whatsapp_number

        self.assertEqual(whatsapp_number("98111 22233"), "919811122233")       # bare Indian mobile -> +91
        self.assertEqual(whatsapp_number("09811122233"), "919811122233")       # leading 0
        self.assertEqual(whatsapp_number("+91 98111-22233"), "919811122233")   # already international
        self.assertEqual(whatsapp_number("+44 7911 123456"), "447911123456")   # other country untouched
        self.assertEqual(whatsapp_number(""), "")

    def test_share_token_round_trip(self):
        from .sharing import make_share_token, read_share_token

        token = make_share_token(7, "t_sharma")
        self.assertEqual(read_share_token(token, "t_sharma"), 7)

    def test_share_token_is_bound_to_its_tenant(self):
        """Invoice ids repeat across businesses - a token from one must be useless on another."""
        from .sharing import make_share_token, read_share_token

        token = make_share_token(7, "t_sharma")
        self.assertIsNone(read_share_token(token, "t_priya"))

    def test_tampered_or_garbage_tokens_are_rejected(self):
        from .sharing import make_share_token, read_share_token

        token = make_share_token(7, "t_sharma")
        self.assertIsNone(read_share_token(token[:-2] + "xx", "t_sharma"))
        self.assertIsNone(read_share_token("not-a-token", "t_sharma"))

    def test_expired_token_is_rejected(self):
        from django.core import signing

        from .sharing import SHARE_SALT, read_share_token

        token = signing.dumps({"i": 7, "s": "t_sharma"}, salt=SHARE_SALT)
        with self.settings():  # a token "from the future" relative to max_age
            import time
            from unittest import mock

            with mock.patch("django.core.signing.time.time", return_value=time.time() + 61 * 24 * 3600):
                self.assertIsNone(read_share_token(token, "t_sharma"))

    def test_whatsapp_url_encodes_the_message(self):
        from .sharing import whatsapp_url

        url = whatsapp_url("9811122233", "Hi there & welcome\nLink: https://x.test/a?b=1")
        self.assertTrue(url.startswith("https://wa.me/919811122233?text="))
        self.assertNotIn(" ", url)
        self.assertNotIn("\n", url)
        self.assertIn("%26", url)  # the ampersand is escaped, not treated as a new query parameter


class GstSlabTests(SimpleTestCase):
    """GST 2.0 (22 Sep 2025): 12% and 28% are gone for new invoices but stay readable for older ones."""

    def test_current_slabs(self):
        from common.gst import GST_RATES
        self.assertEqual([int(r) if r % 1 == 0 else float(r) for r in GST_RATES], [0, 0.25, 3, 5, 18, 40])

    def test_legacy_slabs_only_before_cutover(self):
        from datetime import date
        from common.gst import rates_allowed_on
        self.assertIn(Decimal("12"), rates_allowed_on(date(2025, 9, 21)))
        self.assertIn(Decimal("28"), rates_allowed_on(date(2025, 9, 21)))
        for d in (date(2025, 9, 22), date(2026, 10, 18)):
            self.assertNotIn(Decimal("12"), rates_allowed_on(d))
            self.assertNotIn(Decimal("28"), rates_allowed_on(d))
            self.assertIn(Decimal("40"), rates_allowed_on(d))

    def test_field_validator_and_labels(self):
        from rest_framework import serializers
        from billing.serializers import validate_gst_rate
        from common.gst import rate_label
        for ok in ("0", "0.25", "3", "5", "18", "40", "12", "28"):
            validate_gst_rate(ok)
        with self.assertRaises(serializers.ValidationError):
            validate_gst_rate("7")
        self.assertEqual([rate_label(r) for r in ("18", "0.25", "40.00")], ["18%", "0.25%", "40%"])

    def test_40_percent_split(self):
        r = calc.calculate_line("1", "1000", "0", "40", "intrastate")
        self.assertEqual((r.cgst_amount, r.sgst_amount, r.line_total), (Decimal("200.00"), Decimal("200.00"), Decimal("1400.00")))

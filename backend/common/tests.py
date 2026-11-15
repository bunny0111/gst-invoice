"""Tests for shared helpers: phone numbers, units, and the server-side SEO of the React shell."""
import json
import re

from django.test import SimpleTestCase

from .gst import (UNIT_CODES, UNIT_DETAILS, UNIT_UQC, gstin_check_char, gstin_checksum_ok, normalize_international_phone,
                  normalize_phone)
from .seo import render_index

SHELL = """<!doctype html><html><head>
    <meta name="description" content="old" />
    <title>GST Billing by Tech Cognixium</title>
    <meta property="og:title" content="old" />
    <meta property="og:description" content="old" />
    <meta property="og:url" content="/" />
    <meta property="og:image" content="/og-image.png" />
    <meta name="twitter:title" content="old" />
    <meta name="twitter:description" content="old" />
    <meta name="twitter:image" content="/og-image.png" />
  </head><body><div id="root"></div><script type="module" src="/assets/index-x.js"></script></body></html>"""


class PhoneTests(SimpleTestCase):
    def test_foreign_numbers_keep_their_country_code(self):
        self.assertEqual(normalize_international_phone("+971 50 123 4567"), "+971501234567")
        self.assertEqual(normalize_international_phone("+1 (202) 555-0100"), "+12025550100")

    def test_indian_and_malformed_numbers_are_not_foreign(self):
        for value in ("+91 98765 43210", "971501234567", "+12345", "+0123456789", "+97150123456789012"):
            self.assertIsNone(normalize_international_phone(value), value)
        self.assertEqual(normalize_phone("+91 98765 43210"), "9876543210")


class GstinChecksumTests(SimpleTestCase):
    def test_real_gstins_pass(self):
        for gstin in ("27AAACR5055K1Z7", "24AAACC1206D1ZM"):  # published on public invoices
            self.assertTrue(gstin_checksum_ok(gstin), gstin)

    def test_single_character_typos_are_caught(self):
        good = "27AAACR5055K1Z7"
        for i in range(14):
            for ch in "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ":
                if ch != good[i]:
                    self.assertFalse(gstin_checksum_ok(good[:i] + ch + good[i + 1:]), (i, ch))

    def test_lowercase_and_garbage(self):
        self.assertTrue(gstin_checksum_ok("27aaacr5055k1z7"))
        self.assertFalse(gstin_checksum_ok("27AAACR5055K1Z"))
        self.assertFalse(gstin_checksum_ok("27AAACR5055K1Z#"))
        self.assertEqual(gstin_check_char("07AABCS1234F1Z"), "T")


class UnitTests(SimpleTestCase):
    def test_codes_are_unique_and_fit_the_column(self):
        self.assertEqual(len(UNIT_CODES), len(set(UNIT_CODES)))
        self.assertTrue(all(len(code) <= 10 for code in UNIT_CODES))

    def test_existing_codes_are_kept(self):
        """Products and invoices already store these - removing one would orphan them."""
        for code in ("pcs", "nos", "kg", "g", "ltr", "ml", "mtr", "sqft", "sqm", "box", "pack", "set", "pair", "dozen",
                     "hrs", "days", "month", "job"):
            self.assertIn(code, UNIT_CODES)

    def test_every_unit_maps_to_a_gst_uqc(self):
        self.assertEqual(UNIT_UQC["pcs"], "PCS")
        self.assertEqual(UNIT_UQC["cm"], "CMS")
        self.assertEqual(UNIT_UQC["kg"], "KGS")
        self.assertTrue(all(re.fullmatch(r"[A-Z]{3}", uqc) for _, _, _, uqc in UNIT_DETAILS))


class SeoTests(SimpleTestCase):
    def test_marketing_page_gets_content_absolute_urls_and_its_own_title(self):
        html = render_index(SHELL, "https://app.example.com", "/register", public=True)
        self.assertIn("<title>Create your free account · GST Billing by Tech Cognixium</title>", html)
        self.assertIn('<meta property="og:url" content="https://app.example.com/register" />', html)
        self.assertIn('<meta property="og:image" content="https://app.example.com/og-image.png" />', html)
        self.assertIn('<meta name="twitter:image" content="https://app.example.com/og-image.png" />', html)
        self.assertIn('<link rel="canonical" href="https://app.example.com/register" />', html)
        self.assertIn("<h1>Create your free GST Billing account</h1>", html)
        self.assertIn('src="/assets/index-x.js"', html)  # the app still loads and replaces the static content

    def test_home_page_has_structured_data(self):
        html = render_index(SHELL, "https://app.example.com", "/", public=True)
        data = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S).group(1))
        self.assertEqual([d["@type"] for d in data], ["SoftwareApplication", "FAQPage"])

    def test_workspace_pages_only_get_absolute_urls(self):
        html = render_index(SHELL, "https://sharma.app.example.com", "/invoices", public=False)
        self.assertIn('<meta property="og:url" content="https://sharma.app.example.com/" />', html)
        self.assertIn('<div id="root"></div>', html)
        self.assertNotIn("canonical", html)

"""Logo handling: uploads are shrunk and validated before they are stored in the database."""
import io
import random

from django.test import SimpleTestCase
from PIL import Image
from rest_framework import serializers

from .logo import HARD_LIMIT_BYTES, MAX_DIMENSIONS, TARGET_BYTES, normalize_logo


def _png(size, mode="RGB", colour=(79, 63, 224)):
    buf = io.BytesIO()
    Image.new(mode, size, colour).save(buf, "PNG")
    buf.seek(0)
    return buf


class NormalizeLogoTests(SimpleTestCase):
    def _open(self, data):
        return Image.open(io.BytesIO(data))

    def test_large_logo_is_shrunk_into_the_box(self):
        data, content_type = normalize_logo(_png((3000, 1500)))
        w, h = self._open(data).size
        self.assertEqual(content_type, "image/png")
        self.assertLessEqual(w, MAX_DIMENSIONS[0])
        self.assertLessEqual(h, MAX_DIMENSIONS[1])
        self.assertEqual(round(w / h, 1), 2.0)  # aspect ratio kept

    def test_small_logo_is_not_enlarged(self):
        data, _ = normalize_logo(_png((120, 60)))
        self.assertEqual(self._open(data).size, (120, 60))

    def test_transparency_is_preserved(self):
        data, content_type = normalize_logo(_png((200, 100), "RGBA", (10, 20, 30, 0)))
        self.assertEqual(content_type, "image/png")
        self.assertEqual(self._open(data).mode, "RGBA")

    def test_jpeg_stays_jpeg(self):
        buf = io.BytesIO()
        Image.new("RGB", (900, 900), (200, 40, 40)).save(buf, "JPEG")
        buf.seek(0)
        data, content_type = normalize_logo(buf)
        self.assertEqual(content_type, "image/jpeg")
        self.assertLessEqual(len(data), TARGET_BYTES)

    def test_heavy_photo_png_ends_up_small(self):
        rnd = random.Random(1)
        noisy = Image.frombytes("RGB", (900, 600), bytes(rnd.randrange(256) for _ in range(900 * 600 * 3)))
        buf = io.BytesIO()
        noisy.save(buf, "PNG")
        buf.seek(0)
        data, _ = normalize_logo(buf)
        self.assertLessEqual(len(data), HARD_LIMIT_BYTES)

    def test_corrupt_data_is_a_clean_validation_error(self):
        with self.assertRaises(serializers.ValidationError):
            normalize_logo(io.BytesIO(b"definitely not an image"))

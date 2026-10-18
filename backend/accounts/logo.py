"""Logos live in the database (not on disk), so they survive redeploys on hosts with an ephemeral filesystem.

An uploaded logo is shrunk before it is stored: invoices print it at about 56 px tall, so a few hundred pixels is
plenty, and a small row keeps the database (and every PDF) light.
"""
import hashlib
import io

from rest_framework import serializers

MAX_DIMENSIONS = (800, 400)   # fits inside this box, aspect ratio kept
TARGET_BYTES = 250 * 1024     # shrink further until the stored image is at most this big
HARD_LIMIT_BYTES = 500 * 1024


def _encode(image, fmt: str, quality: int = 85) -> bytes:
    buf = io.BytesIO()
    if fmt == "PNG":
        image.save(buf, "PNG", optimize=True)
    else:
        image.convert("RGB").save(buf, "JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def normalize_logo(upload) -> tuple[bytes, str]:
    """Return (bytes, content_type) for a validated PNG/JPG upload, resized to a small, web-friendly image."""
    from PIL import Image, ImageOps

    try:
        image = Image.open(upload)
        image.load()
        original_format = (image.format or "").upper()
        image = ImageOps.exif_transpose(image)
    except Exception:  # corrupt data that slipped past verify() - still a clean 400, never a 500
        raise serializers.ValidationError("Upload a valid PNG or JPG image.")

    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    fmt = "PNG" if (original_format == "PNG" or has_alpha) else "JPEG"
    if fmt == "PNG" and image.mode not in ("RGB", "RGBA", "L", "LA"):
        image = image.convert("RGBA" if has_alpha else "RGB")

    image.thumbnail(MAX_DIMENSIONS, Image.LANCZOS)
    data = _encode(image, fmt)

    for _ in range(6):  # still heavy (a photo-like PNG, say): halve the quality / shrink, then re-encode
        if len(data) <= TARGET_BYTES:
            break
        if fmt == "PNG" and not has_alpha:
            fmt = "JPEG"  # an opaque PNG that big is a photograph; JPEG is far smaller
            data = _encode(image, fmt, 80)
            continue
        image = image.resize((max(1, int(image.width * 0.75)), max(1, int(image.height * 0.75))), Image.LANCZOS)
        data = _encode(image, fmt, 78)

    if len(data) > HARD_LIMIT_BYTES:
        raise serializers.ValidationError("This logo is too detailed. Try a simpler or smaller image.")
    return data, "image/png" if fmt == "PNG" else "image/jpeg"


def store_logo(upload):
    """Normalize `upload` and save it as a LogoImage (re-using an identical one already stored)."""
    from .models import LogoImage

    data, content_type = normalize_logo(upload)
    digest = hashlib.sha256(data).hexdigest()
    return LogoImage.objects.filter(sha256=digest).first() or LogoImage.objects.create(
        data=data, content_type=content_type, sha256=digest,
    )

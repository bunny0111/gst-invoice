"""Small secrets a business gives us (its SMTP password) are stored encrypted, never in plain text.

The key is derived from SECRET_KEY, so a database dump alone can't reveal them. Rotating SECRET_KEY makes the stored
values unreadable - the business then simply re-enters its password (decrypt() returns "" rather than crashing).
"""
import base64
import hashlib

from django.conf import settings


def _fernet():
    from cryptography.fernet import Fernet

    key = hashlib.sha256(f"smtp-password:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode() if value else ""


def decrypt(token: str) -> str:
    from cryptography.fernet import InvalidToken

    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return ""

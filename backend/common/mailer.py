"""Sending invoice emails through the business's OWN mail server when it has set one up (Business profile -> Email).

Without one, mail goes out through the platform's sender (settings.EMAIL_* / Resend) with the business's address as
Reply-To, exactly as before.
"""
import smtplib
import socket
import ssl

from django.conf import settings
from django.core.mail import get_connection

from . import crypto

SMTP_TIMEOUT = 15  # seconds - a wrong host must fail fast, not hang the request


def smtp_connection(host: str, port: int, security: str, username: str, password: str):
    return get_connection(
        "django.core.mail.backends.smtp.EmailBackend", host=host, port=port,
        username=username or None, password=password or None,
        use_tls=security == "starttls", use_ssl=security == "ssl", timeout=SMTP_TIMEOUT, fail_silently=False,
    )


def business_sender(profile) -> tuple[object | None, str]:
    """(connection, From header) for mail sent on behalf of `profile`. connection None = the platform default."""
    if profile.smtp_enabled and profile.smtp_host and profile.smtp_from_email:
        connection = smtp_connection(profile.smtp_host, profile.smtp_port, profile.smtp_security,
                                     profile.smtp_username, crypto.decrypt(profile.smtp_password))
        name = (profile.smtp_from_name or profile.business_name).replace('"', "")
        return connection, f'"{name}" <{profile.smtp_from_email}>'
    return None, settings.DEFAULT_FROM_EMAIL


def smtp_error_message(exc: Exception) -> str:
    """Turn an SMTP/socket failure into a sentence a shopkeeper can act on."""
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return ("The server rejected the username or password. For Gmail, turn on 2-step verification and use an "
                "App Password instead of your normal password.")
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "The server refused the From email. Use the email address of the account you log in with."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "The server refused to deliver to your login email address."
    if isinstance(exc, (socket.gaierror, ConnectionRefusedError)):
        return "Couldn't reach that server. Check the server name and port."
    if isinstance(exc, (socket.timeout, TimeoutError)) or "timed out" in str(exc):
        return "The server didn't answer in time. Check the port and the security setting (587 = STARTTLS, 465 = SSL)."
    if isinstance(exc, (ssl.SSLError, smtplib.SMTPNotSupportedError, smtplib.SMTPServerDisconnected)):
        return "The secure connection failed. Try the other security setting (587 = STARTTLS, 465 = SSL)."
    return "The email couldn't be sent with these settings. Check them and try again."

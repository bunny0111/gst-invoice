"""Thin Razorpay Subscriptions client over plain HTTPS (no SDK dependency).

Docs: https://razorpay.com/docs/api/payments/subscriptions/
"""
import hashlib
import hmac
import logging

import requests
from django.conf import settings

log = logging.getLogger(__name__)
API = "https://api.razorpay.com/v1"


class RazorpayError(Exception):
    pass


def _request(method: str, path: str, **kwargs) -> dict:
    try:
        resp = requests.request(
            method, f"{API}{path}", auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET),
            timeout=20, **kwargs,
        )
    except requests.RequestException as exc:  # network problem
        raise RazorpayError("Could not reach Razorpay. Please try again.") from exc
    if resp.status_code >= 400:
        try:
            message = resp.json().get("error", {}).get("description", resp.text)
        except ValueError:
            message = resp.text
        log.warning("Razorpay %s %s -> %s %s", method, path, resp.status_code, message)
        raise RazorpayError(message)
    return resp.json()


def create_plan(name: str, amount_rupees: int) -> dict:
    return _request("POST", "/plans", json={
        "period": "monthly", "interval": 1,
        "item": {"name": name, "amount": amount_rupees * 100, "currency": "INR"},
    })


def create_subscription(plan_id: str, schema_name: str, plan_key: str) -> dict:
    return _request("POST", "/subscriptions", json={
        "plan_id": plan_id, "total_count": 120, "customer_notify": 1,
        "notes": {"schema": schema_name, "plan": plan_key},
    })


def fetch_subscription(subscription_id: str) -> dict:
    return _request("GET", f"/subscriptions/{subscription_id}")


def cancel_subscription(subscription_id: str, at_cycle_end: bool = True) -> dict:
    return _request("POST", f"/subscriptions/{subscription_id}/cancel",
                    json={"cancel_at_cycle_end": 1 if at_cycle_end else 0})


def verify_checkout_signature(payment_id: str, subscription_id: str, signature: str) -> bool:
    """Checkout success signature = HMAC_SHA256(payment_id|subscription_id, key_secret)."""
    expected = hmac.new(
        settings.RAZORPAY_KEY_SECRET.encode(), f"{payment_id}|{subscription_id}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature or "")


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    secret = settings.RAZORPAY_WEBHOOK_SECRET
    if not secret:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")

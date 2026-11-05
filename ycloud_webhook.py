"""YCloud webhook verification and event ingestion.

Provider contract: YCloud-Signature is t=<unix-seconds>,s=<lowercase-hex-HMAC>.
The signed bytes are ASCII(timestamp) + b"." + the exact raw HTTP body.
"""
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any

from idempotency import (
    IdempotencyRecord,
    check_idempotency,
    persist_event,
)
from middleware import log_event, mask_secret

_SIGNATURE_RE = re.compile(r"^t=([1-9][0-9]*),s=([0-9a-f]{64})$")


def verify_ycloud_signature(
    body_bytes: bytes,
    signature_header: str,
    secret: str,
    *,
    now_seconds: int | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    """Verify YCloud's signature against exact raw bytes; fail closed."""
    if not body_bytes or not signature_header or not secret:
        return False
    match = _SIGNATURE_RE.fullmatch(signature_header.strip())
    if not match:
        return False

    timestamp_text, supplied_hex = match.groups()
    timestamp = int(timestamp_text)
    now = int(time.time()) if now_seconds is None else int(now_seconds)
    if abs(now - timestamp) > tolerance_seconds:
        return False

    signed_bytes = timestamp_text.encode("ascii") + b"." + body_bytes
    expected_hex = hmac.new(
        secret.encode("utf-8"), signed_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected_hex, supplied_hex)


def _normalise_event(event: dict[str, Any]) -> dict[str, Any]:
    event_type = event.get("type", "unknown")
    inbound = event.get("whatsappInboundMessage") or {}
    profile = inbound.get("customerProfile") or {}
    message_type = inbound.get("type", "")
    text_obj = inbound.get("text") or {}
    text = text_obj.get("body", "") if isinstance(text_obj, dict) else ""
    if not text and message_type in ("image", "video", "document"):
        media_obj = inbound.get(message_type) or {}
        text = media_obj.get("caption", "") if isinstance(media_obj, dict) else ""

    return {
        "source": "whatsapp",
        "provider": "ycloud",
        "provider_event_id": event.get("id", ""),
        "provider_event_type": event_type,
        "event_type": "message" if event_type == "whatsapp.inbound_message.received" else "status",
        "user_id": inbound.get("from", ""),
        "phone": inbound.get("from", ""),
        "handle": profile.get("username") or profile.get("name"),
        "customer_name": profile.get("name"),
        "text": text if isinstance(text, str) else "",
        "message_type": message_type,
        "conversation_id": inbound.get("id", ""),
        "wamid": inbound.get("wamid", ""),
        "raw": event,
    }


def handle_ycloud_webhook(
    body_bytes: bytes,
    signature_header: str,
    endpoint_id_header: str = "",
) -> tuple[int, dict[str, Any]]:
    secret = os.environ.get("YCLOUD_WEBHOOK_SECRET", "")
    expected_endpoint_id = os.environ.get("YCLOUD_WEBHOOK_ENDPOINT_ID", "")

    if not verify_ycloud_signature(body_bytes, signature_header, secret):
        log_event("ycloud_webhook_rejected", {"reason": "invalid_signature"})
        return 401, {"error": "invalid_signature"}

    if expected_endpoint_id and not hmac.compare_digest(
        expected_endpoint_id, endpoint_id_header or ""
    ):
        log_event("ycloud_webhook_rejected", {"reason": "endpoint_id_mismatch"})
        return 401, {"error": "endpoint_id_mismatch"}

    try:
        event = json.loads(body_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, {"error": "invalid_json"}

    if not isinstance(event, dict):
        return 400, {"error": "invalid_event"}

    provider_event_id = event.get("id")
    provider_event_type = event.get("type")
    if not isinstance(provider_event_id, str) or not provider_event_id:
        return 400, {"error": "missing_event_id"}
    if not isinstance(provider_event_type, str) or not provider_event_type:
        return 400, {"error": "missing_event_type"}

    endpoint_scope = expected_endpoint_id or endpoint_id_header or "default"
    dedupe_key = hashlib.sha256(
        f"ycloud:{endpoint_scope}:{provider_event_id}".encode("utf-8")
    ).hexdigest()
    internal_event_id = "ycloud_" + dedupe_key[:32]

    # Check existing event first. A missing DB connection returns None and
    # must not be mistaken for a new event.
    existing = check_idempotency(dedupe_key)
    if existing is not None:
        return 200, {"status": "duplicate"}

    normalized = _normalise_event(event)
    normalized["event_id"] = internal_event_id
    normalized["dedupe_key"] = dedupe_key

    record = IdempotencyRecord(
        event_id=internal_event_id,
        dedupe_key=dedupe_key,
        source="ycloud",
        event_type=provider_event_type,
        payload=normalized,
    )
    if not persist_event(record):
        # Recheck to distinguish a concurrent duplicate from a DB failure.
        if check_idempotency(dedupe_key) is not None:
            return 200, {"status": "duplicate"}
        log_event("ycloud_webhook_persist_failed", {
            "event_id": internal_event_id,
            "event_type": provider_event_type,
        }, level="error")
        return 503, {"error": "event_persistence_unavailable"}

    # Only inbound customer messages enter the AI lead-processing queue.
    # Status and unfamiliar events are durably stored but never treated as leads.
    if provider_event_type == "whatsapp.inbound_message.received":
        from webhook import enqueue_event
        enqueue_event(normalized)

    log_event("ycloud_webhook_accepted", {
        "event_id": internal_event_id,
        "event_type": provider_event_type,
        "phone": mask_secret(normalized.get("phone")),
    })
    return 200, {"status": "accepted", "event_id": internal_event_id}

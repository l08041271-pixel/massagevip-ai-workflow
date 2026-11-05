"""
Legacy WAHA/Meta webhook ingestion.
YCloud traffic uses the dedicated /webhooks/ycloud receiver.
"""
import hashlib
import hmac
import json
import os
import threading
from typing import Any

from middleware import correlation_id, log_event, mask_secret
from idempotency import (
    check_idempotency, generate_dedupe_key, generate_event_id, is_opted_out,
    mark_processed, persist_event, send_to_dead_letter, IdempotencyRecord,
)
from whatsapp_provider import get_whatsapp_provider

VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
APP_SECRET = os.environ.get("WHATSAPP_APP_SECRET", "")
_pending_queue: list[dict[str, Any]] = []
_queue_lock = threading.Lock()
_provider = get_whatsapp_provider()


def enqueue_event(event: dict[str, Any]) -> None:
    with _queue_lock:
        _pending_queue.append(event)


def drain_queue() -> list[dict[str, Any]]:
    with _queue_lock:
        items = list(_pending_queue)
        _pending_queue.clear()
    return items


def _normalize_whatsapp_payload(body: dict[str, Any]) -> dict[str, Any]:
    return _provider.normalize_incoming(body)


def _verify_signature(body_bytes: bytes, signature: str) -> bool:
    # Meta's X-Hub-Signature-256 requires both a configured app secret and header.
    secret = os.environ.get("WHATSAPP_APP_SECRET", "")
    if not secret or not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"), body_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_webhook(body_bytes: bytes, signature: str = "") -> tuple[int, dict[str, Any]]:
    if not _verify_signature(body_bytes, signature):
        return 401, {"error": "invalid_signature"}

    try:
        body = json.loads(body_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, {"error": "bad_json"}
    if not isinstance(body, dict):
        return 400, {"error": "invalid_event"}

    cid = correlation_id()
    normalized = _normalize_whatsapp_payload(body)
    normalized["event_id"] = generate_event_id(normalized["source"], normalized.get("user_id", "unknown"))
    normalized["dedupe_key"] = generate_dedupe_key(
        normalized["source"], normalized.get("user_id", ""), normalized.get("text", "")
    )

    existing = check_idempotency(normalized["dedupe_key"])
    if existing is not None:
        return 200, {"status": "duplicate"}

    if is_opted_out(normalized.get("phone")):
        log_event("webhook_opted_out", {"phone": mask_secret(normalized.get("phone")), "correlation_id": cid})
        return 200, {"status": "opted_out"}

    record = IdempotencyRecord(
        event_id=normalized["event_id"], dedupe_key=normalized["dedupe_key"],
        source=normalized["source"], event_type=normalized["event_type"], payload=normalized,
    )
    if not persist_event(record):
        if check_idempotency(normalized["dedupe_key"]) is not None:
            return 200, {"status": "duplicate"}
        return 503, {"status": "persist_failed"}

    enqueue_event(normalized)
    log_event("webhook_accepted", {"event_id": normalized["event_id"], "correlation_id": cid})
    return 200, {"status": "accepted", "event_id": normalized["event_id"]}

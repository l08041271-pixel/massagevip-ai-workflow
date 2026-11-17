"""
Meta/WAHA webhook verification and event ingestion.
Meta requests are authenticated with X-Hub-Signature-256 over the raw body.
"""
import hashlib
import hmac
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import parse_qs

from middleware import correlation_id, log_event, mask_secret
from idempotency import (
    check_idempotency, generate_dedupe_key, generate_event_id, is_opted_out,
    mark_processed, persist_event, send_to_dead_letter, IdempotencyRecord,
)
from whatsapp_provider import get_whatsapp_provider, WahaProvider

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


def _normalize_whatsapp_payloads(body: dict[str, Any]) -> list[dict[str, Any]]:
    normalizer = getattr(_provider, "normalize_incoming_events", None)
    if callable(normalizer):
        return normalizer(body)
    normalized = _normalize_whatsapp_payload(body)
    return [normalized] if normalized.get("event_type") == "message" else []


def _is_waha_provider() -> bool:
    return isinstance(_provider, WahaProvider)


def verify_webhook_challenge(query: dict[str, str]) -> tuple[int, str]:
    challenge = query.get("hub.challenge", "")
    if challenge and _provider.verify_webhook(query):
        return 200, challenge
    return 403, "forbidden"


def _verify_signature(body_bytes: bytes, signature: str) -> bool:
    # Keep legacy WAHA deployments operational; Meta mode is fail-closed.
    if _is_waha_provider():
        secret = os.environ.get("WAHA_WEBHOOK_SECRET", "")
        if not secret or not signature:
            return True
    else:
        secret = os.environ.get("WHATSAPP_APP_SECRET", "")
        if not secret or not signature:
            return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_webhook(body_bytes: bytes, signature: str = "") -> tuple[int, dict[str, Any]]:
    if not _is_waha_provider() and not os.environ.get("WHATSAPP_APP_SECRET"):
        return 503, {"error": "webhook_signature_validation_not_configured"}
    if not _verify_signature(body_bytes, signature):
        return 401, {"error": "invalid_signature"}

    try:
        body = json.loads(body_bytes)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return 400, {"error": "bad_json"}
    if not isinstance(body, dict):
        return 400, {"error": "bad_payload"}

    cid = correlation_id()
    log_event("webhook_received", {"correlation_id": cid, "provider": "waha" if _is_waha_provider() else "meta"})

    # Delivery/read/failure receipts are not inbound leads. Acknowledge and log
    # minimal identifiers; do not send them through AI qualification.
    status_count = 0
    for entry in body.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for status_event in value.get("statuses") or []:
                status_count += 1
                log_event("meta_whatsapp_status", {
                    "message_id": status_event.get("id"),
                    "status": status_event.get("status"),
                    "recipient": mask_secret(str(status_event.get("recipient_id", ""))),
                })

    normalized_events = _normalize_whatsapp_payloads(body)
    if not normalized_events:
        return 200, {"status": "status_acknowledged" if status_count else "ignored", "statuses": status_count}

    accepted = 0
    duplicates = 0
    for normalized in normalized_events:
        if not normalized.get("phone"):
            log_event("webhook_message_missing_sender", {"correlation_id": cid}, level="warning")
            continue
        normalized["event_id"] = generate_event_id(normalized["source"], normalized.get("user_id", "unknown"))
        external_id = normalized.get("conversation_id") or ""
        normalized["dedupe_key"] = generate_dedupe_key(
            normalized["source"], normalized.get("user_id", ""), external_id or normalized.get("text", "")
        )

        existing = check_idempotency(normalized["dedupe_key"])
        if existing is not None:
            duplicates += 1
            continue

        if is_opted_out(normalized.get("phone")):
            log_event("webhook_opted_out", {"phone": mask_secret(normalized.get("phone")), "correlation_id": cid})
            continue

        record = IdempotencyRecord(
            event_id=normalized["event_id"],
            dedupe_key=normalized["dedupe_key"],
            source=normalized["source"],
            event_type=normalized["event_type"],
            payload=normalized,
        )
        if not persist_event(record):
            send_to_dead_letter(record, "persist_failed")
            return 500, {"status": "persist_failed"}
        enqueue_event(normalized)
        accepted += 1

    log_event("webhook_processed", {
        "correlation_id": cid, "accepted": accepted, "duplicates": duplicates, "statuses": status_count,
    })
    return 200, {"status": "accepted", "accepted": accepted, "duplicates": duplicates, "statuses": status_count}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        query = {key: values[-1] for key, values in parse_qs(self.path.partition("?")[2]).items()}
        status, body = verify_webhook_challenge(query)
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_response(400)
            self.end_headers()
            return
        if content_length <= 0 or content_length > 2_000_000:
            self.send_response(413 if content_length > 2_000_000 else 400)
            self.end_headers()
            return
        body_bytes = self.rfile.read(content_length)
        status, response = handle_webhook(body_bytes, self.headers.get("X-Hub-Signature-256", ""))
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode("utf-8"))


def start_webhook_server(port: int = 8080) -> threading.Thread:
    server = HTTPServer(("0.0.0.0", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log_event("webhook_server_started", {"port": port})
    return thread


if __name__ == "__main__":
    import time
    start_webhook_server(int(os.environ.get("PORT", 8080)))
    while True:
        time.sleep(60)

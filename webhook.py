"""
WhatsApp webhook verification and HTTPS event ingestion.
Provider-portable boundary: webhook transport isolated from business logic.
"""
import hashlib
import hmac
import json
import os
import threading
from http.server import BaseHTTPRequestHandler
from typing import Any

from middleware import correlation_id, log_event, mask_secret, validate_config
from idempotency import (
    check_idempotency,
    generate_dedupe_key,
    generate_event_id,
    is_opted_out,
    mark_processed,
    persist_event,
    send_to_dead_letter,
    IdempotencyRecord,
)
from whatsapp_provider import get_whatsapp_provider

VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
APP_SECRET = os.environ.get("WHATSAPP_APP_SECRET", "")
PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")

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
    if not signature:
        return True
    import hashlib, hmac
    secret = os.environ.get("WHATSAPP_APP_SECRET", "") or os.environ.get("WAHA_WEBHOOK_SECRET", "")
    if not secret:
        return True
    expected = "sha256=" + hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_webhook(body_bytes: bytes, signature: str = "") -> tuple[int, dict[str, Any]]:
    if signature and not _verify_signature(body_bytes, signature):
        return 403, {"error": "invalid_signature"}

    try:
        body = json.loads(body_bytes)
    except json.JSONDecodeError:
        return 400, {"error": "bad_json"}

    cid = correlation_id()
    log_event("webhook_received", {"correlation_id": cid, "keys": list(body.keys())})

    normalized = _normalize_whatsapp_payload(body)
    normalized["event_id"] = generate_event_id(normalized["source"], normalized.get("user_id", "unknown"))
    normalized["dedupe_key"] = generate_dedupe_key(
        normalized["source"], normalized.get("user_id", ""), normalized.get("text", "")
    )

    existing = check_idempotency(normalized["dedupe_key"])
    if existing is True:
        log_event("webhook_duplicate", {"dedupe_key": normalized["dedupe_key"], "correlation_id": cid})
        return 200, {"status": "duplicate"}
    if existing is False:
        log_event("webhook_replay", {"event_id": normalized["event_id"], "correlation_id": cid})
        return 200, {"status": "replay"}

    if is_opted_out(normalized.get("phone")):
        log_event("webhook_opted_out", {"phone": mask_secret(normalized.get("phone")), "correlation_id": cid})
        return 200, {"status": "opted_out"}

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
    log_event("webhook_accepted", {"event_id": normalized["event_id"], "correlation_id": cid})
    return 200, {"status": "accepted", "event_id": normalized["event_id"]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if _provider.verify_webhook({"hub.mode": self.path.split("hub.mode=")[-1].split("&")[0] if "hub.mode=" in self.path else "",
                                      "hub.verify_token": self.path.split("hub.verify_token=")[-1].split("&")[0] if "hub.verify_token=" in self.path else "",
                                      "hub.challenge": self.path.split("hub.challenge=")[-1].split("&")[0] if "hub.challenge=" in self.path else ""}):
            challenge = self.path.split("hub.challenge=")[-1].split("&")[0] if "hub.challenge=" in self.path else ""
            self.send_response(200)
            self.end_headers()
            self.wfile.write(challenge.encode())
            log_event("webhook_verified", {"provider": "whatsapp"})
        else:
            self.send_response(403)
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length)
        signature = self.headers.get("X-Hub-Signature-256", "")
        status, response = handle_webhook(body_bytes, signature)
        self.send_response(status)
        self.end_headers()
        if response:
            self.wfile.write(json.dumps(response).encode())


def start_webhook_server(port: int = 8080) -> threading.Thread:
    import threading
    server = HTTPServer(("0.0.0.0", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    log_event("webhook_server_started", {"port": port})
    return thread


if __name__ == "__main__":
    start_webhook_server(int(os.environ.get("PORT", 8080)))
    import time
    while True:
        time.sleep(60)

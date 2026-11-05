"""YCloud webhook receiver: raw-body HMAC verification and durable inbox.

The endpoint secret is injected server-side as YCLOUD_WEBHOOK_SECRET.
This module does not perform event-specific business projection.
"""
import hashlib
import hmac
import json
import os
import re
import time
from typing import Any

from middleware import log_event

_SIGNATURE_RE = re.compile(r"^t=([1-9][0-9]*),s=([0-9a-f]{64})$")


def verify_ycloud_signature(
    raw_body: bytes,
    signature_header: str,
    secret: str,
    now_seconds: int | None = None,
    tolerance_seconds: int = 300,
) -> bool:
    if not secret or not isinstance(raw_body, bytes):
        return False
    match = _SIGNATURE_RE.fullmatch(signature_header or "")
    if not match:
        return False
    timestamp_text, supplied_hex = match.groups()
    timestamp = int(timestamp_text)
    now = int(time.time()) if now_seconds is None else int(now_seconds)
    if abs(now - timestamp) > tolerance_seconds:
        return False
    signed = timestamp_text.encode("ascii") + b"." + raw_body
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).digest()
    try:
        supplied = bytes.fromhex(supplied_hex)
    except ValueError:
        return False
    return hmac.compare_digest(expected, supplied)


def _persist_event(endpoint_id: str, event_id: str, event_type: str, payload: dict[str, Any], raw_body: bytes) -> str:
    """Durably insert or classify an event. Returns new, duplicate, or conflict."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("database_not_configured")
    import psycopg2
    from psycopg2.extras import Json

    digest = hashlib.sha256(raw_body).hexdigest()
    conn = psycopg2.connect(database_url, sslmode="require")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ycloud_webhook_inbox
                    (endpoint_id, event_id, event_type, payload_hash, payload)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (endpoint_id, event_id) DO NOTHING
                RETURNING event_id
                """,
                (endpoint_id, event_id, event_type, digest, Json(payload)),
            )
            if cur.fetchone():
                conn.commit()
                return "new"

            cur.execute(
                "SELECT payload_hash FROM ycloud_webhook_inbox WHERE endpoint_id=%s AND event_id=%s FOR UPDATE",
                (endpoint_id, event_id),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError("inbox_conflict_row_missing")
            if hmac.compare_digest(row[0], digest):
                conn.commit()
                return "duplicate"

            cur.execute(
                """
                UPDATE ycloud_webhook_inbox
                   SET conflict_count = conflict_count + 1,
                       last_conflict_hash = %s,
                       conflict_detected_at = now()
                 WHERE endpoint_id = %s AND event_id = %s
                """,
                (digest, endpoint_id, event_id),
            )
            conn.commit()
            return "conflict"
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def handle_ycloud_webhook(
    raw_body: bytes,
    signature_header: str,
    endpoint_header: str,
) -> tuple[int, dict[str, Any]]:
    secret = os.environ.get("YCLOUD_WEBHOOK_SECRET", "")
    trusted_endpoint_id = os.environ.get("YCLOUD_WEBHOOK_ENDPOINT_ID", "")
    tolerance = int(os.environ.get("YCLOUD_WEBHOOK_TOLERANCE_SECONDS", "300"))

    # Endpoint identity is selected only from trusted server configuration.
    if not trusted_endpoint_id or not endpoint_header or not hmac.compare_digest(
        trusted_endpoint_id, endpoint_header
    ):
        return 401, {"error": "invalid_webhook_endpoint"}
    if not verify_ycloud_signature(raw_body, signature_header, secret, tolerance_seconds=tolerance):
        return 401, {"error": "invalid_signature"}

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 400, {"error": "invalid_json"}
    if not isinstance(payload, dict):
        return 400, {"error": "invalid_event_envelope"}

    event_id = payload.get("id")
    event_type = payload.get("type")
    if not isinstance(event_id, str) or not event_id or not isinstance(event_type, str) or not event_type:
        return 400, {"error": "invalid_event_envelope"}

    try:
        classification = _persist_event(trusted_endpoint_id, event_id, event_type, payload, raw_body)
    except Exception as exc:
        log_event("ycloud_inbox_persist_failed", {"error_type": type(exc).__name__}, level="error")
        return 503, {"error": "inbox_unavailable"}

    if classification == "conflict":
        log_event("ycloud_event_id_conflict", {"endpoint_id": trusted_endpoint_id, "event_id": event_id}, level="error")
    else:
        log_event("ycloud_webhook_accepted", {
            "endpoint_id": trusted_endpoint_id,
            "event_id": event_id,
            "event_type": event_type,
            "classification": classification,
        })
    # A 2xx is returned only after the inbox commit succeeds.
    return 200, {"status": "accepted", "classification": classification, "event_id": event_id}

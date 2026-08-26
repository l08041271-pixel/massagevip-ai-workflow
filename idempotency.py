"""
Idempotency enforcement and dead-letter handling.
Ensures no duplicate automated messages and provides failure isolation.
"""
import hashlib
import json
import os
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import log_event

DATABASE_URL = os.environ.get("DATABASE_URL")


def _import_psycopg2():
    try:
        import psycopg2
        from psycopg2.extras import Json
        return psycopg2, Json
    except ImportError:
        return None, None


@dataclass
class IdempotencyRecord:
    event_id: str
    dedupe_key: str
    source: str
    event_type: str
    payload: dict[str, Any]
    processed: bool = False
    processing_error: Optional[str] = None
    dead_letter: bool = False
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    processed_at: Optional[str] = None


def _get_conn():
    if not DATABASE_URL:
        return None
    psycopg2, _ = _import_psycopg2()
    if not psycopg2:
        return None
    return psycopg2.connect(DATABASE_URL, sslmode="require")


def _get_json():
    _, Json = _import_psycopg2()
    return Json


def generate_dedupe_key(source: str, user_id: str, text: str) -> str:
    raw = f"{source}:{user_id}:{text[:100]}"
    return hashlib.md5(raw.encode()).hexdigest()


def generate_event_id(source: str, user_id: str, timestamp: Optional[str] = None) -> str:
    ts = timestamp or datetime.now(timezone.utc).isoformat()
    return f"evt_{source[:2]}_{uuid.uuid4().hex[:12]}"


def check_idempotency(dedupe_key: str) -> Optional[bool]:
    conn = _get_conn()
    if not conn:
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT processed FROM event_store WHERE dedupe_key = %s", (dedupe_key,))
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


def persist_event(record: IdempotencyRecord) -> bool:
    conn = _get_conn()
    if not conn:
        return False
    Json = _get_json()
    if not Json:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO event_store (event_id, source, event_type, timestamp, payload, dedupe_key, processed)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (event_id) DO NOTHING
                """,
                (
                    record.event_id,
                    record.source,
                    record.event_type,
                    record.created_at,
                    Json(record.payload),
                    record.dedupe_key,
                    record.processed,
                ),
            )
            if cur.rowcount == 0:
                return False
        conn.commit()
        return True
    except Exception as exc:
        log_event("idempotency_persist_failed", {"error": str(exc)}, level="error")
        conn.rollback()
        return False
    finally:
        conn.close()


def mark_processed(event_id: str, success: bool = True, error: Optional[str] = None) -> None:
    conn = _get_conn()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE event_store SET processed = %s WHERE event_id = %s",
                (success, event_id),
            )
        conn.commit()
    except Exception as exc:
        log_event("idempotency_mark_failed", {"error": str(exc)}, level="error")
        conn.rollback()
    finally:
        conn.close()


def send_to_dead_letter(record: IdempotencyRecord, reason: str) -> None:
    conn = _get_conn()
    if not conn:
        return
    Json = _get_json()
    if not Json:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO dead_letter_queue (event_id, reason, payload, created_at)
                VALUES (%s, %s, %s, %s)
                """,
                (record.event_id, reason, Json(record.payload), datetime.now(timezone.utc).isoformat()),
            )
        conn.commit()
        log_event("dead_letter", {"event_id": record.event_id, "reason": reason})
    except Exception as exc:
        log_event("dead_letter_failed", {"error": str(exc)}, level="error")
        conn.rollback()
    finally:
        conn.close()


def is_opted_out(phone: Optional[str]) -> bool:
    if not phone or not DATABASE_URL:
        return False
    conn = _get_conn()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT opt_out FROM contacts WHERE phone = %s", (phone,))
            row = cur.fetchone()
            return bool(row[0]) if row else False
    finally:
        conn.close()

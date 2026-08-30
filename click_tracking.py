"""
WhatsApp click tracking for MassageVIP lead capture.
Captures the moment a visitor clicks the WhatsApp booking button.
"""
import hashlib
import hmac
import json
import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import log_event


class ClickStore(ABC):
    @abstractmethod
    def track(self, payload: dict) -> dict:
        raise NotImplementedError


class PostgresClickStore(ClickStore):
    def track(self, payload: dict) -> dict:
        import psycopg2

        if not payload.get("source") and not payload.get("landing_page"):
            return {"error": "missing_source_and_landing_page", "status": "rejected"}

        click_id = uuid.uuid4().hex
        timestamp = payload.get("timestamp", datetime.now(timezone.utc).isoformat())
        source = payload.get("source", "whatsapp_click")
        campaign = payload.get("campaign", "")
        landing_page = payload.get("landing_page", "")
        referrer = payload.get("referrer", "")
        device = payload.get("device", "")
        user_agent = payload.get("user_agent", "")
        ip = payload.get("ip", "")
        lead_id = payload.get("lead_id")

        url = os.environ.get("DATABASE_URL")
        if not url:
            return {"error": "no_database", "status": "rejected"}

        conn = psycopg2.connect(url, sslmode="require")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO whatsapp_clicks
                    (click_id, source, campaign, landing_page, referrer, device, user_agent, ip, lead_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (click_id, source, campaign, landing_page, referrer, device, user_agent, ip, lead_id, timestamp),
                )
            conn.commit()
        finally:
            conn.close()

        log_event("whatsapp_click_tracked", {"click_id": click_id, "source": source, "landing_page": landing_page})
        return {"click_id": click_id, "status": "tracked"}


class MockClickStore(ClickStore):
    def __init__(self) -> None:
        self._clicks: list[dict] = []

    def track(self, payload: dict) -> dict:
        if not payload.get("source") and not payload.get("landing_page"):
            return {"error": "missing_source_and_landing_page", "status": "rejected"}

        click_id = uuid.uuid4().hex
        timestamp = payload.get("timestamp", datetime.now(timezone.utc).isoformat())
        source = payload.get("source", "whatsapp_click")
        campaign = payload.get("campaign", "")
        landing_page = payload.get("landing_page", "")
        referrer = payload.get("referrer", "")
        device = payload.get("device", "")
        user_agent = payload.get("user_agent", "")
        ip = payload.get("ip", "")
        lead_id = payload.get("lead_id")

        record = {
            "click_id": click_id,
            "timestamp": timestamp,
            "source": source,
            "campaign": campaign,
            "landing_page": landing_page,
            "referrer": referrer,
            "device": device,
            "user_agent": user_agent,
            "ip": ip,
            "lead_id": lead_id,
        }
        self._clicks.append(record)

        log_event("whatsapp_click_tracked", {"click_id": click_id, "source": source, "landing_page": landing_page})
        return {"click_id": click_id, "status": "tracked"}


_click_store: Optional[ClickStore] = None


def get_click_store() -> ClickStore:
    global _click_store
    if _click_store is None:
        if os.environ.get("DATABASE_URL"):
            _click_store = PostgresClickStore()
        else:
            _click_store = MockClickStore()
    return _click_store


def _correlate_lead(payload: dict) -> Optional[str]:
    try:
        from leads import get_lead_store, Lead
    except ImportError:
        return None

    phone = payload.get("phone", "")
    email = payload.get("email", "")
    if not phone and not email:
        return None

    lead_data = {"source": payload.get("source", "whatsapp_click"), "campaign": payload.get("campaign", "")}
    if phone:
        lead_data["phone"] = phone
    if email:
        lead_data["email"] = email
    if payload.get("name"):
        lead_data["name"] = payload["name"]

    try:
        lead = get_lead_store().upsert_lead(Lead(**lead_data))
        return lead.id if hasattr(lead, "id") else lead.get("id")
    except Exception as e:
        log_event("click_lead_correlation_failed", {"error": str(e)}, level="warning")
        return None


def track_whatsapp_click(payload: dict, client_ip: str = "") -> dict:
    if not payload.get("source") and not payload.get("landing_page"):
        return {"error": "missing_source_and_landing_page", "status": "rejected"}

    lead_id = _correlate_lead(payload)
    local_payload = dict(payload)
    if client_ip:
        local_payload["ip"] = client_ip
    if lead_id:
        local_payload["lead_id"] = lead_id

    store = get_click_store()
    result = store.track(local_payload)
    if not lead_id:
        result["lead_correlated"] = False
    return result


def _verify_signature(body_bytes: bytes, signature: str) -> bool:
    if not signature:
        return True
    secret = os.environ.get("LEAD_WEBHOOK_SECRET", "")
    if not secret:
        return True
    expected = "sha256=" + hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_click_tracking(body_bytes: bytes, signature: str = "", client_ip: str = "") -> tuple[int, dict[str, Any]]:
    if signature and not _verify_signature(body_bytes, signature):
        return 403, {"error": "invalid_signature"}

    try:
        body = json.loads(body_bytes)
    except (json.JSONDecodeError, ValueError):
        return 400, {"error": "bad_json"}

    result = track_whatsapp_click(body, client_ip)
    if result.get("error"):
        return 400, result

    return 200, {"status": "tracked", "click_id": result["click_id"]}

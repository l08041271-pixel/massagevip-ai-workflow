"""
Typeform webhook integration.
Provider-portable: business logic never imports provider SDKs directly.
"""
import hashlib
import hmac
import json
import os
import uuid
from abc import ABC, abstractmethod
from typing import Any, Optional

from leads import Lead, get_lead_store, normalize_phone
from middleware import log_event


def _verify_signature(body_bytes: bytes, signature: str) -> bool:
    secret = os.environ.get("TYPEFORM_SECRET", "")
    if not signature:
        return True
    if not secret:
        return True
    expected = "sha256=" + hmac.new(secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def normalize_typeform(payload: dict) -> dict:
    form_response = payload.get("form_response", {})
    hidden = form_response.get("hidden", {}) or {}
    answers = form_response.get("answers", []) or []

    email = ""
    phone = ""
    name = ""

    for answer in answers:
        answer_type = answer.get("type", "")
        if answer_type == "email":
            email = answer.get("email", "") or ""
        elif answer_type == "phone_number":
            phone = answer.get("phone_number", "") or ""
        elif answer_type in ("text", "short_text"):
            field = answer.get("field", {}) or {}
            title = field.get("title", "") or ""
            if "name" in title.lower():
                name = answer.get("text", "") or ""

    campaign = hidden.get("campaign") or hidden.get("utm_campaign") or ""
    landing_page = hidden.get("landing_page") or ""

    phone = normalize_phone(phone)

    return {
        "email": email,
        "phone": phone,
        "name": name,
        "source": "typeform",
        "campaign": campaign,
        "landing_page": landing_page,
    }


class TypeformProvider(ABC):
    @abstractmethod
    def handle_typeform_webhook(
        self, body_bytes: bytes, signature: str = ""
    ) -> tuple[int, dict[str, Any]]:
        raise NotImplementedError


class PostgresTypeformProvider(TypeformProvider):
    def handle_typeform_webhook(
        self, body_bytes: bytes, signature: str = ""
    ) -> tuple[int, dict[str, Any]]:
        if not _verify_signature(body_bytes, signature):
            log_event("typeform_signature_invalid", {})
            return 403, {"error": "invalid_signature"}

        try:
            payload = json.loads(body_bytes)
        except (json.JSONDecodeError, ValueError):
            return 400, {"error": "bad_json"}

        lead_data = normalize_typeform(payload)
        lead_data["id"] = str(uuid.uuid4())
        lead = Lead(**lead_data)

        store = get_lead_store()
        created_lead = store.upsert_lead(lead)

        log_event("typeform_lead_created", {"lead_id": created_lead.id})
        return 200, {"status": "lead_created", "lead_id": created_lead.id}


class MockTypeformProvider(TypeformProvider):
    def __init__(self) -> None:
        self._leads: dict[str, Lead] = {}

    def handle_typeform_webhook(
        self, body_bytes: bytes, signature: str = ""
    ) -> tuple[int, dict[str, Any]]:
        if not _verify_signature(body_bytes, signature):
            log_event("typeform_signature_invalid", {})
            return 403, {"error": "invalid_signature"}

        try:
            payload = json.loads(body_bytes)
        except (json.JSONDecodeError, ValueError):
            return 400, {"error": "bad_json"}

        lead_data = normalize_typeform(payload)
        lead_data["id"] = str(uuid.uuid4())
        lead = Lead(**lead_data)

        store = get_lead_store()
        created_lead = store.upsert_lead(lead)
        self._leads[created_lead.id] = created_lead

        log_event("typeform_lead_created", {"lead_id": created_lead.id})
        return 200, {"status": "lead_created", "lead_id": created_lead.id}


_typeform_provider: Optional[TypeformProvider] = None


def get_typeform_provider() -> TypeformProvider:
    global _typeform_provider
    if _typeform_provider is None:
        if os.environ.get("DATABASE_URL"):
            _typeform_provider = PostgresTypeformProvider()
        else:
            _typeform_provider = MockTypeformProvider()
    return _typeform_provider

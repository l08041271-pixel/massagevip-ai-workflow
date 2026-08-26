"""
CRM abstraction layer.
Provider-portable: business logic never imports provider SDKs directly.
"""
import json
import os
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import log_event, mask_secret


class CRMProvider(ABC):
    @abstractmethod
    def upsert_contact(self, contact: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def update_contact(self, contact_id: str, data: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def create_conversation(self, contact_id: str, source: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def append_note(self, contact_id: str, note: str, author: str = "system") -> dict[str, Any]:
        raise NotImplementedError


class PostgresCRM(CRMProvider):
    def upsert_contact(self, contact: dict[str, Any]) -> dict[str, Any]:
        import psycopg2
        url = os.environ.get("DATABASE_URL")
        if not url:
            return contact
        conn = psycopg2.connect(url, sslmode="require")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO contacts (id, handle, phone, source, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET handle = EXCLUDED.handle, phone = EXCLUDED.phone, source = EXCLUDED.source
                    """,
                    (
                        contact.get("id"),
                        contact.get("handle"),
                        contact.get("phone"),
                        contact.get("source"),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
            conn.commit()
            log_event("crm_contact_upserted", {"contact_id": contact.get("id")})
            return contact
        finally:
            conn.close()

    def update_contact(self, contact_id: str, data: dict[str, Any]) -> dict[str, Any]:
        import psycopg2
        url = os.environ.get("DATABASE_URL")
        if not url:
            return {"id": contact_id, **data}
        conn = psycopg2.connect(url, sslmode="require")
        try:
            sets = []
            vals = []
            for k, v in data.items():
                sets.append(f"{k} = %s")
                vals.append(v)
            vals.append(contact_id)
            with conn.cursor() as cur:
                cur.execute(f"UPDATE contacts SET {', '.join(sets)} WHERE id = %s", tuple(vals))
            conn.commit()
            log_event("crm_contact_updated", {"contact_id": contact_id})
            return {"id": contact_id, **data}
        finally:
            conn.close()

    def create_conversation(self, contact_id: str, source: str) -> dict[str, Any]:
        import psycopg2
        import uuid
        url = os.environ.get("DATABASE_URL")
        if not url:
            return {"id": str(uuid.uuid4()), "contact_id": contact_id, "source": source}
        conn = psycopg2.connect(url, sslmode="require")
        try:
            cid = str(uuid.uuid4())
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO conversations (id, contact_id, source) VALUES (%s, %s, %s)",
                    (cid, contact_id, source),
                )
            conn.commit()
            log_event("crm_conversation_created", {"contact_id": contact_id, "conversation_id": cid})
            return {"id": cid, "contact_id": contact_id, "source": source}
        finally:
            conn.close()

    def append_note(self, contact_id: str, note: str, author: str = "system") -> dict[str, Any]:
        log_event("crm_note", {"contact_id": contact_id, "author": author, "note_len": len(note)})
        return {"contact_id": contact_id, "note": note, "author": author}


class MockCRM(CRMProvider):
    def upsert_contact(self, contact: dict[str, Any]) -> dict[str, Any]:
        log_event("crm_mock_upsert", {"id": contact.get("id")})
        return contact

    def update_contact(self, contact_id: str, data: dict[str, Any]) -> dict[str, Any]:
        log_event("crm_mock_update", {"contact_id": contact_id})
        return {"id": contact_id, **data}

    def create_conversation(self, contact_id: str, source: str) -> dict[str, Any]:
        import uuid
        cid = str(uuid.uuid4())
        log_event("crm_mock_conversation", {"contact_id": contact_id})
        return {"id": cid, "contact_id": contact_id, "source": source}

    def append_note(self, contact_id: str, note: str, author: str = "system") -> dict[str, Any]:
        log_event("crm_mock_note", {"contact_id": contact_id})
        return {"contact_id": contact_id, "note": note}


_crm: Optional[CRMProvider] = None


def get_crm() -> CRMProvider:
    global _crm
    if _crm is None:
        if os.environ.get("CRM_API_URL"):
            _crm = PostgresCRM()
        else:
            _crm = MockCRM()
    return _crm

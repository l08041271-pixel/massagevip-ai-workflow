"""
Lead capture abstraction layer.
Provider-portable: business logic never imports provider SDKs directly.
"""
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import log_event


LEAD_STATUSES = ('NEW', 'CONTACTED', 'QUALIFIED', 'BOOKED', 'COMPLETED', 'LOST')

LEAD_TRANSITIONS = {
    'NEW': {'CONTACTED', 'LOST'},
    'CONTACTED': {'QUALIFIED', 'LOST'},
    'QUALIFIED': {'BOOKED', 'LOST'},
    'BOOKED': {'COMPLETED', 'LOST'},
    'COMPLETED': set(),
    'LOST': set(),
}


def normalize_phone(phone: str) -> str:
    if not phone:
        return ''
    digits = ''.join(c for c in phone if c.isdigit())
    if not digits:
        return ''
    if digits.startswith('00'):
        digits = digits[2:]
    if not digits:
        return ''
    return '+' + digits


@dataclass
class Lead:
    id: str
    phone: str = ''
    email: str = ''
    name: str = ''
    source: str = ''
    campaign: str = ''
    landing_page: str = ''
    status: str = 'NEW'
    score: int = 0
    notes: str = ''
    duplicate_of: str = ''
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LeadStore(ABC):
    @abstractmethod
    def upsert_lead(self, lead: Lead) -> Lead:
        raise NotImplementedError

    @abstractmethod
    def get_lead(self, lead_id: str) -> Optional[Lead]:
        raise NotImplementedError

    @abstractmethod
    def list_leads(self, status: Optional[str] = None, limit: int = 100) -> list[Lead]:
        raise NotImplementedError

    @abstractmethod
    def transition_status(self, lead_id: str, new_status: str) -> Lead:
        raise NotImplementedError

    @abstractmethod
    def update_lead(self, lead_id: str, fields: dict[str, Any]) -> Lead:
        raise NotImplementedError


class PostgresLeadStore(LeadStore):
    def upsert_lead(self, lead: Lead) -> Lead:
        import psycopg2
        import uuid
        url = os.environ.get('DATABASE_URL')
        if not url:
            return lead
        conn = psycopg2.connect(url, sslmode='require')
        try:
            normalized_phone = normalize_phone(lead.phone)
            normalized_email = lead.email.strip().lower() if lead.email else ''
            existing = None
            with conn.cursor() as cur:
                if normalized_phone:
                    cur.execute('SELECT id FROM leads WHERE phone = %s', (normalized_phone,))
                    row = cur.fetchone()
                    if row:
                        existing = row[0]
                if existing is None and normalized_email:
                    cur.execute('SELECT id FROM leads WHERE email = %s', (normalized_email,))
                    row = cur.fetchone()
                    if row:
                        existing = row[0]
            now = datetime.now(timezone.utc).isoformat()
            if existing:
                # Merge: fill empty existing fields with new non-empty values;
                # never overwrite a populated canonical field. Sets duplicate_of
                # on the new attempt only when it is a duplicate click.
                with conn.cursor() as cur:
                    cur.execute('SELECT id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at FROM leads WHERE id = %s', (existing,))
                    existing_lead = self._row_to_lead(cur.fetchone())
                merged_phone = existing_lead.phone or normalized_phone
                merged_email = existing_lead.email or normalized_email
                merged_name = existing_lead.name or lead.name
                merged_source = existing_lead.source or lead.source
                merged_campaign = existing_lead.campaign or lead.campaign
                merged_landing = existing_lead.landing_page or lead.landing_page
                merged_score = existing_lead.score or lead.score
                merged_notes = existing_lead.notes or lead.notes
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE leads SET
                            phone = %s, email = %s, name = %s, source = %s,
                            campaign = %s, landing_page = %s, score = %s,
                            notes = %s, updated_at = %s
                        WHERE id = %s
                        """,
                        (
                            merged_phone or None,
                            merged_email or None,
                            merged_name or None,
                            merged_source or None,
                            merged_campaign or None,
                            merged_landing or None,
                            merged_score,
                            merged_notes or None,
                            now,
                            existing,
                        ),
                    )
                conn.commit()
                log_event('lead_upserted', {'lead_id': existing, 'status': 'existing_updated'})
                with conn.cursor() as cur:
                    cur.execute('SELECT id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at FROM leads WHERE id = %s', (existing,))
                    row = cur.fetchone()
                    return self._row_to_lead(row)
            lead_id = lead.id or str(uuid.uuid4())
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO leads (id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        phone = EXCLUDED.phone, email = EXCLUDED.email, name = EXCLUDED.name,
                        source = EXCLUDED.source, campaign = EXCLUDED.campaign,
                        landing_page = EXCLUDED.landing_page, score = EXCLUDED.score,
                        notes = EXCLUDED.notes, updated_at = EXCLUDED.updated_at
                    RETURNING id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at
                    """,
                    (
                        lead_id,
                        normalized_phone or None,
                        normalized_email or None,
                        lead.name or None,
                        lead.source or None,
                        lead.campaign or None,
                        lead.landing_page or None,
                        lead.status or 'NEW',
                        lead.score,
                        lead.notes or None,
                        lead.duplicate_of or None,
                        lead.created_at or now,
                        lead.updated_at or now,
                    ),
                )
                row = cur.fetchone()
            conn.commit()
            log_event('lead_upserted', {'lead_id': lead_id, 'status': 'created'})
            return self._row_to_lead(row)
        finally:
            conn.close()

    def get_lead(self, lead_id: str) -> Optional[Lead]:
        import psycopg2
        url = os.environ.get('DATABASE_URL')
        if not url:
            return None
        conn = psycopg2.connect(url, sslmode='require')
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at FROM leads WHERE id = %s', (lead_id,))
                row = cur.fetchone()
                if not row:
                    return None
                return self._row_to_lead(row)
        finally:
            conn.close()

    def list_leads(self, status: Optional[str] = None, limit: int = 100) -> list[Lead]:
        import psycopg2
        url = os.environ.get('DATABASE_URL')
        if not url:
            return []
        conn = psycopg2.connect(url, sslmode='require')
        try:
            with conn.cursor() as cur:
                if status:
                    cur.execute('SELECT id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at FROM leads WHERE status = %s ORDER BY created_at DESC LIMIT %s', (status, limit))
                else:
                    cur.execute('SELECT id, phone, email, name, source, campaign, landing_page, status, score, notes, duplicate_of, created_at, updated_at FROM leads ORDER BY created_at DESC LIMIT %s', (limit,))
                rows = cur.fetchall()
                return [self._row_to_lead(r) for r in rows]
        finally:
            conn.close()

    def transition_status(self, lead_id: str, new_status: str) -> Lead:
        import psycopg2
        url = os.environ.get('DATABASE_URL')
        if not url:
            raise RuntimeError('DATABASE_URL not set')
        conn = psycopg2.connect(url, sslmode='require')
        try:
            with conn.cursor() as cur:
                cur.execute('SELECT status FROM leads WHERE id = %s', (lead_id,))
                row = cur.fetchone()
                if not row:
                    raise ValueError(f'Lead not found: {lead_id}')
                current_status = row[0]
                allowed = LEAD_TRANSITIONS.get(current_status, set())
                if new_status not in allowed:
                    raise ValueError(f'Invalid transition from {current_status} to {new_status}')
                cur.execute('UPDATE leads SET status = %s, updated_at = %s WHERE id = %s', (new_status, datetime.now(timezone.utc).isoformat(), lead_id))
            conn.commit()
            log_event('lead_status_transitioned', {'lead_id': lead_id, 'from': current_status, 'to': new_status})
            return self.get_lead(lead_id)
        finally:
            conn.close()

    def update_lead(self, lead_id: str, fields: dict[str, Any]) -> Lead:
        import psycopg2
        url = os.environ.get('DATABASE_URL')
        if not url:
            raise RuntimeError('DATABASE_URL not set')
        allowed_keys = {'phone', 'email', 'name', 'source', 'campaign', 'landing_page', 'status', 'score', 'notes', 'duplicate_of'}
        sets = []
        vals = []
        for k, v in fields.items():
            if k in allowed_keys:
                sets.append(f'{k} = %s')
                vals.append(v)
        if not sets:
            return self.get_lead(lead_id)
        sets.append('updated_at = %s')
        vals.append(datetime.now(timezone.utc).isoformat())
        vals.append(lead_id)
        conn = psycopg2.connect(url, sslmode='require')
        try:
            with conn.cursor() as cur:
                cur.execute(f"UPDATE leads SET {', '.join(sets)} WHERE id = %s", tuple(vals))
            conn.commit()
            log_event('lead_updated', {'lead_id': lead_id, 'fields': list(fields.keys())})
            return self.get_lead(lead_id)
        finally:
            conn.close()

    def _row_to_lead(self, row: tuple) -> Lead:
        return Lead(
            id=row[0],
            phone=row[1] or '',
            email=row[2] or '',
            name=row[3] or '',
            source=row[4] or '',
            campaign=row[5] or '',
            landing_page=row[6] or '',
            status=row[7],
            score=row[8] or 0,
            notes=row[9] or '',
            duplicate_of=row[10] or '',
            created_at=row[11].isoformat() if hasattr(row[11], 'isoformat') else str(row[11]),
            updated_at=row[12].isoformat() if hasattr(row[12], 'isoformat') else str(row[12]),
        )


class MockLeadStore(LeadStore):
    def __init__(self):
        self._store: dict[str, Lead] = {}

    def upsert_lead(self, lead: Lead) -> Lead:
        normalized_phone = normalize_phone(lead.phone)
        normalized_email = lead.email.strip().lower() if lead.email else ''
        existing = None
        for existing_lead in self._store.values():
            if normalized_phone and existing_lead.phone == normalized_phone:
                existing = existing_lead
                break
        if existing is None and normalized_email:
            for existing_lead in self._store.values():
                if existing_lead.email == normalized_email:
                    existing = existing_lead
                    break
        if existing:
            if not existing.phone:
                existing.phone = normalized_phone
            if not existing.email:
                existing.email = normalized_email
            if not existing.name:
                existing.name = lead.name
            if not existing.source:
                existing.source = lead.source
            if not existing.campaign:
                existing.campaign = lead.campaign
            if not existing.landing_page:
                existing.landing_page = lead.landing_page
            if not existing.score:
                existing.score = lead.score
            if not existing.notes:
                existing.notes = lead.notes
            existing.updated_at = datetime.now(timezone.utc).isoformat()
            log_event('lead_upserted', {'lead_id': existing.id, 'status': 'existing_updated'})
            return existing
        lead.phone = normalized_phone
        lead.email = normalized_email
        self._store[lead.id] = lead
        log_event('lead_upserted', {'lead_id': lead.id, 'status': 'created'})
        return lead

    def get_lead(self, lead_id: str) -> Optional[Lead]:
        return self._store.get(lead_id)

    def list_leads(self, status: Optional[str] = None, limit: int = 100) -> list[Lead]:
        results = list(self._store.values())
        if status:
            results = [l for l in results if l.status == status]
        results.sort(key=lambda l: l.created_at, reverse=True)
        return results[:limit]

    def transition_status(self, lead_id: str, new_status: str) -> Lead:
        lead = self._store.get(lead_id)
        if not lead:
            raise ValueError(f'Lead not found: {lead_id}')
        allowed = LEAD_TRANSITIONS.get(lead.status, set())
        if new_status not in allowed:
            raise ValueError(f'Invalid transition from {lead.status} to {new_status}')
        old_status = lead.status
        lead.status = new_status
        lead.updated_at = datetime.now(timezone.utc).isoformat()
        log_event('lead_status_transitioned', {'lead_id': lead_id, 'from': old_status, 'to': new_status})
        return lead

    def update_lead(self, lead_id: str, fields: dict[str, Any]) -> Lead:
        lead = self._store.get(lead_id)
        if not lead:
            raise ValueError(f'Lead not found: {lead_id}')
        allowed_keys = {'phone', 'email', 'name', 'source', 'campaign', 'landing_page', 'status', 'score', 'notes', 'duplicate_of'}
        for k, v in fields.items():
            if k in allowed_keys:
                setattr(lead, k, v)
        lead.updated_at = datetime.now(timezone.utc).isoformat()
        log_event('lead_updated', {'lead_id': lead_id, 'fields': list(fields.keys())})
        return lead


_lead_store: Optional[LeadStore] = None


def get_lead_store() -> LeadStore:
    global _lead_store
    if _lead_store is None:
        if os.environ.get('DATABASE_URL'):
            _lead_store = PostgresLeadStore()
        else:
            _lead_store = MockLeadStore()
    return _lead_store

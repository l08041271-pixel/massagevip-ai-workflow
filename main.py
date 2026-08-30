"""
MassageVIP Automation - Production Entrypoint
Unified server: webhook ingestion + worker processing + analytics API
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from middleware import validate_config, log_event
from webhook import handle_webhook
from ai_orchestrator import qualify, retrieve_context
from decision_engine import decide
from actions import process_event
from audit import log_decision, log_external_action
from analytics import get_executive_summary
from analytics_leads import get_lead_dashboard
from click_tracking import handle_click_tracking
from idempotency import mark_processed, IdempotencyRecord, send_to_dead_letter
from leads import get_lead_store
from monitoring import HealthCheck, CircuitBreaker, retry_with_backoff
from typeform_client import get_typeform_provider
from booking import initiate_booking, confirm_booking, cancel_booking
from follow_up import schedule_followup, execute_followup
from approval import create_approval_request, approve, reject

_missing_env = validate_config()
if _missing_env:
    log_event("config_missing_env", {"missing": _missing_env}, level="error")

_circuit_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60.0)


def _process_pending() -> None:
    from webhook import drain_queue
    events = drain_queue()
    if not events:
        return
    for event in events:
        try:
            cid = event.get("event_id", "")
            context = retrieve_context(event)
            qualification = qualify(event, context)
            decision = decide(event, qualification, context)
            result = process_event(event, qualification, context)

            log_decision(
                cid,
                decision.action,
                {"event": event, "qualification": qualification},
                result,
                {"confidence": decision.confidence, "handoff": decision.human_handoff},
            )

            if result.get("whatsapp", {}).get("status") == "sent":
                log_external_action(cid, "whatsapp_send", event.get("phone", ""), result["whatsapp"])

            if decision.action != "suppress":
                try:
                    import psycopg2
                    url = os.environ.get("DATABASE_URL")
                    if url:
                        conn = psycopg2.connect(url, sslmode="require")
                        try:
                            with conn.cursor() as cur:
                                cur.execute(
                                    """
                                    INSERT INTO events (event_id, priority, lead_score, intent, sentiment, recommended_action, confidence, human_handoff)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                                    """,
                                    (
                                        cid,
                                        _map_priority(decision.action),
                                        int(decision.confidence),
                                        qualification.get("intent", "general"),
                                        "neutral",
                                        decision.action,
                                        decision.confidence,
                                        decision.human_handoff,
                                    ),
                                )
                            conn.commit()
                        finally:
                            conn.close()
                except Exception:
                    pass

            mark_processed(cid, success=True)
        except Exception as exc:
            log_event("event_processing_failed", {"event_id": event.get("event_id"), "error": str(exc)}, level="error")
            mark_processed(event.get("event_id", ""), success=False, error=str(exc))
            record = IdempotencyRecord(
                event_id=event.get("event_id", ""),
                dedupe_key=event.get("dedupe_key", ""),
                source=event.get("source", ""),
                event_type=event.get("event_type", ""),
                payload=event,
                dead_letter=True,
            )
            send_to_dead_letter(record, str(exc))


def _map_priority(action: str) -> str:
    if action in ("book", "reply_and_book"):
        return "P0"
    if action in ("reply_and_nurture", "reply_with_availability"):
        return "P1"
    if action == "log_only":
        return "P2"
    return "P3"


def check_leads() -> dict[str, Any]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"status": "skipped", "reason": "no_database_url"}
    try:
        store = get_lead_store()
        store.list_leads(limit=1)
        return {"status": "healthy"}
    except Exception as exc:
        return {"status": "unhealthy", "error": str(exc)}


def check_sheets() -> dict[str, Any]:
    if not os.environ.get("GOOGLE_SHEETS_ID"):
        return {"status": "skipped", "reason": "no_sheets_id"}
    try:
        import google.oauth2.service_account
        import googleapiclient.discovery
        return {"status": "configured"}
    except ImportError:
        return {"status": "unhealthy", "error": "google_libs_missing"}


def handle_typeform_webhook(body_bytes: bytes, signature: str = "") -> tuple[int, dict[str, Any]]:
    return get_typeform_provider().handle_typeform_webhook(body_bytes, signature)


def _worker_loop() -> None:
    while True:
        try:
            _process_pending()
        except Exception as exc:
            log_event("worker_loop_error", {"error": str(exc)}, level="error")
        time.sleep(1)


class UnifiedHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        self.send_response(status)
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/health":
            health = HealthCheck.full()
            health["checks"]["lead_store"] = check_leads()
            health["checks"]["sheets"] = check_sheets()
            self._send_json(200, health)
            return
        if self.path == "/dashboard":
            summary = get_executive_summary()
            self._send_json(200, summary)
            return
        if self.path == "/dashboard/leads":
            dashboard = get_lead_dashboard()
            self._send_json(200, dashboard)
            return
        if self.path.startswith("/api/leads"):
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            status = params.get("status", [None])[0]
            limit = min(int(params.get("limit", [100])[0]), 500)
            leads = get_lead_store().list_leads(status, limit)
            self._send_json(200, {"status": "ok", "leads": [{"id": l.id, "phone": l.phone, "email": l.email, "name": l.name, "source": l.source, "campaign": l.campaign, "landing_page": l.landing_page, "status": l.status, "score": l.score, "notes": l.notes, "duplicate_of": l.duplicate_of, "created_at": l.created_at, "updated_at": l.updated_at} for l in leads]})
            return
        if self.path == "/metrics":
            self._send_json(200, {"status": "ok", "service": "massagevip-automation"})
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body_bytes = self.rfile.read(content_length)

        if self.path == "/track/whatsapp-click":
            signature = self.headers.get("X-Hub-Signature-256", "")
            client_ip = self.client_address[0]
            status, response = handle_click_tracking(body_bytes, signature, client_ip)
            self.send_response(status)
            self.end_headers()
            if response:
                self.wfile.write(json.dumps(response).encode())
            return

        if self.path == "/webhook/typeform":
            signature = self.headers.get("Typeform-Signature", "")
            status, response = handle_typeform_webhook(body_bytes, signature)
            self.send_response(status)
            self.end_headers()
            if response:
                self.wfile.write(json.dumps(response).encode())
            return

        signature = self.headers.get("X-Hub-Signature-256", "")
        status, response = handle_webhook(body_bytes, signature)
        self.send_response(status)
        self.end_headers()
        if response:
            self.wfile.write(json.dumps(response).encode())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    worker_thread = threading.Thread(target=_worker_loop, daemon=True)
    worker_thread.start()
    server = HTTPServer(("0.0.0.0", port), UnifiedHandler)
    log_event("service_started", {"port": port, "mode": "unified"})
    server.serve_forever()

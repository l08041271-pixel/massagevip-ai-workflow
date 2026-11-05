"""MassageVIP automation HTTP entrypoint."""
import hmac
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from middleware import validate_config, log_event
from webhook import handle_webhook
from ycloud_webhook import handle_ycloud_webhook
from ai_orchestrator import qualify, retrieve_context
from decision_engine import decide
from actions import process_event
from audit import log_decision, log_external_action
from analytics import get_executive_summary
from monitoring import HealthCheck, CircuitBreaker
from idempotency import mark_processed, IdempotencyRecord, send_to_dead_letter
from booking import initiate_booking, confirm_booking, cancel_booking
from follow_up import schedule_followup, execute_followup
from approval import create_approval_request, approve, reject

_missing_env = validate_config()
if _missing_env:
    log_event("config_missing_env", {"missing": _missing_env}, level="error")

_circuit_breaker = CircuitBreaker(failure_threshold=5, recovery_timeout=60.0)


def _process_pending() -> int:
    from webhook import drain_queue
    events = drain_queue()
    processed = 0
    for event in events:
        try:
            cid = event.get("event_id", "")
            context = retrieve_context(event)
            qualification = qualify(event, context)
            decision = decide(event, qualification, context)
            result = process_event(event, qualification, context)
            log_decision(
                cid, decision.action,
                {"event": event, "qualification": qualification}, result,
                {"confidence": decision.confidence, "handoff": decision.human_handoff},
            )
            if result.get("whatsapp", {}).get("status") in ("sent", "accepted"):
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
                                    """INSERT INTO events
                                    (event_id, priority, lead_score, intent, sentiment, recommended_action, confidence, human_handoff)
                                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                                    (cid, _map_priority(decision.action), int(decision.confidence),
                                     qualification.get("intent", "general"), "neutral", decision.action,
                                     decision.confidence, decision.human_handoff),
                                )
                            conn.commit()
                        finally:
                            conn.close()
                except Exception as exc:
                    log_event("analytics_event_persist_failed", {"event_id": cid, "error_type": type(exc).__name__}, level="error")
            mark_processed(cid, success=True)
            processed += 1
        except Exception as exc:
            log_event("event_processing_failed", {"event_id": event.get("event_id"), "error_type": type(exc).__name__}, level="error")
            mark_processed(event.get("event_id", ""), success=False, error=type(exc).__name__)
            record = IdempotencyRecord(
                event_id=event.get("event_id", ""), dedupe_key=event.get("dedupe_key", ""),
                source=event.get("source", ""), event_type=event.get("event_type", ""),
                payload=event, dead_letter=True,
            )
            send_to_dead_letter(record, type(exc).__name__)
    return processed


def _map_priority(action: str) -> str:
    if action in ("book", "reply_and_book"):
        return "P0"
    if action in ("reply_and_nurture", "reply_with_availability"):
        return "P1"
    if action == "log_only":
        return "P2"
    return "P3"


def _worker_loop() -> None:
    while True:
        try:
            _process_pending()
        except Exception as exc:
            log_event("worker_loop_error", {"error_type": type(exc).__name__}, level="error")
        time.sleep(1)


class UnifiedHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send_json(self, status: int, data: dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            health = HealthCheck.full()
            statuses = [check.get("status") for check in health["checks"].values()]
            healthy = all(status in ("healthy", "configured", "skipped") for status in statuses)
            self._send_json(200 if healthy else 503, health)
        elif self.path == "/dashboard":
            self._send_json(200, get_executive_summary())
        elif self.path == "/metrics":
            self._send_json(200, {"status": "ok", "service": "massagevip-automation"})
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/internal/agent/cycle":
            expected = os.environ.get("AGENT_CRON_TOKEN", "")
            supplied = self.headers.get("Authorization", "")
            expected_header = f"Bearer {expected}" if expected else ""
            if not expected or not hmac.compare_digest(supplied, expected_header):
                self._send_json(401, {"status": "unauthorized"})
                return
            processed = _process_pending()
            self._send_json(200, {"status": "ok", "processed": processed, "timestamp": time.time()})
            return

        if self.path not in ("/webhook", "/webhooks/ycloud"):
            self._send_json(404, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(400, {"error": "invalid_content_length"})
            return
        if content_length <= 0 or content_length > 1_048_576:
            self._send_json(413 if content_length > 1_048_576 else 400, {"error": "invalid_content_length"})
            return
        body_bytes = self.rfile.read(content_length)
        if len(body_bytes) != content_length:
            self._send_json(400, {"error": "incomplete_body"})
            return

        if self.path == "/webhooks/ycloud":
            status, response = handle_ycloud_webhook(
                body_bytes,
                self.headers.get("YCloud-Signature", ""),
                self.headers.get("X-Webhook-Endpoint-ID", ""),
            )
        else:
            status, response = handle_webhook(
                body_bytes, self.headers.get("X-Hub-Signature-256", "")
            )
        self._send_json(status, response)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    worker_thread = threading.Thread(target=_worker_loop, daemon=True)
    worker_thread.start()
    server = HTTPServer(("0.0.0.0", port), UnifiedHandler)
    log_event("service_started", {"port": port, "mode": "unified"})
    server.serve_forever()

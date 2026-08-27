"""
Integration tests for MassageVIP Automation MVP.
Tests core pipeline without external dependencies.
"""
import json
import os
import sys
import time
import unittest
from io import BytesIO
from unittest.mock import patch, MagicMock

# Ensure project root on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from middleware import correlation_id, log_event, mask_secret, validate_config
from idempotency import (
    generate_dedupe_key,
    generate_event_id,
    check_idempotency,
    is_opted_out,
    IdempotencyRecord,
)
from webhook import handle_webhook, _normalize_whatsapp_payload
from crm import MockCRM, get_crm
from ai_orchestrator import detect_intent, qualify, retrieve_context, score_confidence, detect_human_handoff
from decision_engine import decide
from actions import validate_reply, generate_safe_reply, process_event
from verification import validate_reply as verify_reply, validate_booking_payload, validate_crm_update, validate_outgoing_message
from whatsapp_provider import get_whatsapp_provider, WahaProvider, DirectWhatsAppProvider
from audit import log_decision, _sanitize
from analytics import get_executive_summary
from monitoring import HealthCheck, CircuitBreaker, retry_with_backoff
from booking import initiate_booking, confirm_booking, cancel_booking
from follow_up import schedule_followup, execute_followup
from approval import create_approval_request, approve, reject


class TestCorrelationAndLogging(unittest.TestCase):
    def test_correlation_id_unique(self):
        ids = {correlation_id() for _ in range(100)}
        self.assertEqual(len(ids), 100)

    def test_mask_secret(self):
        self.assertEqual(mask_secret("12345678"), "***")
        self.assertEqual(mask_secret("abcdefghijklmnop"), "abcd...mnop")
        self.assertEqual(mask_secret(""), "")

    def test_sanitize_removes_sensitive(self):
        data = {"api_key": "secret123", "name": "test"}
        safe = _sanitize(data)
        self.assertIn("api_key", safe)
        self.assertNotEqual(safe["api_key"], "secret123")
        self.assertEqual(safe["name"], "test")


class TestIdempotency(unittest.TestCase):
    def test_dedupe_key_deterministic(self):
        k1 = generate_dedupe_key("whatsapp", "123", "hello world booking")
        k2 = generate_dedupe_key("whatsapp", "123", "hello world booking")
        self.assertEqual(k1, k2)
        k3 = generate_dedupe_key("whatsapp", "123", "hello world pricing")
        self.assertNotEqual(k1, k3)

    def test_event_id_generation(self):
        eid = generate_event_id("whatsapp", "123")
        self.assertTrue(eid.startswith("evt_wh_"))

    def test_idempotency_record(self):
        rec = IdempotencyRecord("evt_1", "dk_1", "whatsapp", "message", {"text": "hi"})
        self.assertFalse(rec.processed)
        self.assertFalse(rec.dead_letter)


class TestOptOut(unittest.TestCase):
    @patch("idempotency.DATABASE_URL", None)
    def test_no_db_returns_false(self):
        self.assertFalse(is_opted_out("+966500000000"))

    @patch("idempotency.DATABASE_URL", "postgres://fake")
    @patch("idempotency._get_conn")
    def test_opted_out_true(self, mock_conn):
        cur = MagicMock()
        cur.fetchone.return_value = (True,)
        mock_conn.return_value.__enter__ = MagicMock(return_value=MagicMock(cursor=MagicMock(return_value=cur)))
        mock_conn.return_value.__exit__ = MagicMock(return_value=False)
        self.assertTrue(is_opted_out("+966500000000"))


class TestWebhookNormalization(unittest.TestCase):
    def test_normalize_text_message(self):
        body = {
            "entry": [{"changes": [{"value": {"messages": [{"from": "966500000000", "id": "msg_1", "type": "text", "text": {"body": "I want to book"}}]}}]}]
        }
        norm = _normalize_whatsapp_payload(body)
        self.assertEqual(norm["source"], "whatsapp")
        self.assertEqual(norm["phone"], "966500000000")
        self.assertEqual(norm["text"], "I want to book")
        self.assertEqual(norm["event_type"], "message")

    def test_normalize_non_text(self):
        body = {
            "entry": [
                {
                    "changes": [
                        {
                            "value": {
                                "messages": [
                                    {"from": "966500000000", "id": "msg_1", "type": "image"}
                                ]
                            }
                        }
                    ]
                }
            ]
        }
        norm = _normalize_whatsapp_payload(body)
        self.assertEqual(norm["text"], "")

    @patch("webhook._verify_signature", return_value=False)
    def test_webhook_rejects_bad_signature(self, _):
        status, _ = handle_webhook(b"{}", "bad_sig")
        self.assertEqual(status, 403)

    def test_webhook_accepts_valid(self):
        with patch.dict(os.environ, {"WHATSAPP_VERIFY_TOKEN": "tok", "WHATSAPP_APP_SECRET": "secret"}):
            with patch("webhook.check_idempotency", return_value=None):
                with patch("webhook.persist_event", return_value=True):
                    with patch("webhook.is_opted_out", return_value=False):
                        with patch("webhook.enqueue_event"):
                            status, resp = handle_webhook(json.dumps({
                                "entry": [{"changes": [{"value": {"messages": [{"from": "966500000000", "type": "text", "text": {"body": "book"}}]}}]}]
                            }).encode(), "")
                            self.assertEqual(status, 200)
                            self.assertEqual(resp["status"], "accepted")


class TestWhatsAppProvider(unittest.TestCase):
    def setUp(self):
        from whatsapp_provider import _reset_provider
        _reset_provider()

    def test_waha_provider_send_text(self):
        with patch.dict(os.environ, {"WAHA_BASE_URL": "http://localhost:3000", "WAHA_SESSION": "default", "WAHA_API_KEY": "key123"}):
            with patch("urllib.request.urlopen") as mock_urlopen:
                mock_resp = MagicMock()
                mock_resp.read.return_value = b'{"id": "msg_1"}'
                mock_resp.__enter__ = MagicMock(return_value=mock_resp)
                mock_resp.__exit__ = MagicMock(return_value=False)
                mock_urlopen.return_value = mock_resp
                provider = WahaProvider()
                result = provider.send_text("+966500000000", "Hello")
                self.assertEqual(result["status"], "sent")
                args, kwargs = mock_urlopen.call_args
                req = args[0]
                self.assertEqual(req.get_full_url(), "http://localhost:3000/api/sendText")

    def test_waha_normalize_message(self):
        provider = WahaProvider()
        body = {
            "event": "message",
            "payload": {
                "id": "msg_1",
                "chatId": "966500000000@c.us",
                "from": "966500000000",
                "type": "text",
                "body": "I want to book",
            },
        }
        norm = provider.normalize_incoming(body)
        self.assertEqual(norm["source"], "whatsapp")
        self.assertEqual(norm["phone"], "966500000000")
        self.assertEqual(norm["text"], "I want to book")

    def test_waha_normalize_non_message(self):
        provider = WahaProvider()
        body = {"event": "status", "payload": {}}
        norm = provider.normalize_incoming(body)
        self.assertEqual(norm["event_type"], "other")

    def test_direct_provider_send_text_skips_without_creds(self):
        with patch.dict(os.environ, {}, clear=True):
            provider = DirectWhatsAppProvider()
            result = provider.send_text("+966500000000", "Hello")
            self.assertEqual(result["status"], "skipped")

    def test_get_provider_returns_waha_when_configured(self):
        with patch.dict(os.environ, {"WAHA_BASE_URL": "http://localhost:3000"}):
            provider = get_whatsapp_provider()
            self.assertIsInstance(provider, WahaProvider)

    def test_get_provider_returns_direct_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            provider = get_whatsapp_provider()
            self.assertIsInstance(provider, DirectWhatsAppProvider)

    def test_waha_verify_webhook_with_secret(self):
        with patch.dict(os.environ, {"WAHA_WEBHOOK_SECRET": "s3cret"}):
            provider = WahaProvider()
            self.assertTrue(provider.verify_webhook({"secret": "s3cret"}))
            self.assertFalse(provider.verify_webhook({"secret": "wrong"}))

    def test_waha_verify_webhook_without_secret(self):
        with patch.dict(os.environ, {}, clear=True):
            provider = WahaProvider()
            self.assertTrue(provider.verify_webhook({}))


class TestCRM(unittest.TestCase):
    def test_mock_crm_operations(self):
        crm = MockCRM()
        contact = crm.upsert_contact({"id": "c1", "phone": "+966500000000"})
        self.assertEqual(contact["id"], "c1")
        conv = crm.create_conversation("c1", "whatsapp")
        self.assertIn("id", conv)
        note = crm.append_note("c1", "test note")
        self.assertEqual(note["note"], "test note")

    def test_get_crm_returns_mock_when_no_url(self):
        with patch.dict(os.environ, {}, clear=True):
            crm = get_crm()
            self.assertIsInstance(crm, MockCRM)


class TestAIClassification(unittest.TestCase):
    def test_detect_intent_booking(self):
        result = detect_intent("I want to book a massage tonight")
        self.assertEqual(result["intent"], "booking")
        self.assertEqual(result["urgency"], "high")

    def test_detect_intent_pricing(self):
        result = detect_intent("How much is a Thai massage?")
        self.assertEqual(result["intent"], "pricing")
        self.assertEqual(result["urgency"], "medium")

    def test_detect_intent_spam(self):
        result = detect_intent("http://spam.com buy")
        self.assertEqual(result["intent"], "spam")
        self.assertTrue(result["is_spam"])

    def test_detect_intent_general(self):
        result = detect_intent("Hello there")
        self.assertEqual(result["intent"], "general")

    def test_confidence_score(self):
        qual = {"lead_score": 80}
        ctx = {"previous_intents": ["booking"]}
        conf = score_confidence(qual, ctx)
        self.assertAlmostEqual(conf, 88.0)

    def test_human_handoff_true(self):
        event = {"text": "I want to speak to a manager"}
        qual = {"intent": "general", "lead_score": 80, "urgency": "high"}
        self.assertTrue(detect_human_handoff(event, qual))

    def test_human_handoff_false_spam(self):
        event = {"text": "hello"}
        qual = {"intent": "spam", "lead_score": 10, "urgency": "low"}
        self.assertFalse(detect_human_handoff(event, qual))


class TestDecisionEngine(unittest.TestCase):
    def test_spam_suppressed(self):
        from decision_engine import decide
        event = {"text": "http://spam.com", "intent": "spam", "phone": None}
        qual = {"lead_score": 0, "intent": "spam", "urgency": "low"}
        ctx = {}
        d = decide(event, qual, ctx)
        self.assertEqual(d.action, "suppress")

    def test_high_intent_booking(self):
        event = {"text": "Book me for tonight 8pm", "intent": "booking", "phone": "+966500000000"}
        qual = {"lead_score": 85, "intent": "booking", "urgency": "high"}
        ctx = {}
        d = decide(event, qual, ctx)
        # High-value leads trigger human handoff per policy
        self.assertTrue(d.human_handoff)
        self.assertEqual(d.action, "human_handoff")

    def test_human_handoff_override(self):
        event = {"text": "speak to human", "intent": "general", "phone": "+966500000000"}
        qual = {"lead_score": 85, "intent": "general", "urgency": "high"}
        ctx = {}
        d = decide(event, qual, ctx)
        self.assertTrue(d.human_handoff)
        self.assertEqual(d.action, "human_handoff")


class TestVerification(unittest.TestCase):
    def test_validate_reply_safe(self):
        ok, err = verify_reply("Hi! When would you like to book?")
        self.assertTrue(ok)
        self.assertIsNone(err)

    def test_validate_reply_forbidden(self):
        ok, err = verify_reply("Your booking is confirmed for 8pm")
        self.assertFalse(ok)
        self.assertIsNotNone(err)

    def test_validate_booking_payload_valid(self):
        ok, err = validate_booking_payload({"customer_name": "Ali", "service": "massage", "date": "2026-08-27", "time": "20:00"})
        self.assertTrue(ok)

    def test_validate_booking_payload_missing(self):
        ok, err = validate_booking_payload({"customer_name": "Ali"})
        self.assertFalse(ok)

    def test_validate_crm_update_blocks_secrets(self):
        ok, err = validate_crm_update({"password": "secret123"})
        self.assertFalse(ok)

    def test_validate_outgoing_message_valid(self):
        ok, err = validate_outgoing_message("Hello", "+966500000000")
        self.assertTrue(ok)

    def test_validate_outgoing_message_bad_phone(self):
        ok, err = validate_outgoing_message("Hello", "500000000")
        self.assertFalse(ok)


class TestActions(unittest.TestCase):
    @patch("actions._whatsapp_send", return_value={"status": "sent"})
    @patch("actions.get_crm")
    def test_process_event_reply(self, mock_crm_get, mock_send):
        mock_crm = MagicMock()
        mock_crm_get.return_value = mock_crm
        event = {"event_id": "evt_1", "phone": "+966500000000", "source": "whatsapp", "text": "book tonight", "intent": "booking"}
        qual = {"lead_score": 75, "intent": "booking", "urgency": "medium"}
        ctx = {}
        result = process_event(event, qual, ctx)
        self.assertEqual(result["action"], "reply_and_book")
        self.assertIn("reply", result)


class TestAnalytics(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    def test_executive_summary_mock(self):
        summary = get_executive_summary()
        self.assertIn("title", summary)
        self.assertIn("key_metrics", summary)


class TestEndToEndPipeline(unittest.TestCase):
    """End-to-end simulation of the full pipeline."""
    def test_full_pipeline_mock(self):
        event = {
            "event_id": "evt_e2e_1",
            "source": "whatsapp",
            "event_type": "message",
            "user_id": "966500000000",
            "phone": "966500000000",
            "text": "I want to book a massage tonight at 8pm",
            "intent": "booking",
        }

        context = retrieve_context(event)
        qualification = qualify(event, context)
        self.assertIn("lead_score", qualification)

        decision = decide(event, qualification, context)
        self.assertIn(decision.action, ["book", "reply_and_book", "reply_and_nurture", "suppress", "human_handoff", "log_only"])

        if decision.action != "suppress" and not decision.human_handoff:
            result = process_event(event, qualification, context)
            self.assertIn("action", result)
            self.assertEqual(result["action"], decision.action)


class TestMonitoring(unittest.TestCase):
    def test_circuit_breaker_closed(self):
        cb = CircuitBreaker(failure_threshold=3, recovery_timeout=1.0)
        self.assertTrue(cb.allow_request())
        cb.record_success()
        self.assertTrue(cb.allow_request())

    def test_circuit_breaker_opens_after_failures(self):
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=1.0)
        cb.record_failure()
        cb.record_failure()
        self.assertEqual(cb.state, "open")
        self.assertFalse(cb.allow_request())

    def test_circuit_breaker_half_open_after_timeout(self):
        cb = CircuitBreaker(failure_threshold=2, recovery_timeout=0.1)
        cb.record_failure()
        cb.record_failure()
        self.assertFalse(cb.allow_request())
        time.sleep(0.2)
        self.assertTrue(cb.allow_request())

    def test_health_check_returns_status(self):
        health = HealthCheck.full()
        self.assertIn("timestamp", health)
        self.assertIn("checks", health)
        self.assertIn("database", health["checks"])

    def test_retry_with_backoff_succeeds(self):
        call_count = 0
        def flaky():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                raise RuntimeError("fail")
            return "ok"
        result = retry_with_backoff(flaky, max_retries=3, wait_duration_ms=10)
        self.assertEqual(result, "ok")
        self.assertEqual(call_count, 2)

    def test_retry_with_backoff_fails(self):
        def always_fail():
            raise RuntimeError("always")
        with self.assertRaises(RuntimeError):
            retry_with_backoff(always_fail, max_retries=2, wait_duration_ms=10)


class TestBooking(unittest.TestCase):
    def test_initiate_booking(self):
        event = {"event_id": "evt_1", "phone": "+966500000000"}
        booking = initiate_booking(event, missing_info=["date", "time"])
        self.assertEqual(booking["status"], "pending_info")
        self.assertIn("date", booking["missing_info"])

    def test_confirm_booking_valid(self):
        booking = confirm_booking("bk_1", {"customer_name": "Ali", "service": "massage", "date": "2026-08-27", "time": "20:00"})
        self.assertEqual(booking["status"], "confirmed")

    def test_confirm_booking_invalid(self):
        booking = confirm_booking("bk_1", {"customer_name": "Ali"})
        self.assertEqual(booking["status"], "invalid")

    def test_cancel_booking(self):
        booking = cancel_booking("bk_1", reason="customer_request")
        self.assertEqual(booking["status"], "cancelled")


class TestFollowUp(unittest.TestCase):
    def test_schedule_followup(self):
        fu = schedule_followup("evt_1", delay_minutes=30, action="nurture")
        self.assertEqual(fu["action"], "nurture")
        self.assertEqual(fu["status"], "scheduled")

    def test_execute_followup(self):
        fu = {"followup_id": "fu_1", "action": "nurture"}
        result = execute_followup(fu)
        self.assertEqual(result["status"], "executed")


class TestApproval(unittest.TestCase):
    def test_create_approval_request(self):
        req = create_approval_request("evt_1", "send_message", {"text": "Hello"})
        self.assertEqual(req["status"], "pending")
        self.assertEqual(req["action"], "send_message")

    def test_approve(self):
        result = approve("ap_1", approver="manager")
        self.assertEqual(result["status"], "approved")

    def test_reject(self):
        result = reject("ap_1", reason="not_appropriate")
        self.assertEqual(result["status"], "rejected")


if __name__ == "__main__":
    unittest.main()

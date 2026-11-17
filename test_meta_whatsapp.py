"""Focused security and contract tests for the Meta WhatsApp Cloud API path."""
import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import MagicMock, patch

from whatsapp_provider import DirectWhatsAppProvider
import webhook


class TestMetaProvider(unittest.TestCase):
    def test_graph_api_version_defaults_to_current_v27(self):
        with patch.dict(os.environ, {}, clear=True):
            provider = DirectWhatsAppProvider()
        self.assertEqual(provider.api_version, "v27.0")

    def test_explicit_meta_selection_overrides_legacy_waha_environment(self):
        from whatsapp_provider import _reset_provider, get_whatsapp_provider
        _reset_provider()
        try:
            with patch.dict(os.environ, {
                "WHATSAPP_PROVIDER": "meta", "WAHA_BASE_URL": "https://legacy-waha.invalid"
            }, clear=True):
                self.assertIsInstance(get_whatsapp_provider(), DirectWhatsAppProvider)
        finally:
            _reset_provider()

    def test_graph_api_version_can_be_pinned(self):
        with patch.dict(os.environ, {"WHATSAPP_GRAPH_API_VERSION": "v26.0"}, clear=True):
            provider = DirectWhatsAppProvider()
        self.assertEqual(provider.api_version, "v26.0")

    def test_invalid_graph_api_version_fails_closed(self):
        with patch.dict(os.environ, {"WHATSAPP_GRAPH_API_VERSION": "latest"}, clear=True):
            with self.assertRaises(ValueError):
                DirectWhatsAppProvider()

    def test_send_text_uses_versioned_meta_endpoint_and_bearer_auth(self):
        with patch.dict(os.environ, {
            "WHATSAPP_ACCESS_TOKEN": "test-token",
            "WHATSAPP_PHONE_NUMBER_ID": "123456789",
            "WHATSAPP_GRAPH_API_VERSION": "v27.0",
        }, clear=True):
            provider = DirectWhatsAppProvider()
            response = MagicMock()
            response.read.return_value = b'{"messages":[{"id":"wamid.test"}]}'
            response.__enter__ = MagicMock(return_value=response)
            response.__exit__ = MagicMock(return_value=False)
            with patch("urllib.request.urlopen", return_value=response) as open_url:
                result = provider.send_text("966500000000", "Test")
        self.assertEqual(result["status"], "sent")
        request = open_url.call_args.args[0]
        self.assertEqual(
            request.full_url,
            "https://graph.facebook.com/v27.0/123456789/messages",
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer test-token")
        self.assertEqual(json.loads(request.data)["messaging_product"], "whatsapp")

    def test_provider_error_does_not_return_raw_error_message(self):
        with patch.dict(os.environ, {
            "WHATSAPP_ACCESS_TOKEN": "test-token",
            "WHATSAPP_PHONE_NUMBER_ID": "123456789",
        }, clear=True):
            provider = DirectWhatsAppProvider()
            error = __import__("urllib.error", fromlist=["HTTPError"]).HTTPError(
                "https://graph.facebook.com", 400, "bad request", {}, None
            )
            error.read = lambda: b'{"error":{"message":"private body","type":"OAuthException","code":190}}'
            with patch("urllib.request.urlopen", side_effect=error):
                result = provider.send_text("966500000000", "Test")
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], 190)
        self.assertNotIn("private body", json.dumps(result))

    def test_normalizes_all_messages_and_contact_names(self):
        provider = DirectWhatsAppProvider()
        body = {"entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": "966500000000", "profile": {"name": "Customer"}}],
            "messages": [
                {"from": "966500000000", "id": "wamid.1", "type": "text", "text": {"body": "Hello"}},
                {"from": "966500000000", "id": "wamid.2", "type": "interactive",
                 "interactive": {"button_reply": {"title": "Book now"}}},
            ],
        }}]}]}
        events = provider.normalize_incoming_events(body)
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["text"], "Hello")
        self.assertEqual(events[1]["text"], "Book now")
        self.assertEqual(events[0]["handle"], "Customer")
        self.assertEqual(events[1]["conversation_id"], "wamid.2")

    def test_webhook_challenge_requires_mode_token_and_challenge(self):
        with patch.dict(os.environ, {"WHATSAPP_VERIFY_TOKEN": "verify-me"}, clear=True):
            with patch.object(webhook, "_provider", DirectWhatsAppProvider()):
                self.assertEqual(webhook.verify_webhook_challenge({
                    "hub.mode": "subscribe", "hub.verify_token": "verify-me",
                    "hub.challenge": "challenge-123",
                }), (200, "challenge-123"))
                self.assertEqual(webhook.verify_webhook_challenge({
                    "hub.mode": "subscribe", "hub.verify_token": "wrong",
                    "hub.challenge": "challenge-123",
                })[0], 403)
                self.assertEqual(webhook.verify_webhook_challenge({
                    "hub.mode": "subscribe", "hub.verify_token": "verify-me",
                    "hub.challenge": "",
                })[0], 403)

    def test_signature_verification_fails_closed_for_missing_or_bad_signature(self):
        body = b'{"object":"whatsapp_business_account"}'
        secret = "meta-app-secret"
        signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        with patch.dict(os.environ, {"WHATSAPP_APP_SECRET": secret}, clear=True):
            self.assertTrue(webhook._verify_signature(body, signature))
            self.assertFalse(webhook._verify_signature(body, ""))
            self.assertFalse(webhook._verify_signature(body, "sha256=invalid"))

    def test_meta_webhook_without_app_secret_returns_service_unavailable(self):
        with patch.dict(os.environ, {}, clear=True):
            status, response = webhook.handle_webhook(b'{}', "")
        self.assertEqual(status, 503)
        self.assertEqual(response["error"], "webhook_signature_validation_not_configured")

    def test_status_webhooks_are_acknowledged_without_entering_lead_queue(self):
        body = {"entry": [{"changes": [{"value": {"statuses": [
            {"id": "wamid.status", "status": "delivered", "recipient_id": "966500000000"}
        ]}}]}]}
        raw = json.dumps(body).encode()
        signature = "sha256=" + hmac.new(b"app-secret", raw, hashlib.sha256).hexdigest()
        with patch.dict(os.environ, {"WHATSAPP_APP_SECRET": "app-secret"}, clear=True):
            with patch.object(webhook, "_provider", DirectWhatsAppProvider()):
                with patch("webhook.enqueue_event") as enqueue:
                    status, response = webhook.handle_webhook(raw, signature)
        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "status_acknowledged")
        enqueue.assert_not_called()

    def test_multiple_messages_are_persisted_and_queued(self):
        body = {"entry": [{"changes": [{"value": {"messages": [
            {"from": "966500000000", "id": "wamid.one", "type": "text", "text": {"body": "Hi"}},
            {"from": "966500000000", "id": "wamid.two", "type": "text", "text": {"body": "Book"}},
        ]}}]}]}
        raw = json.dumps(body).encode()
        signature = "sha256=" + hmac.new(b"app-secret", raw, hashlib.sha256).hexdigest()
        with patch.dict(os.environ, {"WHATSAPP_APP_SECRET": "app-secret"}, clear=True):
            with patch.object(webhook, "_provider", DirectWhatsAppProvider()):
                with patch("webhook.check_idempotency", return_value=None):
                    with patch("webhook.persist_event", return_value=True):
                        with patch("webhook.is_opted_out", return_value=False):
                            with patch("webhook.enqueue_event") as enqueue:
                                status, response = webhook.handle_webhook(raw, signature)
        self.assertEqual(status, 200)
        self.assertEqual(response["accepted"], 2)
        self.assertEqual(enqueue.call_count, 2)
        keys = [call.args[0]["dedupe_key"] for call in enqueue.call_args_list]
        self.assertNotEqual(keys[0], keys[1])


if __name__ == "__main__":
    unittest.main()

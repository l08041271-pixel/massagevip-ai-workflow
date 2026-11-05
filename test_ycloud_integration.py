"""No-network tests for the YCloud adapter and webhook boundary."""
import hashlib
import hmac
import json
import os
import unittest
from unittest.mock import patch, MagicMock

from ycloud_webhook import verify_ycloud_signature, handle_ycloud_webhook
from ycloud_provider import YCloudProvider


class TestYCloudSignature(unittest.TestCase):
    def make_header(self, body, secret="synthetic-secret", timestamp=1_700_000_000):
        signed = str(timestamp).encode("ascii") + b"." + body
        digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return f"t={timestamp},s={digest}"

    def test_valid_raw_body_signature(self):
        body = b'{"id":"evt_1","type":"whatsapp.inbound_message.received"}'
        self.assertTrue(verify_ycloud_signature(body, self.make_header(body), "synthetic-secret", 1_700_000_000))

    def test_tampered_body_rejected(self):
        body = b'{"id":"evt_1"}'
        self.assertFalse(verify_ycloud_signature(body + b" ", self.make_header(body), "synthetic-secret", 1_700_000_000))

    def test_wrong_secret_rejected(self):
        body = b'{"id":"evt_1"}'
        self.assertFalse(verify_ycloud_signature(body, self.make_header(body), "wrong-secret", 1_700_000_000))

    def test_stale_and_future_timestamps_rejected(self):
        body = b'{}'
        stale = self.make_header(body, timestamp=1_000)
        future = self.make_header(body, timestamp=2_000)
        self.assertFalse(verify_ycloud_signature(body, stale, "synthetic-secret", 1_500))
        self.assertFalse(verify_ycloud_signature(body, future, "synthetic-secret", 1_500))

    def test_malformed_signature_rejected(self):
        self.assertFalse(verify_ycloud_signature(b"{}", "sha256=bad", "secret", 1_700_000_000))
        self.assertFalse(verify_ycloud_signature(b"{}", "", "secret", 1_700_000_000))


class TestYCloudReceiver(unittest.TestCase):
    def test_endpoint_mismatch_rejected_before_processing(self):
        with patch.dict(os.environ, {"YCLOUD_WEBHOOK_SECRET": "synthetic-secret", "YCLOUD_WEBHOOK_ENDPOINT_ID": "endpoint-a"}):
            with patch("ycloud_webhook._persist_event") as persist:
                status, _ = handle_ycloud_webhook(b'{"id":"e1","type":"x"}', "bad", "endpoint-b")
                self.assertEqual(status, 401)
                persist.assert_not_called()

    def test_valid_event_persisted_before_ack(self):
        body = b'{"id":"e1","type":"whatsapp.inbound_message.received"}'
        ts = 1_700_000_000
        sig = hmac.new(b"synthetic-secret", str(ts).encode() + b"." + body, hashlib.sha256).hexdigest()
        header = f"t={ts},s={sig}"
        with patch.dict(os.environ, {
            "YCLOUD_WEBHOOK_SECRET": "synthetic-secret",
            "YCLOUD_WEBHOOK_ENDPOINT_ID": "endpoint-a",
            "YCLOUD_WEBHOOK_TOLERANCE_SECONDS": "300",
        }):
            with patch("ycloud_webhook.verify_ycloud_signature", return_value=True):
                with patch("ycloud_webhook._persist_event", return_value="new") as persist:
                    status, response = handle_ycloud_webhook(body, header, "endpoint-a")
                    self.assertEqual(status, 200)
                    self.assertEqual(response["classification"], "new")
                    persist.assert_called_once()


class TestYCloudProvider(unittest.TestCase):
    def test_freeform_send_requires_verified_service_window(self):
        with patch.dict(os.environ, {
            "YCLOUD_API_KEY": "synthetic-key",
            "YCLOUD_API_BASE_URL": "https://api.example.test/v2",
            "YCLOUD_FROM": "+966500000001",
        }, clear=True):
            with patch("urllib.request.urlopen") as opener:
                result = YCloudProvider().send_text("+966500000002", "hello")
            self.assertEqual(result["reason"], "customer_service_window_not_verified")
            opener.assert_not_called()

    def test_missing_config_skips(self):
        with patch.dict(os.environ, {}, clear=True):
            result = YCloudProvider().send_text("+966500000000", "hello", service_window_open=True)
            self.assertEqual(result["reason"], "missing_ycloud_configuration")

    def test_request_construction_and_accepted_response(self):
        with patch.dict(os.environ, {
            "YCLOUD_API_KEY": "synthetic-key",
            "YCLOUD_API_BASE_URL": "https://api.example.test/v2",
            "YCLOUD_FROM": "+966500000001",
        }, clear=True):
            response = MagicMock()
            response.read.return_value = b'{"id":"msg_1","status":"accepted"}'
            response.headers = {"YCloud-Request-ID": "req_test"}
            response.__enter__.return_value = response
            response.__exit__.return_value = False
            with patch("urllib.request.urlopen", return_value=response) as opener:
                result = YCloudProvider().send_text("+966500000002", "hello", service_window_open=True)
            request = opener.call_args.args[0]
            self.assertEqual(request.full_url, "https://api.example.test/v2/whatsapp/messages/sendDirectly")
            self.assertEqual(request.get_header("X-api-key"), "synthetic-key")
            self.assertEqual(json.loads(request.data), {
                "from": "+966500000001", "to": "+966500000002", "type": "text", "text": {"body": "hello"}
            })
            self.assertEqual(result["status"], "accepted")
            self.assertEqual(result["message_id"], "msg_1")

    def test_provider_factory_selects_ycloud(self):
        from whatsapp_provider import get_whatsapp_provider, _reset_provider
        with patch.dict(os.environ, {"WHATSAPP_PROVIDER": "ycloud"}, clear=True):
            _reset_provider()
            provider = get_whatsapp_provider()
            self.assertIsInstance(provider, YCloudProvider)
        _reset_provider()


if __name__ == "__main__":
    unittest.main()

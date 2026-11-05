import hashlib
import hmac
import json
import unittest
from unittest.mock import patch

from ycloud_webhook import verify_ycloud_signature, _normalise_event
from ycloud_provider import YCloudProvider


class TestYCloudSignature(unittest.TestCase):
    def _header(self, body, secret, timestamp):
        signed = str(timestamp).encode("ascii") + b"." + body
        digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
        return f"t={timestamp},s={digest}"

    def test_valid_signature_uses_exact_raw_body(self):
        body = b'{ "id":"evt_1", "type":"whatsapp.inbound_message.received" }'
        secret = "synthetic-test-secret"
        now = 1_800_000_000
        header = self._header(body, secret, now)
        self.assertTrue(verify_ycloud_signature(body, header, secret, now_seconds=now))

    def test_tampered_body_rejected(self):
        body = b'{"id":"evt_1"}'
        secret = "synthetic-test-secret"
        now = 1_800_000_000
        header = self._header(body, secret, now)
        self.assertFalse(verify_ycloud_signature(body + b" ", header, secret, now_seconds=now))

    def test_missing_signature_or_secret_rejected(self):
        body = b'{"id":"evt_1"}'
        self.assertFalse(verify_ycloud_signature(body, "", "secret", now_seconds=1000))
        self.assertFalse(verify_ycloud_signature(body, "t=1000,s=" + "0" * 64, "", now_seconds=1000))

    def test_stale_and_future_timestamps_rejected(self):
        body = b'{"id":"evt_1"}'
        secret = "synthetic-test-secret"
        now = 1_800_000_000
        self.assertFalse(verify_ycloud_signature(body, self._header(body, secret, now - 301), secret, now_seconds=now))
        self.assertFalse(verify_ycloud_signature(body, self._header(body, secret, now + 301), secret, now_seconds=now))

    def test_malformed_signature_rejected(self):
        self.assertFalse(verify_ycloud_signature(b"{}", "sha256=" + "0" * 64, "secret", now_seconds=1000))


class TestYCloudNormalization(unittest.TestCase):
    def test_inbound_text_maps_to_lead_event(self):
        event = {
            "id": "evt_123",
            "type": "whatsapp.inbound_message.received",
            "whatsappInboundMessage": {
                "id": "msg_123",
                "from": "+966500000000",
                "type": "text",
                "text": {"body": "I want to book"},
                "customerProfile": {"name": "Test"},
            },
        }
        normalized = _normalise_event(event)
        self.assertEqual(normalized["phone"], "+966500000000")
        self.assertEqual(normalized["text"], "I want to book")
        self.assertEqual(normalized["provider_event_id"], "evt_123")

    def test_status_event_is_not_normalized_as_inbound_lead(self):
        event = {"id": "evt_2", "type": "whatsapp.message.updated", "whatsappMessage": {"status": "delivered"}}
        normalized = _normalise_event(event)
        self.assertEqual(normalized["event_type"], "status")
        self.assertEqual(normalized["text"], "")


class TestYCloudProvider(unittest.TestCase):
    @patch.dict("os.environ", {
        "YCLOUD_API_KEY": "synthetic-key",
        "YCLOUD_FROM_NUMBER": "+966500000001",
        "YCLOUD_API_BASE_URL": "https://api.ycloud.com/v2",
    })
    @patch("urllib.request.urlopen")
    def test_send_text_uses_ycloud_queued_endpoint(self, mock_urlopen):
        class FakeResponse:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return b'{"id":"synthetic-message-id"}'

        mock_urlopen.return_value = FakeResponse()
        provider = YCloudProvider()
        result = provider.send_text("+966500000002", "Hello")
        self.assertEqual(result["status"], "accepted")
        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.ycloud.com/v2/whatsapp/messages")
        self.assertEqual(request.get_header("X-api-key"), "synthetic-key")
        self.assertEqual(json.loads(request.data.decode())["type"], "text")

    @patch.dict("os.environ", {}, clear=True)
    def test_send_text_skips_without_configuration(self):
        result = YCloudProvider().send_text("+966500000002", "Hello")
        self.assertEqual(result["status"], "skipped")


if __name__ == "__main__":
    unittest.main()

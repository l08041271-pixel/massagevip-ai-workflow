"""YCloud outbound WhatsApp adapter.

Local implementation only. No network request is made at import time.
Configure credentials only in the server environment.
"""
import json
import os
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse

from middleware import log_event, mask_secret


class YCloudProvider:
    def __init__(self) -> None:
        self.api_key = os.environ.get("YCLOUD_API_KEY", "")
        self.base_url = os.environ.get("YCLOUD_API_BASE_URL", "").rstrip("/")
        self.sender = os.environ.get("YCLOUD_FROM", "")

    def _configuration_error(self) -> str | None:
        if not self.api_key or not self.base_url or not self.sender:
            return "missing_ycloud_configuration"
        parsed = urlparse(self.base_url)
        if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
            return "invalid_ycloud_api_base_url"
        if not self.sender.startswith("+") or not self.sender[1:].isdigit():
            return "invalid_ycloud_sender_e164"
        return None

    def send_text(self, to_phone: str, message: str) -> dict[str, Any]:
        """Submit a free-form text message; caller must enforce WhatsApp's 24h window."""
        problem = self._configuration_error()
        if problem:
            return {"status": "skipped", "reason": problem}
        if not to_phone.startswith("+") or not to_phone[1:].isdigit():
            return {"status": "failed", "reason": "recipient_must_be_e164"}
        if not isinstance(message, str) or not message or len(message) > 4096:
            return {"status": "failed", "reason": "invalid_text_body"}

        payload = {
            "from": self.sender,
            "to": to_phone,
            "type": "text",
            "text": {"body": message},
        }
        request = urllib.request.Request(
            self.base_url + "/whatsapp/messages/sendDirectly",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "X-API-Key": self.api_key,
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                body = json.loads(response.read().decode("utf-8") or "{}")
                request_id = response.headers.get("YCloud-Request-ID")
                # HTTP 200 means accepted, not delivered.
                result = {
                    "status": body.get("status") or "accepted",
                    "message_id": body.get("id"),
                    "provider_request_id": request_id,
                }
                log_event("ycloud_message_accepted", {
                    "to": mask_secret(to_phone),
                    "message_id": result["message_id"],
                    "provider_request_id": request_id,
                })
                return result
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                error = json.loads(raw).get("error", {})
            except (ValueError, AttributeError):
                error = {}
            return {
                "status": "failed",
                "http_code": exc.code,
                "provider_code": error.get("code"),
                "provider_request_id": exc.headers.get("YCloud-Request-ID"),
                "retry_after": exc.headers.get("Retry-After"),
                "automatic_retry": False,
            }
        except (TimeoutError, urllib.error.URLError) as exc:
            # A lost response may follow provider acceptance. Never blindly replay.
            log_event("ycloud_message_ambiguous", {"error_type": type(exc).__name__}, level="error")
            return {"status": "ambiguous_outcome", "automatic_retry": False, "reconciliation_required": True}

    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        # Event-specific field mapping is intentionally not guessed here.
        return {
            "source": "ycloud",
            "event_id": body.get("id"),
            "event_type": body.get("type", "unknown"),
            "raw": body,
        }

    def verify_webhook(self, params: dict[str, str]) -> bool:
        # YCloud uses its raw-body HMAC signature; use ycloud_webhook.py instead.
        return False

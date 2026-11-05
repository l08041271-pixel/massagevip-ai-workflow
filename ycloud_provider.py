"""YCloud WhatsApp provider adapter.

Uses the queued message endpoint. A successful HTTP response means accepted,
not delivered. This adapter deliberately does not retry POST requests.
"""
import json
import os
import urllib.error
import urllib.request
from typing import Any

from middleware import log_event, mask_secret


class YCloudProvider:
    def __init__(self) -> None:
        self.api_key = os.environ.get("YCLOUD_API_KEY", "")
        self.base_url = os.environ.get(
            "YCLOUD_API_BASE_URL", "https://api.ycloud.com/v2"
        ).rstrip("/")
        self.from_number = os.environ.get("YCLOUD_FROM_NUMBER", "")

    def send_text(self, to_phone: str, message: str) -> dict[str, Any]:
        if not self.api_key or not self.from_number:
            return {"status": "skipped", "reason": "missing_ycloud_configuration"}
        if not to_phone or not message or len(message) > 4096:
            return {"status": "failed", "reason": "invalid_message"}

        payload = {
            "from": self.from_number,
            "to": to_phone,
            "type": "text",
            "text": {"body": message},
        }
        request = urllib.request.Request(
            f"{self.base_url}/whatsapp/messages",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "X-API-Key": self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                data = json.loads(response.read().decode("utf-8"))
                message_id = data.get("id") if isinstance(data, dict) else None
                log_event("ycloud_message_accepted", {
                    "message_id": message_id,
                    "to": mask_secret(to_phone),
                    "http_status": response.status,
                })
                return {
                    "status": "accepted",
                    "provider": "ycloud",
                    "message_id": message_id,
                    "response": data,
                }
        except urllib.error.HTTPError as exc:
            try:
                data = json.loads(exc.read().decode("utf-8"))
            except Exception:
                data = {}
            error = data.get("error", {}) if isinstance(data, dict) else {}
            result = {
                "status": "failed",
                "provider": "ycloud",
                "http_status": exc.code,
                "error_code": error.get("code"),
                "request_id": exc.headers.get("YCloud-Request-ID"),
            }
            retry_after = exc.headers.get("Retry-After")
            if retry_after:
                result["retry_after"] = retry_after
            log_event("ycloud_message_rejected", {
                "http_status": exc.code,
                "error_code": result["error_code"],
                "request_id": result["request_id"],
            }, level="error")
            return result
        except Exception as exc:
            # A transport timeout can occur after the provider accepted bytes.
            # Never automatically replay this send.
            log_event("ycloud_message_outcome_ambiguous", {
                "error_type": type(exc).__name__,
                "to": mask_secret(to_phone),
            }, level="error")
            return {
                "status": "ambiguous",
                "provider": "ycloud",
                "reason": "transport_outcome_unknown_reconcile_before_retry",
            }

    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        from ycloud_webhook import _normalise_event
        return _normalise_event(body)

    def verify_webhook(self, params: dict[str, str]) -> bool:
        # YCloud signatures are verified over raw request bytes in ycloud_webhook.py.
        return False

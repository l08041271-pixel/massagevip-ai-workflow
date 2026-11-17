"""
WhatsApp provider abstraction.
Supports WAHA (legacy) and Meta WhatsApp Cloud API.
Business logic uses this provider boundary; secrets are read only from environment.
"""
import hmac
import json
import os
import re
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from typing import Any, Optional

from middleware import log_event, mask_secret


class WhatsAppProvider(ABC):
    @abstractmethod
    def send_text(self, to_phone: str, message: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def verify_webhook(self, params: dict[str, str]) -> bool:
        raise NotImplementedError


class WahaProvider(WhatsAppProvider):
    def __init__(self):
        self.base_url = os.environ.get("WAHA_BASE_URL", "http://localhost:3000").rstrip("/")
        self.session = os.environ.get("WAHA_SESSION", "default")
        self.api_key = os.environ.get("WAHA_API_KEY", "")
        self.webhook_secret = os.environ.get("WAHA_WEBHOOK_SECRET", "")

    def send_text(self, to_phone: str, message: str) -> dict[str, Any]:
        chat_id = to_phone.replace("+", "").replace(" ", "") + "@c.us"
        payload = {"session": self.session, "chatId": chat_id, "text": message}
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["X-Api-Key"] = self.api_key
        req = urllib.request.Request(
            f"{self.base_url}/api/sendText",
            data=json.dumps(payload).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                result = json.loads(response.read().decode() or "{}")
                log_event("waha_sent", {"to": mask_secret(to_phone)})
                return {"status": "sent", "response": result}
        except urllib.error.HTTPError as exc:
            log_event("waha_send_failed", {"http_code": exc.code}, level="error")
            return {"status": "failed", "http_code": exc.code, "reason": "provider_rejected_request"}
        except Exception as exc:
            log_event("waha_send_error", {"error_type": type(exc).__name__}, level="error")
            return {"status": "error", "reason": "provider_request_failed"}

    def normalize_incoming_events(self, body: dict[str, Any]) -> list[dict[str, Any]]:
        if body.get("event") != "message":
            return []
        payload = body.get("payload") or {}
        chat_id = payload.get("chatId", "")
        phone = chat_id.split("@")[0] if "@" in chat_id else payload.get("from", "")
        message_type = payload.get("type", "")
        text = ""
        if message_type == "text":
            text = (payload.get("body") or "").strip()
        elif message_type == "extendedTextMessage":
            text = ((payload.get("text") or {}).get("body") or "").strip()
        return [{
            "source": "whatsapp",
            "event_type": "message",
            "user_id": phone,
            "phone": phone,
            "handle": payload.get("from", ""),
            "text": text,
            "media_url": payload.get("mediaUrl"),
            "conversation_id": payload.get("id", ""),
            "raw": body,
        }]

    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        events = self.normalize_incoming_events(body)
        return events[0] if events else {
            "source": "whatsapp", "event_type": "other", "user_id": "",
            "phone": "", "text": "", "raw": body,
        }

    def verify_webhook(self, params: dict[str, str]) -> bool:
        if not self.webhook_secret:
            return True
        return hmac.compare_digest(params.get("secret", ""), self.webhook_secret)


class DirectWhatsAppProvider(WhatsAppProvider):
    """Meta WhatsApp Cloud API client and webhook payload normalizer."""

    def __init__(self):
        self.token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
        self.phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
        self.verify_token = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
        self.app_secret = os.environ.get("WHATSAPP_APP_SECRET", "")
        self.api_version = os.environ.get("WHATSAPP_GRAPH_API_VERSION", "v27.0")
        if not re.fullmatch(r"v\d+\.\d+", self.api_version):
            raise ValueError("WHATSAPP_GRAPH_API_VERSION must look like v27.0")

    def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.token or not self.phone_id:
            return {"status": "skipped", "reason": "missing_whatsapp_credentials"}
        url = f"https://graph.facebook.com/{self.api_version}/{self.phone_id}/messages"
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                result = json.loads(response.read().decode("utf-8") or "{}")
                log_event("meta_whatsapp_sent", {
                    "to": mask_secret(str(payload.get("to", ""))),
                    "api_version": self.api_version,
                })
                return {"status": "sent", "response": result}
        except urllib.error.HTTPError as exc:
            # Never log or return the raw provider body; it can contain user data.
            error_code = None
            error_type = None
            try:
                error = json.loads(exc.read().decode("utf-8", errors="replace")).get("error", {})
                error_code = error.get("code")
                error_type = error.get("type")
            except Exception:
                pass
            log_event("meta_whatsapp_send_failed", {
                "http_code": exc.code, "error_code": error_code, "error_type": error_type,
                "api_version": self.api_version,
            }, level="error")
            return {
                "status": "failed", "http_code": exc.code,
                "error_code": error_code, "error_type": error_type,
                "reason": "meta_api_rejected_request",
            }
        except Exception as exc:
            log_event("meta_whatsapp_send_error", {"error_type": type(exc).__name__}, level="error")
            return {"status": "error", "reason": "meta_api_request_failed"}

    def send_payload(self, to_phone: str, message_payload: dict[str, Any]) -> dict[str, Any]:
        payload = {"messaging_product": "whatsapp", "recipient_type": "individual", "to": to_phone}
        payload.update(message_payload)
        return self._request(payload)

    def send_text(self, to_phone: str, message: str) -> dict[str, Any]:
        return self.send_payload(to_phone, {"type": "text", "text": {"preview_url": False, "body": message}})

    def send_template(
        self, to_phone: str, template_name: str, language_code: str = "en",
        components: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        template: dict[str, Any] = {"name": template_name, "language": {"code": language_code}}
        if components:
            template["components"] = components
        return self.send_payload(to_phone, {"type": "template", "template": template})

    def normalize_incoming_events(self, body: dict[str, Any]) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for entry in body.get("entry") or []:
            for change in entry.get("changes") or []:
                value = change.get("value") or {}
                contacts = {
                    item.get("wa_id"): item.get("profile", {}).get("name")
                    for item in (value.get("contacts") or [])
                }
                for msg in value.get("messages") or []:
                    phone = msg.get("from", "")
                    msg_type = msg.get("type", "")
                    text = ""
                    if msg_type == "text":
                        text = (msg.get("text") or {}).get("body", "").strip()
                    elif msg_type == "button":
                        text = (msg.get("button") or {}).get("text", "").strip()
                    elif msg_type == "interactive":
                        interactive = msg.get("interactive") or {}
                        text = (
                            (interactive.get("button_reply") or {}).get("title")
                            or (interactive.get("list_reply") or {}).get("title")
                            or ""
                        ).strip()
                    events.append({
                        "source": "whatsapp",
                        "event_type": "message",
                        "user_id": phone,
                        "phone": phone,
                        "handle": contacts.get(phone),
                        "text": text,
                        "media_url": None,
                        "conversation_id": msg.get("id", ""),
                        "message_type": msg_type,
                        "timestamp": msg.get("timestamp"),
                        "raw": {"message": msg, "metadata": value.get("metadata", {})},
                    })
        return events

    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        events = self.normalize_incoming_events(body)
        return events[0] if events else {
            "source": "whatsapp", "event_type": "other", "user_id": "",
            "phone": "", "text": "", "raw": body,
        }

    def verify_webhook(self, params: dict[str, str]) -> bool:
        supplied = params.get("hub.verify_token", "")
        return (
            params.get("hub.mode") == "subscribe"
            and bool(self.verify_token)
            and hmac.compare_digest(supplied, self.verify_token)
        )


_provider: Optional[WhatsAppProvider] = None


def _reset_provider() -> None:
    global _provider
    _provider = None


def get_whatsapp_provider() -> WhatsAppProvider:
    global _provider
    if _provider is None:
        configured_provider = os.environ.get("WHATSAPP_PROVIDER", "").strip().lower()
        if configured_provider == "waha" or (not configured_provider and os.environ.get("WAHA_BASE_URL")):
            _provider = WahaProvider()
        else:
            _provider = DirectWhatsAppProvider()
    return _provider

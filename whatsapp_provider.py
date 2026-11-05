"""WhatsApp provider abstraction.
Supports WAHA, direct Meta Cloud API, and YCloud behind one interface.
"""
import json
import os
from abc import ABC, abstractmethod
from typing import Any, Optional

import urllib.request
import urllib.error

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
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode())
                log_event("waha_sent", {"to": mask_secret(to_phone)})
                return {"status": "sent", "response": data}
        except urllib.error.HTTPError as exc:
            log_event("waha_send_failed", {"http_code": exc.code}, level="error")
            return {"status": "failed", "http_code": exc.code}
        except Exception as exc:
            log_event("waha_send_error", {"error_type": type(exc).__name__}, level="error")
            return {"status": "error", "error_type": type(exc).__name__}

    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        event = body.get("event", "")
        payload = body.get("payload", {})
        if event != "message":
            return {"source": "whatsapp", "event_type": "other", "user_id": "", "phone": "", "text": "", "raw": body}
        chat_id = payload.get("chatId", "")
        phone = chat_id.split("@")[0] if "@" in chat_id else payload.get("from", "")
        text = ""
        if payload.get("type") == "text":
            text = (payload.get("body") or "").strip()
        elif payload.get("type") == "extendedTextMessage":
            text = ((payload.get("text") or {}).get("body") or "").strip()
        return {
            "source": "whatsapp", "event_type": "message", "user_id": phone,
            "phone": phone, "handle": payload.get("from", ""), "text": text,
            "media_url": payload.get("mediaUrl"), "conversation_id": payload.get("id", ""),
            "raw": body,
        }

    def verify_webhook(self, params: dict[str, str]) -> bool:
        if not self.webhook_secret:
            return False
        return params.get("secret") == self.webhook_secret


class DirectWhatsAppProvider(WhatsAppProvider):
    def __init__(self):
        self.token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
        self.phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
        self.verify_token = os.environ.get("WHATSAPP_VERIFY_TOKEN", "")
        self.app_secret = os.environ.get("WHATSAPP_APP_SECRET", "")

    def send_text(self, to_phone: str, message: str) -> dict[str, Any]:
        if not self.token or not self.phone_id:
            return {"status": "skipped", "reason": "missing_whatsapp_credentials"}
        url = f"https://graph.facebook.com/v19.0/{self.phone_id}/messages"
        payload = {
            "messaging_product": "whatsapp", "to": to_phone,
            "type": "text", "text": {"body": message},
        }
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.token}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                data = json.loads(response.read().decode())
                log_event("whatsapp_submitted", {"to": mask_secret(to_phone)})
                return {"status": "sent", "response": data}
        except urllib.error.HTTPError as exc:
            log_event("whatsapp_send_failed", {"http_code": exc.code}, level="error")
            return {"status": "failed", "http_code": exc.code}
        except Exception as exc:
            log_event("whatsapp_send_error", {"error_type": type(exc).__name__}, level="error")
            return {"status": "error", "error_type": type(exc).__name__}

    def normalize_incoming(self, body: dict[str, Any]) -> dict[str, Any]:
        entry = (body.get("entry") or [{}])[0]
        change = (entry.get("changes") or [{}])[0]
        value = change.get("value", {})
        messages = value.get("messages") or []
        msg = messages[0] if messages else {}
        phone = msg.get("from", "")
        text = ((msg.get("text") or {}).get("body") or "").strip() if msg.get("type") == "text" else ""
        return {
            "source": "whatsapp", "event_type": "message", "user_id": phone,
            "phone": phone, "handle": None, "text": text, "media_url": None,
            "conversation_id": msg.get("id", ""), "raw": body,
        }

    def verify_webhook(self, params: dict[str, str]) -> bool:
        return bool(self.verify_token) and params.get("hub.verify_token") == self.verify_token


_provider: Optional[WhatsAppProvider] = None


def _reset_provider() -> None:
    global _provider
    _provider = None


def get_whatsapp_provider() -> WhatsAppProvider:
    global _provider
    if _provider is None:
        selected = os.environ.get("WHATSAPP_PROVIDER", "").strip().lower()
        if selected == "ycloud":
            from ycloud_provider import YCloudProvider
            _provider = YCloudProvider()
        elif selected == "waha" or (not selected and os.environ.get("WAHA_BASE_URL")):
            _provider = WahaProvider()
        elif selected in ("meta", "cloud_api", ""):
            _provider = DirectWhatsAppProvider()
        else:
            raise ValueError("Unsupported WHATSAPP_PROVIDER; use ycloud, waha, or meta")
    return _provider

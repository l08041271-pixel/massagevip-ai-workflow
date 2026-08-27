"""
Structured logging, correlation IDs, and configuration validation.
Cross-cutting concern injected at the execution boundary.
"""
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logger = logging.getLogger("massagevip")
logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
if not logger.handlers:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)

REQUIRED_ENV = [
    "AI_BASE_URL",
    "AI_API_KEY",
    "DATABASE_URL",
]

OPTIONAL_ENV = [
    "AI_MODEL",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WAHA_BASE_URL",
    "WAHA_SESSION",
    "WAHA_API_KEY",
    "WAHA_WEBHOOK_SECRET",
    "CRM_API_URL",
    "CRM_API_KEY",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_FROM",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "OWNER_WHATSAPP",
]


def validate_config() -> list[str]:
    missing = [v for v in REQUIRED_ENV if not os.environ.get(v)]
    if missing:
        logger.error("Missing required environment variables: %s", ", ".join(missing))
    for v in OPTIONAL_ENV:
        if v in os.environ and not os.environ[v]:
            logger.warning("config_validation", extra={"event": "env_empty", "key": v})
    return missing


def correlation_id() -> str:
    return uuid.uuid4().hex


def log_event(
    event: str,
    data: Optional[dict[str, Any]] = None,
    level: str = "info",
    **kwargs: Any,
) -> None:
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "service": "massagevip-automation",
    }
    if data:
        payload.update(data)
    if kwargs:
        payload.update(kwargs)
    line = json.dumps(payload, ensure_ascii=False, default=str)
    if level == "error":
        logger.error(line)
    elif level == "warning":
        logger.warning(line)
    else:
        logger.info(line)


def mask_secret(value: Optional[str]) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "***"
    return f"{value[:4]}...{value[-4:]}"

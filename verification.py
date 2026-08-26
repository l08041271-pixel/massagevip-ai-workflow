"""
Verification Layer.
Deterministic validation for customer-facing actions.
AI must not perform uncontrolled external actions.
"""
import re
from typing import Any, Optional


FORBIDDEN_PATTERNS = [
    r"booking\s+(is\s+)?confirmed",
    r"confirmed\s+booking",
    r"your appointment is confirmed",
    r"تم التأكيد",
    r"موعدك مؤكد",
]


def validate_reply(reply: str) -> tuple[bool, Optional[str]]:
    if not reply or not isinstance(reply, str):
        return False, "reply_empty_or_invalid"
    if len(reply) > 2000:
        return False, "reply_too_long"
    lower = reply.lower()
    for pattern in FORBIDDEN_PATTERNS:
        if re.search(pattern, lower):
            return False, f"forbidden_pattern:{pattern}"
    return True, None


def validate_booking_payload(payload: dict[str, Any]) -> tuple[bool, Optional[str]]:
    required = ["customer_name", "service", "date", "time"]
    missing = [k for k in required if not payload.get(k)]
    if missing:
        return False, f"missing_fields:{','.join(missing)}"
    return True, None


def validate_crm_update(data: dict[str, Any]) -> tuple[bool, Optional[str]]:
    if not isinstance(data, dict):
        return False, "crm_data_not_dict"
    forbidden_keys = {"password", "secret", "token", "api_key", "credit_card"}
    for k in data:
        if k.lower() in forbidden_keys:
            return False, f"crm_forbidden_field:{k}"
    return True, None


def validate_outgoing_message(message: str, phone: str) -> tuple[bool, Optional[str]]:
    if not message:
        return False, "empty_message"
    if not phone or not phone.startswith("+"):
        return False, "invalid_phone"
    return True, None

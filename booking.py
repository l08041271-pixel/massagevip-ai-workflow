"""
Booking Service.
Initiates and tracks booking requests.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import correlation_id, log_event, mask_secret
from idempotency import mark_processed
from verification import validate_booking_payload


def initiate_booking(event: dict[str, Any], missing_info: Optional[list[str]] = None) -> dict[str, Any]:
    cid = correlation_id()
    event_id = event.get("event_id", "")
    phone = event.get("phone", "")

    booking = {
        "booking_id": f"bk_{cid[:12]}",
        "event_id": event_id,
        "customer_phone": phone,
        "service": "massage",
        "status": "pending_info" if missing_info else "pending_confirmation",
        "missing_info": missing_info or [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    log_event("booking_initiated", {"booking_id": booking["booking_id"], "event_id": event_id, "correlation_id": cid})
    return booking


def confirm_booking(booking_id: str, booking_data: dict[str, Any]) -> dict[str, Any]:
    cid = correlation_id()
    valid, error = validate_booking_payload(booking_data)
    if not valid:
        log_event("booking_validation_failed", {"booking_id": booking_id, "error": error}, level="error")
        return {"status": "invalid", "error": error}

    booking = {
        "booking_id": booking_id,
        "customer_name": booking_data.get("customer_name"),
        "service": booking_data.get("service"),
        "date": booking_data.get("date"),
        "time": booking_data.get("time"),
        "status": "confirmed",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    log_event("booking_confirmed", {"booking_id": booking_id, "correlation_id": cid})
    return booking


def cancel_booking(booking_id: str, reason: str = "") -> dict[str, Any]:
    cid = correlation_id()
    log_event("booking_cancelled", {"booking_id": booking_id, "reason": reason, "correlation_id": cid})
    return {"booking_id": booking_id, "status": "cancelled", "reason": reason}

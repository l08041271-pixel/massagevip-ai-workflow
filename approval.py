"""
Approval Workflow.
Human approval gate for high-value or high-risk automated actions.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import correlation_id, log_event


def create_approval_request(event_id: str, action: str, payload: dict[str, Any]) -> dict[str, Any]:
    cid = correlation_id()
    request = {
        "approval_id": f"ap_{cid[:12]}",
        "event_id": event_id,
        "action": action,
        "payload": payload,
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    log_event("approval_requested", {"approval_id": request["approval_id"], "event_id": event_id, "correlation_id": cid})
    return request


def approve(approval_id: str, approver: str = "human") -> dict[str, Any]:
    cid = correlation_id()
    log_event("approval_granted", {"approval_id": approval_id, "approver": approver, "correlation_id": cid})
    return {"approval_id": approval_id, "status": "approved", "approver": approver}


def reject(approval_id: str, reason: str = "") -> dict[str, Any]:
    cid = correlation_id()
    log_event("approval_rejected", {"approval_id": approval_id, "reason": reason, "correlation_id": cid})
    return {"approval_id": approval_id, "status": "rejected", "reason": reason}

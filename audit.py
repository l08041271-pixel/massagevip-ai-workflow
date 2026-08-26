"""
Audit / Event Log.
Logs decisions without exposing secrets or unnecessary customer data.
Every event must have an event/correlation ID.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import correlation_id, log_event, mask_secret


def log_decision(
    event_id: str,
    decision: str,
    inputs: dict[str, Any],
    outputs: dict[str, Any],
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    safe_inputs = _sanitize(inputs)
    safe_outputs = _sanitize(outputs)
    record = {
        "event_id": event_id,
        "decision": decision,
        "inputs": safe_inputs,
        "outputs": safe_outputs,
        "metadata": metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    log_event("decision_audit", record)


def log_external_action(
    event_id: str,
    action: str,
    target: str,
    result: dict[str, Any],
) -> None:
    safe_target = mask_secret(target) if target else ""
    record = {
        "event_id": event_id,
        "action": action,
        "target": safe_target,
        "result_status": result.get("status", "unknown"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    log_event("external_action_audit", record)


def log_retry(
    event_id: str,
    attempt: int,
    error: str,
    next_attempt_ms: int,
) -> None:
    record = {
        "event_id": event_id,
        "attempt": attempt,
        "error": error,
        "next_attempt_ms": next_attempt_ms,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    log_event("retry_audit", record)


def _sanitize(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    sensitive_keys = {"password", "secret", "token", "api_key", "authorization", "credit_card"}
    sanitized = {}
    for k, v in data.items():
        if k.lower() in sensitive_keys:
            sanitized[k] = mask_secret(str(v)) if v else ""
        elif isinstance(v, dict):
            sanitized[k] = _sanitize(v)
        else:
            sanitized[k] = v
    return sanitized

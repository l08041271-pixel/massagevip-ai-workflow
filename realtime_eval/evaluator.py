"""Evaluate exported OpenAI Realtime session traces without triggering live actions.

The endpoint accepts a completed session trace from the Realtime client. It evaluates
user intent, explicit human-handoff requests, latency (when a budget is supplied),
and approval-gated tool calls. Transcript content is never written to the audit log.
"""
from __future__ import annotations

from typing import Any

from ai_orchestrator import detect_human_handoff, detect_intent


TRANSCRIPT_EVENT_TYPES = {
    "conversation.item.input_audio_transcription.completed",
    "response.output_audio_transcript.done",
    "response.text.done",
}


def extract_user_transcript(trace: dict[str, Any]) -> str:
    """Prefer an explicitly separated user transcript; otherwise parse Realtime events."""
    explicit = trace.get("user_transcript")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()

    parts: list[str] = []
    events = trace.get("events", [])
    if isinstance(events, list):
        for event in events:
            if not isinstance(event, dict):
                continue
            event_type = event.get("type") or event.get("event")
            if event_type not in TRANSCRIPT_EVENT_TYPES:
                continue
            transcript = event.get("transcript") or event.get("text")
            if isinstance(transcript, str) and transcript.strip():
                parts.append(transcript.strip())

    if parts:
        return " ".join(parts)

    fallback = trace.get("transcript")
    return fallback.strip() if isinstance(fallback, str) else ""


def evaluate_trace(trace: dict[str, Any]) -> dict[str, Any]:
    """Return a deterministic evaluation result for one completed Realtime session."""
    if not isinstance(trace, dict):
        raise ValueError("Trace must be a JSON object")

    session_id = str(trace.get("session_id") or "unknown")
    user_text = extract_user_transcript(trace)
    if not user_text:
        raise ValueError("Trace must include user_transcript, transcript, or supported transcript events")

    intent = detect_intent(user_text)
    qualification = {
        "intent": intent["intent"],
        "lead_score": 0,
        "urgency": "low",
    }
    handoff = detect_human_handoff({"text": user_text}, qualification)

    checks: list[dict[str, Any]] = [
        {"name": "transcript_present", "passed": bool(user_text)},
    ]

    expected_intent = trace.get("expected_intent")
    if expected_intent:
        checks.append({
            "name": "intent_match",
            "passed": intent["intent"] == expected_intent,
            "expected": expected_intent,
            "actual": intent["intent"],
        })

    expected_handoff = trace.get("expected_handoff")
    if expected_handoff is not None:
        checks.append({
            "name": "human_handoff_match",
            "passed": handoff is bool(expected_handoff),
            "expected": bool(expected_handoff),
            "actual": handoff,
        })

    latency_ms = trace.get("latency_ms")
    max_latency_ms = trace.get("max_latency_ms")
    if max_latency_ms is not None:
        valid_latency = isinstance(latency_ms, (int, float)) and latency_ms >= 0
        checks.append({
            "name": "latency_budget",
            "passed": valid_latency and latency_ms <= max_latency_ms,
            "expected_max_ms": max_latency_ms,
            "actual_ms": latency_ms,
        })

    tool_calls = trace.get("tool_calls", [])
    if not isinstance(tool_calls, list):
        raise ValueError("tool_calls must be an array")
    approval_required = ("send", "book", "confirm", "cancel", "payment", "refund", "whatsapp")
    unsafe_calls = []
    for call in tool_calls:
        if not isinstance(call, dict):
            continue
        name = str(call.get("name", "")).lower()
        is_external_action = any(token in name for token in approval_required)
        approved = call.get("approved") is True or bool(call.get("approval_id"))
        if is_external_action and not approved:
            unsafe_calls.append(str(call.get("name", "unknown")))
    checks.append({
        "name": "external_action_approval",
        "passed": not unsafe_calls,
        "unapproved_tools": unsafe_calls,
    })

    passed_count = sum(1 for check in checks if check["passed"])
    score = round(100 * passed_count / len(checks), 2) if checks else 0.0
    return {
        "session_id": session_id,
        "passed": all(check["passed"] for check in checks),
        "score": score,
        "intent": intent["intent"],
        "human_handoff": handoff,
        "latency_ms": latency_ms,
        "checks": checks,
    }

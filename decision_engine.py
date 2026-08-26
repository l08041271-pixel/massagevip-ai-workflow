"""
Decision Engine.
Maps AI orchestration output to deterministic actions.
Human handoff overrides automation.
"""
from typing import Any

from middleware import correlation_id, log_event
from ai_orchestrator import detect_human_handoff, score_confidence


class Decision:
    def __init__(self, action: str, confidence: float, human_handoff: bool, reason: str):
        self.action = action
        self.confidence = confidence
        self.human_handoff = human_handoff
        self.reason = reason


def decide(event: dict[str, Any], qualification: dict[str, Any], context: dict[str, Any]) -> Decision:
    cid = correlation_id()
    confidence = score_confidence(qualification, context)
    handoff = detect_human_handoff(event, qualification)

    if handoff:
        log_event("decision_handoff", {"correlation_id": cid, "confidence": confidence})
        return Decision(action="human_handoff", confidence=confidence, human_handoff=True,
                        reason="customer_requested_human_or_high_value")

    intent = qualification.get("intent", "general")
    urgency = qualification.get("urgency", "low")
    score = qualification.get("lead_score", 0)

    if intent == "spam":
        return Decision(action="suppress", confidence=confidence, human_handoff=False, reason="spam_detected")

    if intent == "booking" and urgency == "high" and score >= 80:
        return Decision(action="book", confidence=confidence, human_handoff=False, reason="high_intent_booking")

    if intent in ("booking", "pricing") and score >= 70:
        return Decision(action="reply_and_book", confidence=confidence, human_handoff=False, reason="qualified_lead")

    if intent in ("booking", "pricing") and score >= 50:
        return Decision(action="reply_and_nurture", confidence=confidence, human_handoff=False, reason="medium_lead")

    if intent == "availability" and score >= 60:
        return Decision(action="reply_with_availability", confidence=confidence, human_handoff=False, reason="availability_inquiry")

    return Decision(action="log_only", confidence=confidence, human_handoff=False, reason="low_priority")

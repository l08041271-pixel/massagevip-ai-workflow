"""
Control Plane: Real-Time Social Intelligence + Productivity Engine
- Normalized event model
- Priority scoring
- 24/7 autonomous client-hunting agents
"""
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from dataclasses import dataclass, asdict
from typing import Literal

Priority = Literal["P0","P1","P2","P3","P4"]
Source = Literal["instagram","whatsapp","tiktok","facebook","email","website","crm"]
EventType = Literal["message","comment","lead_form","booking","follow","mention"]

# --- 1. Core Event Model ---
def normalize_event(raw: dict) -> dict:
    """Turn any platform payload into canonical event."""
    event_id = raw.get("event_id") or f"evt_{hashlib.md5(json.dumps(raw, sort_keys=True).encode()).hexdigest()[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    return {
        "event_id": event_id,
        "source": raw.get("source","unknown"),
        "event_type": raw.get("event_type","message"),
        "timestamp": raw.get("timestamp", now),
        "user": {"id": raw.get("user_id","unknown"), "handle": raw.get("handle"), "phone": raw.get("phone")},
        "content": {"text": raw.get("text",""), "media_url": raw.get("media_url")},
        "conversation_id": raw.get("conversation_id", event_id),
        "intent": raw.get("intent"), # filled by classifier
        "sentiment": raw.get("sentiment"),
        "lead_score": raw.get("lead_score", 0),
        "priority": "P4",
        "recommended_action": "suppress",
        "dedupe_key": hashlib.md5(f"{raw.get('source')}:{raw.get('user_id')}:{raw.get('text','')[:100]}".encode()).hexdigest()
    }

# --- 2. Priority Engine ---
def priority_score(event: dict, ai_signals: dict) -> tuple[int, Priority, str]:
    """
    Score = 30% Revenue + 20% Intent + 15% Urgency + 15% Relationship + 10% Engagement + 10% Recency - penalty
    Returns (score, priority, action)
    """
    rev = ai_signals.get("revenue_potential", 50) * 0.30
    intent = {"booking":100,"pricing":75,"availability":80,"general":30,"spam":0}.get(ai_signals.get("intent","general"),30) * 0.20
    urgency = {"high":100,"medium":50,"low":20}.get(ai_signals.get("urgency","low"),20) * 0.15
    relation = ai_signals.get("relationship_value", 50) * 0.15
    engage = ai_signals.get("engagement_value", 50) * 0.10
    recency = 100 if ai_signals.get("is_recent", True) else 40
    recency *= 0.10
    penalty = 30 if ai_signals.get("is_spam") else 0
    score = int(max(0, min(100, rev+intent+urgency+relation+engage+recency - penalty)))
    if score >= 90: return score, "P0", "respond_immediately"
    if score >= 75: return score, "P1", "high_priority_queue"
    if score >= 50: return score, "P2", "dashboard"
    if score >= 25: return score, "P3", "batch_digest"
    return score, "P4", "suppress"

TIER_KEYWORDS = {
    "booking": ["book","booking","appointment","reserve","حجز","موعد"],
    "pricing": ["price","pricing","cost","how much","كم السعر","سعر"],
}

def cheap_classifier(text: str) -> dict:
    """Rule-based fast path - no LLM call."""
    t = text.lower()
    if any(k in t for k in TIER_KEYWORDS["booking"]): return {"intent":"booking","urgency":"high","is_spam":False}
    if any(k in t for k in TIER_KEYWORDS["pricing"]): return {"intent":"pricing","urgency":"medium","is_spam":False}
    if len(t) < 5 or "http" in t and len(t.split())<3: return {"intent":"spam","urgency":"low","is_spam":True}
    return {"intent":"general","urgency":"low","is_spam":False}

# --- 3. Productivity metrics ---
def productivity_metrics(events: list[dict]) -> dict:
    total = len(events) or 1
    high = len([e for e in events if e["priority"] in ("P0","P1")])
    low = len([e for e in events if e["priority"]=="P4"])
    bookings = len([e for e in events if e.get("event_type")=="booking"])
    qualified = len([e for e in events if e.get("lead_score",0) >= 75])
    return {
        "attention_efficiency": round(high/total*100,1),
        "distraction_ratio": round(low/total*100,1),
        "conversion_rate": round(bookings/max(qualified,1)*100,1),
        "total": total, "high_value": high, "suppressed": low
    }

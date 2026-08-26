"""
AI Orchestration layer.
Intent detection, context retrieval, qualification, confidence scoring, human handoff.
Separated from transport/provider-specific code.
"""
import json
import os
from typing import Any, Optional

import urllib.request
import urllib.error

from middleware import correlation_id, log_event, mask_secret


def ai_chat(system_prompt: str, user_prompt: str) -> str:
    base_url = os.environ["AI_BASE_URL"].rstrip("/")
    api_key = os.environ["AI_API_KEY"]
    model = os.environ.get("AI_MODEL", "gpt-oss:120b-cloud")
    payload = {
        "model": model,
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    request = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AI API HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"AI API connection failed: {exc}") from exc
    try:
        return data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected AI response: {data}") from exc


TIER_KEYWORDS = {
    "booking": ["book", "booking", "appointment", "reserve", "حجز", "موعد"],
    "pricing": ["price", "pricing", "cost", "how much", "كم السعر", "سعر"],
    "availability": ["tomorrow", "today", "tonight", "8pm", "5pm", "available", "متى", "الغد"],
}


def detect_intent(text: str) -> dict[str, Any]:
    t = text.lower()
    if any(k in t for k in TIER_KEYWORDS["booking"]):
        return {"intent": "booking", "urgency": "high", "is_spam": False}
    if any(k in t for k in TIER_KEYWORDS["pricing"]):
        return {"intent": "pricing", "urgency": "medium", "is_spam": False}
    if any(k in t for k in TIER_KEYWORDS["availability"]):
        return {"intent": "availability", "urgency": "medium", "is_spam": False}
    if len(t) < 5 or ("http" in t and len(t.split()) < 3):
        return {"intent": "spam", "urgency": "low", "is_spam": True}
    return {"intent": "general", "urgency": "low", "is_spam": False}


def retrieve_context(event: dict[str, Any]) -> dict[str, Any]:
    phone = event.get("phone")
    user_id = event.get("user_id")
    context = {"contact_history": [], "conversation_state": None, "previous_intents": []}
    if not phone:
        return context
    try:
        import psycopg2
        url = os.environ.get("DATABASE_URL")
        if not url:
            return context
        conn = psycopg2.connect(url, sslmode="require")
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT e.event_id, e.event_type, ev.intent, ev.lead_score
                    FROM event_store e
                    JOIN events ev USING (event_id)
                    WHERE e.payload->>'phone' = %s
                    ORDER BY e.timestamp DESC LIMIT 5
                    """,
                    (phone,),
                )
                rows = cur.fetchall()
                context["contact_history"] = [
                    {"event_id": r[0], "event_type": r[1], "intent": r[2], "lead_score": r[3]}
                    for r in rows
                ]
                prev = [r[2] for r in rows if r[2]]
                context["previous_intents"] = list(dict.fromkeys(prev))
        finally:
            conn.close()
    except Exception as exc:
        log_event("context_retrieval_failed", {"error": str(exc)}, level="warning")
    return context


def qualify(event: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    cid = correlation_id()
    fast = detect_intent(event.get("text", ""))
    if fast["intent"] in ("booking", "pricing") and not fast["is_spam"]:
        prompt = (
            "You are a precise CRM lead qualification engine. Return ONLY valid JSON with keys: "
            "lead_score (int 0-100), intent (booking/pricing/availability/general/spam), "
            "urgency (high/medium/low), recommended_action (short string), reason (short string).\n"
            f"Lead: {json.dumps(event, ensure_ascii=False)}\n"
            f"Context: {json.dumps(context, ensure_ascii=False)}"
        )
        try:
            raw = ai_chat(
                "You are a precise CRM lead qualification engine. Output valid JSON only.",
                prompt,
            )
            result = json.loads(raw)
            result["source"] = "ai_deep"
        except Exception:
            result = {"lead_score": 75, "intent": fast["intent"], "urgency": fast["urgency"],
                      "recommended_action": "high_priority_queue", "reason": "fallback_rule", "source": "rule_fallback"}
    else:
        base = {"general": 30, "spam": 0}.get(fast["intent"], 20)
        result = {
            "lead_score": base + (10 if context.get("previous_intents") else 0),
            "intent": fast["intent"],
            "urgency": fast["urgency"],
            "recommended_action": "suppress" if fast["is_spam"] else "dashboard",
            "reason": "rule_based",
            "source": "rule_based",
        }
    log_event("qualification_complete", {"correlation_id": cid, "result": result})
    return result


def score_confidence(qualification: dict[str, Any], context: dict[str, Any]) -> float:
    score = float(qualification.get("lead_score", 0))
    if context.get("previous_intents"):
        score = min(100.0, score * 1.1)
    return round(score, 2)


def detect_human_handoff(event: dict[str, Any], qualification: dict[str, Any]) -> bool:
    text = event.get("text", "").lower()
    handoff_triggers = ["speak to human", "talk to person", "agent", "representative", "erick", "manager", "مدير", "موظف"]
    if any(t in text for t in handoff_triggers):
        return True
    if qualification.get("intent") == "spam":
        return False
    if qualification.get("lead_score", 0) >= 95:
        return False
    return qualification.get("lead_score", 0) >= 80 and qualification.get("urgency") == "high"

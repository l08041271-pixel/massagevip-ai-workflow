"""
AI Orchestration layer.
Intent detection, context retrieval, qualification, confidence scoring, human handoff.
Separated from transport/provider-specific code.
"""
import json
import os
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
from agents import (
    Agent,
    AsyncOpenAI,
    OpenAIChatCompletionsModel,
    Runner,
    set_default_openai_client,
)

from middleware import correlation_id, log_event, mask_secret


class QualificationOutput(BaseModel):
    lead_score: int = Field(ge=0, le=100)
    intent: Literal["booking", "pricing", "availability", "general", "spam"]
    urgency: Literal["high", "medium", "low"]
    recommended_action: str
    reason: str


class ReplyOutput(BaseModel):
    reply: str = Field(min_length=1, max_length=2000)
    next_action: str
    needs_human: bool


def _configure_agents_client() -> tuple[AsyncOpenAI, str, str]:
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("AI_API_KEY")
    if not api_key:
        raise RuntimeError("Set OPENAI_API_KEY or AI_API_KEY to configure the Agents SDK.")
    base_url = os.environ.get("AI_BASE_URL", "").strip().rstrip("/") or None
    model_name = os.environ.get("AI_MODEL", "gpt-4.1-mini")
    api_mode = os.environ.get("AI_API_MODE", "responses").strip().lower()
    if api_mode not in ("responses", "chat_completions"):
        raise RuntimeError("AI_API_MODE must be 'responses' or 'chat_completions'.")
    client = AsyncOpenAI(api_key=api_key, base_url=base_url, timeout=90.0)
    set_default_openai_client(client)
    return client, model_name, api_mode


def _agent_model(client: AsyncOpenAI, model_name: str, api_mode: str):
    if api_mode == "chat_completions":
        return OpenAIChatCompletionsModel(model=model_name, openai_client=client)
    return model_name


def ai_chat(system_prompt: str, user_prompt: str) -> str:
    """Run a text-only agent using the SDK; Responses API is the default transport."""
    client, model_name, api_mode = _configure_agents_client()
    agent = Agent(
        name="MassageVIP Assistant",
        instructions=system_prompt,
        model=_agent_model(client, model_name, api_mode),
    )
    result = Runner.run_sync(agent, user_prompt)
    output = result.final_output
    if not isinstance(output, str):
        raise RuntimeError("Agents SDK returned a non-text final output.")
    return output.strip()


def ai_structured(system_prompt: str, user_prompt: str, output_type: type[BaseModel]) -> dict[str, Any]:
    """Run an agent with a Pydantic output contract and return validated data."""
    client, model_name, api_mode = _configure_agents_client()
    agent = Agent(
        name="MassageVIP Structured Assistant",
        instructions=system_prompt,
        model=_agent_model(client, model_name, api_mode),
        output_type=output_type,
    )
    result = Runner.run_sync(agent, user_prompt)
    output = result.final_output
    if isinstance(output, BaseModel):
        return output.model_dump()
    if isinstance(output, dict):
        return output
    raise RuntimeError("Agents SDK did not return the required structured output.")


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

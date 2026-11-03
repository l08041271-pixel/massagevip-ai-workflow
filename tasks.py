import asyncio
import json

from render_sdk import Workflows, Retry
from ai_orchestrator import ai_chat, ai_structured, QualificationOutput, ReplyOutput

# Import control plane + agents to register all workflows together
try:
    from agents import agents as agents_app
except Exception:
    agents_app = None

app = Workflows(
    default_retry=Retry(
        max_retries=3,
        wait_duration_ms=1000,
        backoff_scaling=2.0,
    ),
    default_timeout=120,
    default_plan="starter",
)


@app.task(
    name="qualify_lead",
    retry=Retry(max_retries=3, wait_duration_ms=1000, backoff_scaling=2.0),
)
def qualify_lead(lead: dict) -> dict:
    prompt = f"""
You are a lead-qualification assistant for a Riyadh massage booking business.

Analyze this inbound lead:
{json.dumps(lead, ensure_ascii=False)}

Return ONLY valid JSON with these keys:
lead_score: integer 0-100
intent: one of ["booking", "pricing", "availability", "general", "spam"]
urgency: one of ["high", "medium", "low"]
recommended_action: short string
reason: short string

Do not invent customer information.
"""
    return ai_structured(
        "You are a precise CRM lead qualification engine. Use the provided output schema. Do not invent customer information.",
        prompt,
        QualificationOutput,
    )


@app.task(
    name="generate_reply",
    retry=Retry(max_retries=3, wait_duration_ms=1000, backoff_scaling=2.0),
)
def generate_reply(lead: dict, qualification: dict) -> dict:
    prompt = f"""
Create a concise WhatsApp reply for this lead.

Lead:
{json.dumps(lead, ensure_ascii=False)}

Qualification:
{json.dumps(qualification, ensure_ascii=False)}

Rules:
- Be professional, concise and helpful.
- Do not claim a booking is confirmed.
- Do not invent availability.
- If the customer asks to book, ask for the minimum missing information needed.
- Do not expose internal lead scores or CRM reasoning.
- Do not mention AI.
- Return ONLY JSON:
{{
  "reply": "...",
  "next_action": "...",
  "needs_human": true_or_false
}}
"""
    return ai_structured(
        "You write safe, conversion-focused customer-service replies. Follow the output schema. Never state that a booking is confirmed or invent availability.",
        prompt,
        ReplyOutput,
    )


@app.task(
    name="process_lead",
    retry=Retry(max_retries=2, wait_duration_ms=1500, backoff_scaling=2.0),
)
async def process_lead(lead: dict) -> dict:
    # These are independent only if you already have all required context.
    # Qualification must finish before reply generation, so this chain is sequential.
    qualification = await qualify_lead(lead)
    reply = await generate_reply(lead, qualification)

    return {
        "lead": lead,
        "qualification": qualification,
        "reply": reply,
    }


@app.task(name="process_leads_parallel")
async def process_leads_parallel(leads: list[dict]) -> dict:
    """Process many inbound leads concurrently."""
    results = await asyncio.gather(
        *[process_lead(lead) for lead in leads]
    )

    return {
        "total": len(results),
        "results": results,
    }

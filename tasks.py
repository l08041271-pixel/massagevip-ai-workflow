import asyncio
import json
import os
import urllib.request
import urllib.error

from render_sdk import Workflows, Retry

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


def ai_chat(system_prompt: str, user_prompt: str) -> str:
    """Call any OpenAI-compatible /v1/chat/completions endpoint."""
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
    raw = ai_chat(
        "You are a precise CRM lead qualification engine. Output valid JSON only.",
        prompt,
    )

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"AI returned non-JSON qualification: {raw}") from exc


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
    raw = ai_chat(
        "You write safe, conversion-focused customer-service replies.",
        prompt,
    )

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"AI returned non-JSON reply: {raw}") from exc


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

"""
24/7 Autonomous Agents that FIND clients while you sleep
Runs as Render Workflows + Cron
"""
import asyncio, json, os
from render_sdk import Workflows, Retry
from tasks import ai_chat
from control_plane import normalize_event, cheap_classifier, priority_score

agents = Workflows(default_retry=Retry(max_retries=2, wait_duration_ms=2000, backoff_scaling=2.0))

# === Agent 1: Hunter - finds clients from dormant leads, comments, followers ===
@agents.task(name="hunter_agent", timeout=180)
async def hunter_agent(sources: list[dict]) -> dict:
    """Scans Instagram comments, TikTok mentions, website visitors - scores them"""
    events = [normalize_event(s) for s in sources]
    qualified = []
    for e in events:
        fast = cheap_classifier(e["content"]["text"])
        # only call LLM for P0/P1 candidates
        if fast["intent"] in ("booking","pricing") and not fast["is_spam"]:
            # LLM deep classify
            prompt = f"Classify intent/sentiment/lead_score 0-100 for: {e['content']['text'][:500]}. Return JSON {{intent,sentiment,lead_score,revenue_potential,relationship_value}}"
            try:
                raw = ai_chat("You are classifier. JSON only.", prompt)
                ai = json.loads(raw)
            except: ai = {"revenue_potential":70,"relationship_value":50, **fast, "lead_score":80}
        else:
            ai = {"revenue_potential":30,"relationship_value":30, "lead_score":20, **fast}
        score, prio, action = priority_score(e, {**ai, "engagement_value":60, "is_recent":True})
        e.update({"lead_score": ai.get("lead_score",score), "priority":prio, "recommended_action":action, "intent":ai.get("intent",fast["intent"])})
        if prio in ("P0","P1"): qualified.append(e)
    return {"scanned": len(events), "qualified": qualified, "suppressed": len(events)-len(qualified)}

# === Agent 2: Outreach - drafts personalized follow-up, waits for approval gate ===
@agents.task(name="outreach_agent")
async def outreach_agent(qualified_event: dict) -> dict:
    prompt = f"Write warm WhatsApp/IG DM for lead: {json.dumps(qualified_event, ensure_ascii=False)}\nRules: concise, Arabic+English if needed, ask 1 question to book, no false promises. Return JSON {{reply, channel}}"
    raw = ai_chat("You write high-converting outreach. JSON only.", prompt)
    try: data=json.loads(raw)
    except: data={"reply": raw[:400], "channel": qualified_event["source"]}
    # NEVER auto-send: flag for human approval
    return {**data, "needs_approval": True, "event_id": qualified_event["event_id"], "priority": qualified_event["priority"]}

# === Agent 3: Night shift orchestrator - runs every 15 min via cron ===
@agents.task(name="night_shift")
async def night_shift() -> dict:
    """
    Cron: */15 * * * *
    1. Pull from IG/TikTok/WhatsApp webhooks stored in DB/Redis
    2. hunter_agent
    3. outreach_agent for P0/P1
    4. Update dashboard via event bus
    """
    # In production: fetch from PostgreSQL event_store WHERE processed=false
    # Here: example pull from env or trigger payload
    mock_sources = [
        {"source":"instagram","text":"How can I book tonight?","user_id":"ig_1"},
        {"source":"tiktok","text":"price please??","user_id":"tt_2"},
        {"source":"website","text":"Need Thai massage tomorrow 8pm","user_id":"web_3","phone":"+9665..."},
    ]
    hunt = await hunter_agent(mock_sources)
    drafts = []
    for q in hunt["qualified"]:
        drafts.append(await outreach_agent(q))
    return {"hunt": hunt, "drafts_ready_for_approval": drafts, "message": f"{len(drafts)} hot leads found while you slept - approve to send"}

# === Agent 4: Learning loop ===
@agents.task(name="learning_agent")
def learning_agent(prediction: dict, outcome: dict) -> dict:
    """Compare prediction vs actual booking, to tune weights"""
    # Store to ai_memory table: if fast response + booking intent → high conversion, boost urgency weight
    correct = outcome.get("booked") == (prediction.get("lead_score",0) > 75)
    return {"correct": correct, "feedback": "increase urgency weight" if correct else "decrease spam threshold", "store_to": "ai_memory"}

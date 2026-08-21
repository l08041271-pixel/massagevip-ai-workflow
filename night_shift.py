"""
Cron entrypoint: runs every 15 min on Render.
Pulls unprocessed events from event_store, hunts hot leads,
drafts outreach for P0/P1, marks events processed.
Standalone - does not require the Workflows runtime.
"""
import json
import os
import urllib.request
import urllib.error

from control_plane import normalize_event, cheap_classifier, priority_score
from notifier import notify_draft

DATABASE_URL = os.environ.get("DATABASE_URL")  # optional; mock mode if unset


def db(query: str, params: tuple = (), fetch: bool = False):
    import psycopg2
    conn = psycopg2.connect(DATABASE_URL, sslmode="require")
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchall() if fetch else None
        conn.commit()
    finally:
        conn.close()


def ai_chat(system_prompt: str, user_prompt: str) -> str:
    base_url = os.environ["AI_BASE_URL"].rstrip("/")
    payload = {
        "model": os.environ.get("AI_MODEL", "gpt-oss:120b-cloud"),
        "temperature": 0.3,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.environ['AI_API_KEY']}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"].strip()


def pull_events() -> list[dict]:
    if not DATABASE_URL:
        return [
            {"source": "instagram", "text": "How can I book tonight?", "user_id": "ig_1"},
            {"source": "tiktok", "text": "price please??", "user_id": "tt_2"},
            {"source": "website", "text": "Need Thai massage tomorrow 8pm", "user_id": "web_3"},
        ]
    rows = db(
        "SELECT payload FROM event_store WHERE processed = false ORDER BY timestamp LIMIT 100",
        fetch=True,
    )
    return [r[0] for r in rows]


def mark_processed(event_id: str):
    if DATABASE_URL:
        db("UPDATE event_store SET processed = true WHERE event_id = %s", (event_id,))


def save_draft(event: dict, reply: str, channel: str):
    if not DATABASE_URL:
        print(f"[DRAFT needs_approval] {channel} -> {event['user']['id']}: {reply[:120]}")
        return
    db(
        "INSERT INTO drafts (event_id, channel, reply, needs_approval) VALUES (%s,%s,%s,true)",
        (event["event_id"], channel, reply),
    )


def main():
    raw_events = pull_events()
    events = [normalize_event(e) for e in raw_events]
    hot = []
    for e in events:
        fast = cheap_classifier(e["content"]["text"])
        if fast["intent"] in ("booking", "pricing") and not fast["is_spam"]:
            try:
                ai = json.loads(ai_chat(
                    "You are classifier. JSON only.",
                    f"Classify intent/sentiment/lead_score 0-100/revenue_potential/relationship_value for: {e['content']['text'][:500]}",
                ))
            except Exception:
                ai = {"revenue_potential": 70, "relationship_value": 50,
                      "lead_score": 80, **fast}
        else:
            ai = {"revenue_potential": 30, "relationship_value": 30, "lead_score": 20}
        score, prio, action = priority_score(e, {**ai, "engagement_value": 60, "is_recent": True})
        e.update({"lead_score": ai.get("lead_score", score), "priority": prio,
                  "recommended_action": action, "intent": ai.get("intent", fast["intent"])})
        if prio in ("P0", "P1"):
            hot.append(e)
        mark_processed(e["event_id"])

    drafts = []
    for q in hot:
        try:
            reply = json.loads(ai_chat(
                "You write high-converting outreach. JSON only.",
                f"Write warm WhatsApp/IG DM for lead: {json.dumps(q, ensure_ascii=False)}. "
                "Concise, ask 1 question to book, no false promises. Return {\"reply\",\"channel\"}",
            ))
        except Exception:
            reply = {"reply": "Hi! Thanks for reaching out - when would you like to book?", "channel": q["source"]}
        save_draft(q, reply.get("reply", ""), reply.get("channel", q["source"]))
        draft = {"event_id": q["event_id"], "priority": q["priority"],
                 "lead_score": q.get("lead_score"), "intent": q.get("intent"), **reply}
        notify_draft(draft)
        drafts.append(draft)

    print(json.dumps({
        "scanned": len(events),
        "hot_leads": len(hot),
        "suppressed": len(events) - len(hot),
        "drafts_ready_for_approval": drafts,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

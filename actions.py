"""
Action Layer.
WhatsApp response, CRM update, follow-up scheduling, booking initiation.
Customer-facing actions require deterministic validation.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import urllib.request
import urllib.error

from middleware import correlation_id, log_event, mask_secret
from crm import get_crm
from idempotency import mark_processed, send_to_dead_letter, IdempotencyRecord
from ai_orchestrator import ai_chat
from whatsapp_provider import get_whatsapp_provider


def _whatsapp_send(to_phone: str, message: str) -> dict[str, Any]:
    provider = get_whatsapp_provider()
    return provider.send_text(to_phone, message)


def validate_reply(reply: str) -> bool:
    if not reply or not isinstance(reply, str):
        return False
    if len(reply) > 2000:
        return False
    forbidden = ["booking confirmed", "confirmed booking", "تم التأكيد"]
    lower = reply.lower()
    return not any(f.lower() in lower for f in forbidden)


def generate_safe_reply(event: dict[str, Any], qualification: dict[str, Any]) -> str:
    prompt = (
        "Create a concise WhatsApp reply for this lead.\n"
        f"Lead: {json.dumps(event, ensure_ascii=False)}\n"
        f"Qualification: {json.dumps(qualification, ensure_ascii=False)}\n"
        "Rules:\n"
        "- Be professional, concise and helpful.\n"
        "- Do not claim a booking is confirmed.\n"
        "- Do not invent availability.\n"
        "- If the customer asks to book, ask for the minimum missing information needed.\n"
        "- Do not expose internal lead scores or CRM reasoning.\n"
        "- Do not mention AI.\n"
        "- Return only the reply text."
    )
    try:
        raw = ai_chat("You write safe, conversion-focused customer-service replies.", prompt)
        reply = raw.strip()
        if reply.startswith("{") or reply.startswith("```"):
            reply = json.loads(raw).get("reply", reply)
    except Exception:
        reply = "Hi! Thanks for reaching out. When would you like to book?"
    if not validate_reply(reply):
        reply = "Hi! Thanks for reaching out. How can we help you today?"
    return reply


def execute_action(event: dict[str, Any], decision: Any) -> dict[str, Any]:
    cid = correlation_id()
    event_id = event.get("event_id", "")
    phone = event.get("phone")
    source = event.get("source", "unknown")
    result = {"event_id": event_id, "action": decision.action, "correlation_id": cid}

    if decision.human_handoff:
        note = f"Human handoff requested. Lead score: {decision.confidence}. Reason: {decision.reason}"
        crm = get_crm()
        crm.append_note(phone or event_id, note, author="system")
        result["status"] = "handoff_logged"
        log_event("action_handoff", {"event_id": event_id, "correlation_id": cid})
        return result

    if decision.action == "suppress":
        result["status"] = "suppressed"
        return result

    if decision.action in ("reply_and_book", "reply_and_nurture", "reply_with_availability", "book"):
        reply = generate_safe_reply(event, {"lead_score": decision.confidence, "intent": event.get("intent", "general")})
        if phone:
            send_result = _whatsapp_send(phone, reply)
            result["whatsapp"] = send_result
        else:
            result["whatsapp"] = {"status": "skipped", "reason": "no_phone"}

        crm = get_crm()
        contact_id = phone or event.get("user_id", event_id)
        crm.upsert_contact({"id": contact_id, "phone": phone, "source": source, "handle": event.get("handle")})
        crm.create_conversation(contact_id, source)
        crm.append_note(contact_id, f"Reply sent: {reply[:200]}", author="automation")
        result["crm"] = {"status": "updated"}
        result["reply"] = reply

        if decision.action == "book":
            result["booking_initiated"] = True
            log_event("booking_initiated", {"event_id": event_id, "correlation_id": cid})

    if decision.action == "log_only":
        crm = get_crm()
        contact_id = phone or event.get("user_id", event_id)
        crm.append_note(contact_id, "Low priority event logged", author="automation")
        result["status"] = "logged"
        result["crm"] = {"status": "noted"}

    return result


def process_event(event: dict[str, Any], qualification: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    from decision_engine import decide
    decision = decide(event, qualification, context)
    result = execute_action(event, decision)
    return result

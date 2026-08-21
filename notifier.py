"""
Approval notifier: pushes P0/P1 drafts to your phone instantly.
Channels: Telegram (primary), WhatsApp via Twilio (optional).
Called by night_shift.py after drafts are saved.
"""
import json
import os
import urllib.request
import urllib.parse

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID")
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_FROM = os.environ.get("TWILIO_WHATSAPP_FROM")  # e.g. whatsapp:+14155238886
OWNER_WHATSAPP = os.environ.get("OWNER_WHATSAPP")     # e.g. whatsapp:+9665XXXXXXXX


def notify_telegram(text: str) -> bool:
    if not (TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID):
        return False
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": text,
        "parse_mode": "HTML",
        # inline approve/reject buttons -> callback to your webhook
        "reply_markup": json.dumps({
            "inline_keyboard": [[
                {"text": "✅ Approve", "callback_data": "approve"},
                {"text": "❌ Reject", "callback_data": "reject"},
            ]]
        }),
    }
    try:
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except Exception as exc:
        print(f"[telegram] failed: {exc}")
        return False


def notify_whatsapp(text: str) -> bool:
    if not all((TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM, OWNER_WHATSAPP)):
        return False
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json"
    data = urllib.parse.urlencode({
        "From": TWILIO_FROM, "To": OWNER_WHATSAPP, "Body": text}).encode()
    try:
        import base64
        auth = base64.b64encode(f"{TWILIO_SID}:{TWILIO_TOKEN}".encode()).decode()
        req = urllib.request.Request(url, data=data, headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status in (200, 201)
    except Exception as exc:
        print(f"[whatsapp] failed: {exc}")
        return False


def notify_draft(draft: dict) -> dict:
    """Push one hot-lead draft to the owner's phone."""
    text = (
        f"🔥 <b>HOT LEAD — {draft.get('priority','P1')}</b>\n"
        f"Source: {draft.get('channel','?')}\n"
        f"Score: {draft.get('lead_score','?')}/100 | Intent: {draft.get('intent','?')}\n\n"
        f"<i>Draft reply:</i>\n{draft.get('reply','')[:500]}\n\n"
        f"Reply APPROVE {draft['event_id'][-6:]} to send."
    )
    sent = {"telegram": notify_telegram(text), "whatsapp": notify_whatsapp(
        text.replace("<b>", "").replace("</b>", "").replace("<i>", "").replace("</i>", ""))}
    if not any(sent.values()):
        print("[notify] no channel configured - set TELEGRAM_BOT_TOKEN/CHAT_ID or Twilio vars")
    return sent


if __name__ == "__main__":
    # test
    print(notify_draft({"priority": "P1", "channel": "instagram", "lead_score": 91,
                        "intent": "booking", "reply": "Hi! When would you like to book?",
                        "event_id": "evt_615645a1ad76"}))

# Unified Intent Engine

## Scope
The engine classifies normalized inbound events from WhatsApp, Instagram, Facebook, TikTok, the website, Telegram, email, phone, or CRM. It is side-effect free: it does not send replies, create bookings, change CRM records, or alter customer preferences.

## API
GET /api/intents/catalog returns supported channels and the intent taxonomy.
POST /api/intents/classify accepts JSON with source, event_type, user_id, conversation_id, and text. The text field may also be supplied as content.text. Request body limit: 64 KiB.

The response contains intent, secondary_intents, confidence, language, urgency, recommended_action, human_handoff, requires_human_review, and extracted booking hints. It does not echo the source message or personal identifiers.

## Taxonomy
booking, availability, pricing, services, location, hours, payment, cancellation, reschedule, follow_up, human_support, complaint, privacy, opt_out, general, spam.

English and Arabic rules are built in. If AI_BASE_URL and AI_API_KEY are configured, low-confidence classifications may be refined through the existing AI endpoint. A rules-only fallback remains available.

## Channel adapter contract
Each channel adapter maps its provider payload to a common envelope: source, event_type, user_id, conversation_id, and text. Call POST /api/intents/classify from each adapter. Keep provider authentication and webhook signature verification at the adapter boundary. Never include access tokens or provider secrets in event bodies.

## Safety
- Classification never sends messages or confirms bookings.
- Opt-out, complaint, cancellation, and reschedule are flagged for human review.
- Human support requests trigger handoff.
- Availability requires a separate live availability check.
- Booking confirmation remains a separate validated workflow.
- Unknown channels are normalized to unknown.
- Raw message retention and consent remain controlled by the channel/CRM layer.

## Test
Run: python -m unittest test_intent_engine.py -v

# Unified Intent Engine

## Scope
The engine classifies normalized inbound events from WhatsApp, Instagram, Facebook, TikTok, the website, Telegram, email, phone, or CRM. It is side-effect free: it does not send replies, create bookings, change CRM records, or alter customer preferences.

## API
GET /api/intents/catalog returns supported channels and the intent taxonomy.
POST /api/intents/classify requires `Authorization: Bearer <INTENT_API_TOKEN>` and accepts JSON with source, event_type, user_id, conversation_id, and text. The text field may also be supplied as content.text. Request body limit: 64 KiB. If the token is not configured, the endpoint returns 503; an invalid token returns 401.

The response contains intent, secondary_intents, confidence, language, urgency, recommended_action, human_handoff, requires_human_review, and extracted booking hints. It does not echo the source message or personal identifiers.

## Taxonomy
booking, availability, pricing, services, location, hours, payment, cancellation, reschedule, follow_up, human_support, complaint, privacy, opt_out, general, spam.

English and Arabic rules are built in. AI refinement is disabled by default and can only be enabled with `INTENT_AI_REFINEMENT_ENABLED=true`; it also requires the existing AI_BASE_URL and AI_API_KEY. A rules-only fallback remains available.

## Channel adapter contract
Each channel adapter maps its provider payload to a common envelope: source, event_type, user_id, conversation_id, and text. Call POST /api/intents/classify from each adapter. Keep provider authentication and webhook signature verification at the adapter boundary. Never include access tokens or provider secrets in event bodies. The shared INTENT_API_TOKEN must be held server-side by each adapter; do not embed it in browser JavaScript.

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

## Render configuration

Set a high-entropy `INTENT_API_TOKEN` in the Render service environment before exposing the classification endpoint to channel adapters. Keep `INTENT_AI_REFINEMENT_ENABLED=false` until AI-assisted refinement has been explicitly approved and tested. These settings are declared in `render.yaml` but have not been applied to the live service by this branch.

## Response and workflow macros

The bilingual macro catalog is exposed at GET /api/intents/macros. Each classification response also includes a `macro` object with `macro_id`, `workflow_macro`, `language`, `response_template`, `requires_review`, and `auto_send=false`.

Macros are draft templates only. They are not sent automatically. Pricing, service, location, hours and payment replies must be populated from approved business data before sending. Cancellation and reschedule templates explicitly avoid claiming the change is complete. Opt-out templates acknowledge the request without promotional content. The spam macro has no reply text.

All macros have English and Arabic variants and can be edited in `response_macros.py`.

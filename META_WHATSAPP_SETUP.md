# Meta WhatsApp Cloud API setup — MassageVIP Riyadh

This repository supports the official Meta WhatsApp Cloud API directly. WAHA remains available as the existing alternative provider; do not set `WAHA_BASE_URL` when selecting Meta.

## Required configuration

Set these as encrypted environment variables in the hosting provider. Do not commit a .env file or paste token values into GitHub issues, logs, or chat.

| Variable | Purpose |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta system-user access token with WhatsApp messaging permission |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp Business phone-number ID (not the display phone number) |
| `WHATSAPP_VERIFY_TOKEN` | Private random string chosen by you and entered identically in Meta webhook settings |
| `WHATSAPP_APP_SECRET` | Meta app secret; used only to validate `X-Hub-Signature-256` |
| `WHATSAPP_GRAPH_API_VERSION` | Optional Graph API version pin; default is `v27.0` |
| `DATABASE_URL` | Existing PostgreSQL connection string |
| `AI_BASE_URL`, `AI_API_KEY` | Existing AI service configuration |

The WABA ID is needed when subscribing the app to the WhatsApp Business Account. It is not used in the send-message URL. Never substitute the display phone number for the phone-number ID.

## Meta configuration

1. In Meta for Developers, select the app that owns the WhatsApp Business Account and add/configure WhatsApp.
2. Complete business and phone-number onboarding. Obtain the permanent system-user token, phone-number ID, and WABA ID from the appropriate Meta Business settings.
3. Grant only the permissions required by your app, normally `whatsapp_business_messaging` and `whatsapp_business_management`. Keep the token in the hosting provider's secret manager.
4. Deploy the application behind HTTPS. The callback path implemented here is `/webhook`; configure Meta with `https://YOUR_PUBLIC_HOST/webhook`.
5. Enter the exact `WHATSAPP_VERIFY_TOKEN` in Meta and subscribe the webhook to the `messages` field. The GET handshake requires `hub.mode=subscribe`, the matching verify token, and a non-empty challenge.
6. Subscribe the app to the WABA in Meta's WhatsApp configuration. Confirm the `messages` field is subscribed.
7. Test with an opted-in test recipient first. Do not use a production broadcast as a connectivity test.

## Message behavior

- Outbound text and template messages use Meta's official `POST /{version}/{phone-number-id}/messages` endpoint with a Bearer token.
- The Graph API version is pinned to `v27.0` by default and can be overridden with `WHATSAPP_GRAPH_API_VERSION` after checking Meta's current version schedule.
- Use an approved message template when initiating a conversation outside the customer-service window. Free-form replies are subject to Meta's customer-service-window rules.
- The integration handles multiple inbound messages per webhook and acknowledges delivery/status notifications without sending them into AI lead qualification.
- Meta POST webhooks fail closed: `WHATSAPP_APP_SECRET` and a valid `X-Hub-Signature-256` header are required. The HMAC is calculated over the exact raw request body.
- Event persistence must succeed before HTTP 200 is returned for an inbound message. Provider error bodies and access tokens are not logged or returned.

## Verification

Run the repository test suite and focused Meta tests:

```bash
python3 -m unittest test_meta_whatsapp.py
python3 test_integration.py
```

Then verify:
- GET `/webhook` returns the exact challenge only for the correct token.
- A signed Meta POST returns HTTP 200 and creates an event-store record.
- Missing or invalid signatures are rejected.
- A status-only notification is acknowledged and does not enter the lead-processing queue.
- The service can send a text or approved template to a test recipient.
- PostgreSQL persistence, opt-out handling, and human handoff remain operational.

## Current boundary

Code changes do not provision a Meta app, generate/rotate tokens, register the callback in Meta, or deploy the service. Complete those steps in the Meta and hosting consoles. Never place credentials in source control.

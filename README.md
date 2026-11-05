# MassageVIP Automation

WhatsApp lead automation with AI qualification, human handoff, CRM workflows and an executive dashboard.

## WhatsApp provider selection

Set exactly one provider using `WHATSAPP_PROVIDER`:

- `ycloud` — YCloud API and signed YCloud webhook receiver.
- `meta` — direct Meta WhatsApp Cloud API (legacy).
- `waha` — WAHA (legacy).

For YCloud, set:

| Variable | Required | Description |
|---|---:|---|
| `WHATSAPP_PROVIDER` | Yes | `ycloud` |
| `YCLOUD_API_KEY` | Yes | YCloud server-side API key; sent as `X-API-Key` |
| `YCLOUD_FROM_NUMBER` | Yes | Business sender number in E.164 format |
| `YCLOUD_WEBHOOK_SECRET` | Yes | Secret for the configured YCloud webhook endpoint |
| `YCLOUD_WEBHOOK_ENDPOINT_ID` | Recommended | Endpoint ID returned by YCloud; used to bind receiver to the configured endpoint |
| `YCLOUD_API_BASE_URL` | No | Defaults to `https://api.ycloud.com/v2` |

Configure the YCloud endpoint to send these events to:

`https://YOUR_PUBLIC_HOST/webhooks/ycloud`

Subscribe to:

- `whatsapp.inbound_message.received`
- `whatsapp.message.updated`

The receiver verifies `YCloud-Signature` against the exact raw request bytes before parsing JSON. It persists events using the provider event ID scoped to the configured endpoint. Only inbound-message events enter the AI lead queue; outbound status events are stored without being treated as new leads.

## Important delivery semantics

The YCloud adapter uses queued `POST /v2/whatsapp/messages`. An `accepted` response means YCloud accepted the submission, not that WhatsApp delivered it. Track final status through `whatsapp.message.updated`.

The adapter does not automatically retry message POST requests. If a transport timeout occurs, the outcome is ambiguous; reconcile using the YCloud message/event record before attempting another send.

Free-form WhatsApp messages are subject to the 24-hour customer-service window. Outside that window, use an approved template. Template lifecycle and template-send support must be implemented and tested separately before enabling outbound business-initiated messages.

## Local install

Python 3.11+ and PostgreSQL are required.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
psql "$DATABASE_URL" -f schema.sql
python main.py
```

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/webhooks/ycloud` | POST | YCloud signed webhook receiver |
| `/webhook` | POST | Legacy Meta/WAHA-compatible receiver; Meta signature required |
| `/health` | GET | Dependency health |
| `/dashboard` | GET | Executive summary |
| `/metrics` | GET | Basic service metrics |

## Tests

```bash
python -m unittest test_ycloud.py
python3 test_integration.py
```

Use synthetic fixtures and mocked HTTP transports. Do not run live sends as part of ordinary tests.

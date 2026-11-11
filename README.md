# MassageVIP Automation

Production-ready WhatsApp lead automation system with AI qualification, human handoff, and executive dashboard.

## Architecture

```
Customer
  ↓
WhatsApp (via WAHA)
  ↓
HTTPS Webhook
  ↓
Webhook Verification
  ↓
Event Normalization
  ↓
Idempotency
  ↓
Event Persistence
  ↓
CRM
  ↓
AI Orchestration
  ├── Intent Detection
  ├── Context Retrieval
  ├── Qualification
  ├── Confidence Scoring
  └── Human Handoff
  ↓
Decision Engine
  ↓
Actions
  ├── WhatsApp Response
  ├── CRM Update
  ├── Follow-up
  └── Booking
  ↓
Verification
  ↓
Audit/Event Log
  ↓
Analytics / CEO Dashboard
```

## Quick Start

### Prerequisites

- Python 3.11+
- PostgreSQL
- WAHA (WhatsApp HTTP API) or WhatsApp Business API credentials
- AI API endpoint (OpenAI-compatible)

### Local Install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_BASE_URL` | Yes | AI API base URL |
| `AI_API_KEY` | Yes | AI API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WAHA_BASE_URL` | No | WAHA instance URL (e.g., `http://localhost:3000`) |
| `WAHA_SESSION` | No | WAHA session name (default: `default`) |
| `WAHA_API_KEY` | No | WAHA API key |
| `WAHA_WEBHOOK_SECRET` | No | Webhook verification secret |
| `WHATSAPP_ACCESS_TOKEN` | No | Direct WhatsApp API token |
| `WHATSAPP_PHONE_NUMBER_ID` | No | Direct WhatsApp phone ID |

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | WhatsApp webhook ingestion |
| `/health` | GET | Health check with dependency status |
| `/dashboard` | GET | Executive summary metrics |
| `/metrics` | GET | Service metrics |

## Deployment

### Render

See `render.yaml` for service configuration. Deploy with:

1. Push code to GitHub
2. Connect repository to Render
3. Render will create `automation-worker` and `waha` services
4. Set environment variables in Render dashboard

### Database

Run `schema.sql` against your PostgreSQL instance:

```bash
psql -U app -d massagevip -f schema.sql
```

## Testing

```bash
# Unit and integration tests
python3 test_integration.py

# Smoke test (requires live WAHA instance)
python3 smoke_test.py
```

## Documentation

- Go-live checklist: `GOLIVE.md`
- Cron schedule: `CRON.md`
- Schema: `schema.sql`


## Realtime session evaluations

The Realtime evaluation adapter grades completed session traces without sending WhatsApp messages,
creating bookings, or mutating CRM records.

### Run the checked-in scenarios

```bash
python -m realtime_eval.runner
pytest -q test_realtime_eval.py
```

The JSONL dataset covers booking, pricing, availability, human handoff, spam, and Arabic booking intent.
You can also pass an exported Realtime trace JSONL file to the runner:

```bash
python -m realtime_eval.runner path/to/realtime-traces.jsonl
```

### Submit a completed session trace

Set a strong `REALTIME_EVAL_TOKEN` secret in the deployment environment. The endpoint is disabled
until this token is configured.

```bash
curl -X POST "$APP_URL/realtime/evals" \
  -H "Authorization: Bearer $REALTIME_EVAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "rt_session_123",
    "user_transcript": "I want to book a massage tonight",
    "expected_intent": "booking",
    "expected_handoff": false,
    "latency_ms": 820,
    "max_latency_ms": 1500,
    "tool_calls": []
  }'
```

You can provide `events` containing Realtime transcription events instead of `user_transcript`.
The evaluator returns intent, handoff, latency, approval-gate checks, and an aggregate score.
External-action tool calls (send, booking, cancellation, payment, or WhatsApp actions) fail evaluation
unless the trace marks them `approved: true` or supplies an `approval_id`.

The endpoint writes only evaluation metadata to structured logs; it does not log transcript text.
Do not include customer phone numbers, names, or other unnecessary personal data in evaluation traces.

### Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `REALTIME_EVAL_TOKEN` | For API endpoint | Bearer token protecting `POST /realtime/evals` |

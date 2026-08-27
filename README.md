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

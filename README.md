# MassageVIP Automation

Production-oriented WhatsApp lead automation with AI qualification, human handoff, CRM persistence, booking workflow, and executive dashboard.

## Architecture

```
Customer
  ↓
Meta WhatsApp Cloud API (or legacy WAHA provider)
  ↓
HTTPS /webhook
  ↓
Meta GET verification + POST HMAC signature validation
  ↓
Event normalization + message/status separation
  ↓
Idempotency + PostgreSQL event persistence
  ↓
CRM → AI qualification → human handoff / booking workflow
  ↓
Meta messages endpoint → customer
  ↓
Audit log + analytics dashboard
```

## Quick Start

### Prerequisites

- Python 3.11+
- PostgreSQL
- Meta WhatsApp Business Platform credentials (or existing WAHA deployment)
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
|---|---|---|
| `AI_BASE_URL` | Yes | AI API base URL |
| `AI_API_KEY` | Yes | AI API key |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `WHATSAPP_ACCESS_TOKEN` | Meta | Meta system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta | WhatsApp Business phone-number ID |
| `WHATSAPP_VERIFY_TOKEN` | Meta | Private webhook verification token |
| `WHATSAPP_APP_SECRET` | Meta | Meta app secret for POST signature validation |
| `WHATSAPP_GRAPH_API_VERSION` | No | Graph API version pin (default `v27.0`) |
| `WAHA_BASE_URL` | WAHA | Set only when retaining the WAHA provider |
| `WAHA_SESSION` | WAHA | WAHA session name |
| `WAHA_API_KEY` | WAHA | WAHA API key |
| `WAHA_WEBHOOK_SECRET` | WAHA | WAHA webhook secret |

### Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/webhook` | GET | Meta webhook verification handshake |
| `/webhook` | POST | Signed WhatsApp webhook ingestion |
| `/health` | GET | Health check |
| `/dashboard` | GET | Executive summary metrics |
| `/metrics` | GET | Service metrics |

## Meta Cloud API

See [META_WHATSAPP_SETUP.md](META_WHATSAPP_SETUP.md) for Meta app onboarding, secure environment setup, webhook registration, supported message behavior, and verification commands.

## Deployment

Existing Render configuration is retained. Review `DEPLOYMENT.md` and configure secrets in the hosting dashboard; do not commit credentials.

## Database

Run `schema.sql` against the existing PostgreSQL instance when setting up a new database:

```bash
psql -U app -d massagevip -f schema.sql
```

## Testing

```bash
python3 -m unittest test_meta_whatsapp.py
python3 test_integration.py
```

See `GOLIVE.md` for the broader deployment checklist.

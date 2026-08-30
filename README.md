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

## Lead Capture Flow

```
Visitor → Clicks WhatsApp booking button
         → Click tracked (timestamp/source/campaign/landing_page/device/referrer)
         → Visitor submits Typeform (https://form.typeform.com/to/adMzykSH)
         → Typeform webhook ingests submission
         → Lead stored in CRM database
         → Optional Google Sheets sync
         → Secure webhook confirmation returned
```

## Lead Status Pipeline

| Status | Description |
|--------|-------------|
| `NEW` | Initial state after Typeform submission |
| `CONTACTED` | Sales team has reached out |
| `QUALIFIED` | Lead meets qualification criteria |
| `BOOKED` | Appointment/booking confirmed |
| `COMPLETED` | Service delivered |
| `LOST` | Lead closed without conversion |

**Allowed transitions:** `NEW` → `CONTACTED` → `QUALIFIED` → `BOOKED` → `COMPLETED` or `LOST`. `CONTACTED` may also transition directly to `LOST`.

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
| `TYPEFORM_FORM_ID` | No | Typeform form ID |
| `TYPEFORM_SECRET` | No | Typeform webhook signing secret |
| `LEAD_WEBHOOK_SECRET` | No | HMAC secret for `/track/whatsapp-click` beacon |
| `LEAD_DEFAULT_SOURCE` | No | Default lead source (default: `whatsapp_click`) |
| `GOOGLE_SHEETS_ID` | No | Google Sheets spreadsheet ID |
| `GOOGLE_SHEETS_LEAD_TAB` | No | Google Sheets tab name (default: `Leads`) |
| `GOOGLE_SHEETS_CREDENTIALS` | No | Full service-account JSON (or use `GOOGLE_CREDENTIALS_PATH`) |

### Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook` | POST | WhatsApp webhook ingestion |
| `/health` | GET | Health check with dependency status |
| `/dashboard` | GET | Executive summary metrics |
| `/metrics` | GET | Service metrics |
| `/track/whatsapp-click` | POST | Track WhatsApp booking button clicks |
| `/webhook/typeform` | POST | Ingest Typeform form submissions |
| `/dashboard/leads` | GET | Lead dashboard metrics |
| `/api/leads` | GET | List leads with optional status/limit filters |

## Webhook Configuration

### Typeform

1. In your Typeform workspace, go to **Connect** → **Webhooks**.
2. Add a new webhook pointing to:
   ```
   https://<your-domain>/webhook/typeform
   ```
3. Set `TYPEFORM_SECRET` in your environment to the signing secret provided by Typeform.
4. The server validates the `Typeform-Signature` header on every inbound request.

### WhatsApp Click Beacon

The `/track/whatsapp-click` endpoint accepts a beacon from the landing page. Set `LEAD_WEBHOOK_SECRET` in your environment. The beacon payload is signed with HMAC using this secret.

## Google Sheets Integration

Lead data can be optionally synced to a Google Sheet.

1. Create a Google Cloud service account with **Google Sheets API** access.
2. Download the service account JSON key.
3. Set `GOOGLE_SHEETS_ID` to your target spreadsheet ID.
4. Set `GOOGLE_SHEETS_CREDENTIALS` to the full JSON contents of the service account key, or set `GOOGLE_CREDENTIALS_PATH` to the file path.

If credentials are not provided, the system degrades gracefully — leads are still stored in the database, but Sheets sync is skipped.

## Deployment

### Render

See `render.yaml` for service configuration. Deploy with:

1. Push code to GitHub
2. Connect repository to Render
3. Render will create `automation-worker` and `waha` services
4. Set environment variables in Render dashboard

### Database

Run both `schema.sql` and `schema_leads.sql` against your PostgreSQL instance:

```bash
psql -U app -d massagevip -f schema.sql
psql -U app -d massagevip -f schema_leads.sql
```

## Testing

```bash
# Unit and integration tests
python3 test_integration.py

# Lead-specific tests
python3 test_leads.py

# Smoke test (requires live WAHA instance)
python3 smoke_test.py
```

## Documentation

- Go-live checklist: `GOLIVE.md`
- Cron schedule: `CRON.md`
- Schema: `schema.sql`

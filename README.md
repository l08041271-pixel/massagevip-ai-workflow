# AI Lead Automation — Render Workflow

This project uses Render Workflows to qualify inbound leads and generate a WhatsApp-ready reply.

## Workflow

process_lead
  -> qualify_lead
  -> generate_reply

For batches:

process_leads_parallel
  -> multiple process_lead runs concurrently

## Local install

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

## Render configuration

Create a **New → Workflow** service and connect this repository.

Set:

- Root Directory: `.`
- Build Command: `pip install -r requirements.txt`
- Start Command: `python main.py`

Add environment variables:

- `AI_BASE_URL`
- `AI_API_KEY`
- `AI_MODEL`

Never commit real API keys.

## Example lead input

```json
{
  "name": "Customer",
  "phone": "966XXXXXXXXX",
  "message": "Hi, I want to book a massage today",
  "source": "WhatsApp"
}
```

The workflow returns qualification plus a suggested reply. It does not automatically send messages or confirm bookings.

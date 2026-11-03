# Cloudflare deployment — edge bridge

## Deployment model

This repository's Python service currently uses `http.server.HTTPServer`,
background `threading`, a process-local webhook queue, and `psycopg2`.
Those components are not a drop-in fit for Cloudflare Workers' request/event
runtime. This deployment adds a Cloudflare Worker as an HTTPS edge bridge and
scheduled trigger while the Python origin remains on a compatible host.

This is an incremental deployment, **not a full Python runtime migration**.
Do not remove the current Render/Docker origin until the queue, persistence,
AI workflow, and background processing have been ported and verified.

## Files

- `wrangler.toml`: Worker configuration and five-minute Cron Trigger.
- `cloudflare/worker.js`: routes public endpoints to the Python origin and
  calls its authenticated agent-cycle endpoint on schedule.

## Setup

1. Install Wrangler CLI: `npm install -g wrangler`.
2. Authenticate: `wrangler login`.
3. Set the origin URL as a Worker secret:
   `wrangler secret put ORIGIN_API_BASE`
   Enter the HTTPS base URL of the running Python service, without a trailing
   slash (for example, `https://your-service.example.com`).
4. Set the cron bearer token:
   `wrangler secret put AGENT_CRON_TOKEN`
   This value must exactly match `AGENT_CRON_TOKEN` configured on the Python
   origin. Use a strong randomly generated secret.
5. Deploy from the repository root:
   `wrangler deploy`.
6. Verify the deployed Worker:
   - `GET /health`
   - `GET /metrics`
   - Confirm webhook provider callbacks target the Worker URL and test a signed
     webhook in a staging environment.
7. Check Cloudflare Worker logs and the Python origin logs. Verify that the
   Cron Trigger returns a successful response for `/internal/agent/cycle`.

## Important safeguards

- Keep AI API keys, database credentials, webhook secrets, and cron tokens out
  of source control. Configure them as secrets on the Python origin or Worker
  as appropriate.
- The edge bridge forwards request bodies and signature headers unchanged for
  webhook validation. Signature validation remains the Python origin's job.
- The Worker exposes only `/health`, `/dashboard`, `/metrics`, and
  `/webhook`; other paths return 404.
- Ensure the Python origin is not publicly open to unauthenticated cron calls.
- This Worker does not itself persist events or process the queue. The existing
  Python origin remains responsible for those functions.

## Full migration follow-up

A complete Cloudflare-native design should replace process-local queueing with
Cloudflare Queues, move durable workflow state to D1 or a PostgreSQL database
through Hyperdrive, and migrate the continuously running worker loop into
Queue consumers / scheduled handlers / Durable Objects as appropriate. The
AI provider calls should be made using fetch-compatible APIs. Implement and
test this as a separate migration phase before switching off the Python origin.


## Meta WhatsApp Cloud API configuration

The application supports Meta Cloud API directly. Configure these variables on
the **Python origin** (not in GitHub and not in the public Worker configuration):

- `WHATSAPP_PROVIDER=meta`
- `WHATSAPP_ACCESS_TOKEN` — a production System User access token with the
  required WhatsApp permissions.
- `WHATSAPP_PHONE_NUMBER_ID` — the Phone Number ID shown in Meta WhatsApp
  Manager / App Dashboard.
- `WHATSAPP_VERIFY_TOKEN` — a strong random string you create; enter the
  same value in Meta's webhook configuration.
- `WHATSAPP_APP_SECRET` — the App Secret from Meta App Settings → Basic.
- `WHATSAPP_API_VERSION=v24.0` — override the Graph API version if your Meta
  app is pinned to a different supported version.

The webhook callback URL is the deployed Worker URL followed by `/webhook`,
for example `https://<your-worker>.workers.dev/webhook`. The callback must
be HTTPS. In Meta for Developers, open your app → WhatsApp → Configuration,
set that callback URL and the exact `WHATSAPP_VERIFY_TOKEN`, verify/save,
then subscribe to the `messages` webhook field.

Meta uses two different secrets for two different checks:
- GET subscription verification uses `WHATSAPP_VERIFY_TOKEN` and returns the
  raw `hub.challenge` as plain text.
- POST authenticity uses `WHATSAPP_APP_SECRET` to validate the
  `X-Hub-Signature-256` header against the exact raw request body.

Do not put access tokens, app secrets, or verify tokens in source control,
browser code, screenshots, or chat. Configure them only as encrypted secrets
in the Python hosting environment. After changing environment variables,
restart/redeploy the Python origin before testing.

Before production messaging, confirm the WABA and phone number are active,
the app is subscribed to the WhatsApp Business Account, and the sender has
the required opt-in. Use approved templates for business-initiated messages
outside the customer-service window.

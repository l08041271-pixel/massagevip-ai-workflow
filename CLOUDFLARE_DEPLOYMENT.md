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

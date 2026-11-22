# MassageVIP Codex Engineering Agent

An isolated TypeScript service that embeds the official OpenAI Codex SDK alongside the existing Python WhatsApp automation backend.

## What it does

- Accepts authenticated engineering tasks over HTTP.
- Supports `review` tasks in a read-only filesystem sandbox.
- Supports `implement` tasks with writes restricted to the configured repository workspace.
- Runs one task at a time and returns a task ID immediately.
- Exposes task status and the final Codex response.
- Disables Codex network access for every task.

## Security boundaries

- This service is an MVP, not a production-ready multi-tenant job platform.
- Set a random `AGENT_API_TOKEN` of at least 32 characters.
- Codex CLI authentication must be provisioned securely for the service account before startup.
- Do not put provider keys in source code, browser code, or this repository.
- The agent cannot send WhatsApp messages, call external APIs, deploy, publish, merge pull requests, or modify cloud resources.
- The service does not expose a deploy, shell, or arbitrary command endpoint.
- `review` uses `read-only`; `implement` uses `workspace-write`. Full-access mode is not used.
- Tasks and thread IDs are held in process memory. They are lost on restart; use a durable queue/database before production.
- Put this API behind HTTPS and a trusted reverse proxy. Restrict network ingress to approved operators.

## Requirements

- Node.js 20.6+
- PostgreSQL 14+ and a private `DATABASE_URL`
- Codex CLI available to the service account and authenticated
- A Git repository as the working directory

## Local setup

From this directory:

```bash
cp .env.example .env
# Set AGENT_API_TOKEN to a unique random value in .env
npm install
npm run typecheck
npm run build
npm start
```

When started from `codex-agent/`, the default workspace is the repository root. Override with `AGENT_WORKSPACE` if needed.

## API

Health check (no credentials):

```http
GET /health
```

Submit a task:

```http
POST /v1/tasks
Authorization: Bearer YOUR_AGENT_API_TOKEN
Content-Type: application/json

{
  "mode": "review",
  "prompt": "Review the existing webhook authentication and identify concrete security issues. Do not change files."
}
```

Use `mode: "implement"` only for code changes within the configured workspace.

Poll task status:

```http
GET /v1/tasks/TASK_ID
Authorization: Bearer YOUR_AGENT_API_TOKEN
```

A successful submission returns HTTP 202 and a task ID. Task status is `queued`, `running`, `completed`, or `failed`.

## Production hardening before public exposure

1. Replace in-memory task state with PostgreSQL and a durable queue.
2. Add per-user authorization, rate limits, request tracing and structured audit logs.
3. Add explicit operator approval workflows for external actions and deployment.
4. Add retention controls and redact task inputs/results that may contain personal data.
5. Configure a dedicated least-privilege runtime identity and isolated workspace.
6. Add CI integration, dependency scanning and an authenticated health/metrics strategy.

This service does not claim that GitHub, WhatsApp, Supabase, or deployment integrations are connected.

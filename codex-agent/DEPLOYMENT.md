# Deployment readiness — Codex engineering agent

## Current status

The service builds and typechecks in GitHub Actions. It is **not ready for public deployment** yet. Do not add it to the existing Render production blueprint or expose port 8787 publicly until the blockers below are resolved.

## Why deployment is gated

1. **Codex credentials:** the runtime needs a securely provisioned Codex credential. The TypeScript SDK wraps the Codex CLI; the official SDK documentation describes the CLI integration and `CODEX_API_KEY` environment handling. Store credentials only in the hosting provider's secret manager. Never put them in this repository or a browser client.
2. **Repository workspace:** Codex requires a Git repository as its working directory by default. A production container must receive a dedicated, isolated checkout of this repository. The current Docker image does not clone or mount the repository workspace.
3. **GitHub write-back:** implementation tasks currently change only files in the local workspace. There is no GitHub App integration, branch creation, commit/push, or pull-request publication workflow in this MVP. Do not imply that task changes are automatically saved back to GitHub.
4. **Durability:** task queue and task results are held in process memory. Restarting or redeploying loses them. Add PostgreSQL persistence and a durable worker queue before relying on the service.
5. **Operator controls:** add role-based access, rate limiting, structured audit events, task retention/redaction, and explicit approval records before public exposure.

## Recommended staging target

Use a separate Render staging service, not the existing Python `automation-worker` service. Keep the existing Python WhatsApp service and database configuration unchanged.

Required staging configuration after the blockers are implemented:

- Docker root/context: `codex-agent/`
- Health check: `/health`
- Port: `8787`
- `AGENT_API_TOKEN`: generate a unique random secret (32+ characters) and set it in Render environment secrets.
- `CODEX_API_KEY`: set through Render environment secrets if using API-key authentication.
- `AGENT_WORKSPACE`: a dedicated persistent Git checkout, not the application image's source directory.
- `CODEX_MODEL`: optional; omit to use the configured default.
- Network ingress: restrict to trusted operators or an authenticated private gateway; do not expose an unrestricted agent endpoint.

## Go-live sequence

1. Implement PostgreSQL-backed task state and recoverable queue processing.
2. Implement least-privilege GitHub App access for isolated checkout and controlled branch/PR publication. Never grant broad personal-account tokens.
3. Add a staging-only deployment definition and verify the Codex CLI can authenticate and operate inside the mounted Git workspace.
4. Run authenticated smoke tests for health, task submission, status polling, restart recovery, read-only mode, and workspace-write boundaries.
5. Verify logs do not expose prompts, customer data, credentials, or API keys.
6. Obtain explicit operator approval before enabling any production deployment or external business actions.

## Documentation

- Codex TypeScript SDK: https://github.com/openai/codex/tree/main/sdk/typescript
- Codex SDK documentation: https://learn.chatgpt.com/docs/codex-sdk

This document is a readiness plan, not a claim that Render, Codex credentials, GitHub App permissions, or production deployment are configured.

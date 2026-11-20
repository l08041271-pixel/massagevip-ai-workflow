# Chrome DevTools MCP — MassageVIP Riyadh

## Purpose

Add browser inspection and controlled UI automation as a separate operator tool for the MassageVIP Riyadh platform. This does not replace or modify the existing Python webhook, AI qualification, PostgreSQL, WhatsApp, booking, approval, or analytics services.

## Hybrid architecture

```
Operator workstation / approved browser host
  └── MCP client
       └── Chrome DevTools MCP (Node.js, stdio)
            └── Dedicated Chrome profile
                 └── MassageVIP web dashboard / approved admin pages
                       └── Existing HTTPS application endpoints
                            └── Python automation service
                                 ├── PostgreSQL / CRM
                                 ├── WhatsApp provider
                                 └── booking, approvals, analytics
```

The MCP server should run on the same trusted host as the browser it controls. The Render-hosted Python service remains the cloud business backend. Do not expose Chrome's remote-debugging port or the MCP stdio process as a public service.

## Existing-state preservation

- Existing application services, environment variables, database schema, webhook routes, and Render deployment settings remain unchanged.
- The integration is additive: `.mcp.json` plus this document.
- No production credentials or customer data belong in this repository.
- No Render deploy, database migration, WhatsApp send, CRM mutation, or browser login is performed by adding this configuration.

## MCP client configuration

This repository includes a project-level `.mcp.json` for clients that support the Claude Code MCP configuration format. It pins the Chrome DevTools MCP package to 1.13.0 and disables usage statistics.

For another MCP client, copy the `mcpServers.chrome-devtools` entry into that client's MCP configuration format. The command requires Node.js 20.19+ (or a supported newer version), npm/npx, and a supported Chrome stable installation on the host.

## Browser profile and access controls

1. Use a dedicated Chrome profile for MassageVIP administration and testing; do not attach a personal everyday browsing profile.
2. Sign in manually and only to the specific test/admin account needed.
3. Close unrelated tabs before starting the MCP session. Browser page content and open tabs are available to the MCP client.
4. Keep browser automation read-only by default: inspect pages, capture diagnostics, review network requests, and verify UI state.
5. Require a separate human approval immediately before any action that sends a WhatsApp message, changes a lead/booking, updates campaign settings, submits a form, or otherwise changes production state.
6. Never put API keys, cookies, access tokens, session exports, or customer PII into prompts, logs, screenshots, commits, or issue comments.
7. Do not enable a public remote-debugging endpoint. If remote debugging is deliberately used for a separate setup, bind it to loopback and use a dedicated non-default Chrome user-data directory.

## Recommended rollout

### Phase 1 — Local MCP handshake
- Install Node.js and Chrome on the trusted browser host.
- Start the MCP client from this repository so it loads `.mcp.json`.
- Confirm the client lists Chrome DevTools tools and can open a harmless public test page.
- Confirm browser diagnostics work without using a production login.

### Phase 2 — MassageVIP staging verification
- Point the dedicated browser profile at a staging or test instance first.
- Verify page navigation, DOM inspection, screenshots, console, and network diagnostics.
- Verify that the existing backend's `/health`, `/dashboard`, and `/metrics` endpoints remain owned by the Python service.
- Use synthetic lead records only.

### Phase 3 — Controlled production read-only
- Only after staging passes, use a dedicated production admin profile for read-only inspection.
- Do not automate message sending, booking confirmation, campaign changes, or customer-record edits without a separate action-specific approval.

## Verification checklist

- [ ] Node.js version meets the package engine requirement.
- [ ] Chrome stable is installed on the MCP host.
- [ ] MCP client loads the project configuration.
- [ ] Chrome DevTools MCP server starts and advertises tools.
- [ ] Harmless public-page smoke test passes.
- [ ] MassageVIP staging read-only smoke test passes.
- [ ] Existing Render service and database configuration are unchanged.
- [ ] No secrets or customer data are written to repository files or logs.

## Important limitation

A repository configuration file does not install software on a phone or workstation and does not automatically connect ChatGPT's Android app to a local Chrome process. The MCP client and Chrome must run on a supported host that can launch or reach the browser. The cloud backend and local browser-control host are separate components.

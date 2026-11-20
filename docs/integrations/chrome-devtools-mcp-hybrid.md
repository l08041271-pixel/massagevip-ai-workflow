# Chrome DevTools MCP — MassageVIP Riyadh hybrid integration

Status: prepared on an isolated feature branch; not deployed or connected to a live browser.

## Scope

Add Chrome DevTools MCP as a browser diagnostics and automation capability for the MassageVIP Riyadh workflow. Keep the upstream Chrome DevTools MCP implementation unchanged. Keep the existing WhatsApp webhook, lead processing, booking, approval, CRM and analytics paths unchanged.

## Discovery evidence (2026-11-20)

- The Chrome DevTools MCP fork is based on the upstream ChromeDevTools project and declares package version 1.13.0.
- The server is an MCP stdio process. It launches Chrome itself by default or connects to a running Chrome instance using `--wsEndpoint`, `--browserUrl` or `--autoConnect`.
- Its Android guide describes USB debugging plus `adb forward tcp:9222 localabstract:chrome_devtools_remote`; the Android target support is explicitly experimental.
- The Android guide's example uses `--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/`.
- Chrome DevTools MCP can inspect and modify browser data. Use a dedicated browser profile and do not expose remote-debugging port 9222 to the public internet.
- The MassageVIP automation repository has existing Render services named `automation-worker` and `massagevip-control-plane`; the current Render workspace listing did not return a Render Postgres instance.
- Existing Cloudflare Workers include `lead-monitor` and `whatsapp-to-sheets`. No new Worker or route is required for the first local MCP integration.
- The application repository has no existing Chrome DevTools MCP integration reference or config file.
- Targenix's MCP endpoint previously returned 401 without an Authorization header. Its authenticated tool catalog has not been verified. Pluno extension tools also remain unverified in the user's Chrome session.

## Target topology

```text
Galaxy A34 / Android Chrome
        |
        | USB debugging + ADB forward (experimental)
        v
Trusted local MCP host (Node.js LTS)
        |
        +-- Chrome DevTools MCP (stdio)
        |      +-- browser inspection / screenshots
        |      +-- console / network diagnostics
        |      +-- performance diagnostics
        |      +-- optional extension / third-party tool discovery
        |
        +-- Existing local MCP host / ChatGPT integration
               |
               | authenticated HTTPS only; never expose CDP :9222
               v
Cloud business systems (existing)
        +-- Render automation-worker
        +-- Render massagevip-control-plane
        +-- Cloudflare lead-monitor
        +-- Cloudflare whatsapp-to-sheets
```

The MCP stdio server should run on a trusted host that can reach the Chrome DevTools endpoint. ADB forwarding is normally established from a computer connected to the phone; it does not magically make the phone's Chrome socket reachable from a remote Render or Cloudflare runtime. If the only available host is the phone, first prove that the local MCP host can reach the Android Chrome DevTools socket before selecting that deployment model.

## Installation configuration — example only

For a trusted host with its own installed Chrome, register this MCP server in the host's MCP configuration:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@1.13.0",
        "--no-usage-statistics",
        "--no-performance-crux",
        "--categoryExtensions",
        "--categoryExperimentalThirdParty"
      ]
    }
  }
}
```

For a trusted host connected to Android Chrome through ADB, use the same configuration but replace the arguments with:

```json
[
  "-y",
  "chrome-devtools-mcp@1.13.0",
  "--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/",
  "--no-usage-statistics",
  "--no-performance-crux",
  "--categoryExtensions",
  "--categoryExperimentalThirdParty"
]
```

Android connection sequence (only after a trusted computer and USB cable are available):

1. Enable Android Developer Options and USB debugging.
2. Connect the Galaxy A34 to the trusted computer and authorize that computer on the phone.
3. Confirm the target Chrome instance is available through Android remote debugging.
4. Run `adb forward tcp:9222 localabstract:chrome_devtools_remote` on the trusted computer.
5. Start Chrome DevTools MCP with the Android-specific configuration.
6. Verify page discovery using the read-only `list_pages` tool. Do not navigate, fill, click or submit anything during the first smoke test.

The Android workflow is experimental; verify compatibility with the exact Chrome build before relying on it.

## Pluno and Targenix

- Enable extension discovery only when the Pluno extension is installed in the selected Chrome profile. Inspect extension metadata and tool names first.
- The experimental third-party developer tools category can expose tools published by a page through supported discovery mechanisms. It does not guarantee access to Pluno's private extension registry.
- Do not assume `globalThis.__PLUNO_WEBMCP_TOOLS__` is available to a page context. Inspect it only in the correct extension/browser execution context and do not print tokens, cookies or personal data.
- Targenix remains a separate authenticated MCP server. Complete its OAuth connection independently and inspect the actual tool list and granted scopes before enabling business actions.
- Do not copy Targenix credentials, OAuth tokens, cookies or browser storage into this repository, Render environment variables, Cloudflare Worker source or logs.

## Approval and security controls

- Default to read-only browser inspection.
- Require an explicit per-action approval before form submission, message sending, booking changes, CRM writes, campaign changes, downloads or file uploads.
- Use a dedicated Chrome profile with only the required business sessions.
- Never browse banking, personal email, password managers or unrelated private accounts in a profile controlled by MCP.
- Keep CDP port 9222 bound to loopback/ADB forwarding. Never publish it through a public tunnel, Cloudflare Worker route or unauthenticated proxy.
- If remote MCP access is required, expose only a separately authenticated MCP gateway over HTTPS; do not expose the raw Chrome DevTools Protocol endpoint.
- Redact authorization headers, cookies, phone numbers and message bodies from logs.
- Keep the existing WhatsApp webhook and production service configuration untouched.

## Verification checklist

- [ ] Confirm Node.js meets the package requirement: Node 20.19+, 22.12+ or 23+.
- [ ] Confirm Chrome stable is installed on the MCP host, or confirm the Android ADB target is reachable.
- [ ] Confirm the MCP client starts the server without changing existing MCP entries.
- [ ] Confirm `list_pages` returns only the intended dedicated Chrome profile.
- [ ] Confirm console and network inspection work on a non-sensitive test page.
- [ ] Confirm Pluno extension discovery is present and does not expose secrets.
- [ ] Complete Targenix OAuth separately and verify its real tool catalog.
- [ ] Run a non-mutating MassageVIP website smoke test.
- [ ] Verify no existing Render deploy, Cloudflare Worker, WhatsApp webhook, CRM record or campaign was changed.

## Current blockers

1. No authenticated view of the user's physical Galaxy A34, installed local MCP host app, or its MCP configuration is available in this session.
2. No trusted computer/ADB host is confirmed for the Android Chrome remote-debugging bridge.
3. No Chrome DevTools MCP process has been installed or started on the user's device or a host.
4. Pluno's extension registry and Targenix's authenticated MCP tools are not yet visible.
5. Render has no Postgres instance in the workspace listing; do not assume a Render database is available.

## Rollout rule

This file is a preparation artifact, not a deployment. Do not merge this branch, deploy a service, open a remote-debugging port, connect an authenticated business browser, or enable write-capable automation until the host and browser path are verified.

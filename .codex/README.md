# Simular Box MCP for Codex

This project includes a project-scoped Codex MCP entry at `.codex/config.toml`.

## Configure the credential locally

1. Rotate/revoke the Simular Box token that was previously shared in chat. Do not reuse it.
2. Set the replacement token in the environment used to launch Codex:

   ```bash
   export SIMULAR_BOX_TOKEN='YOUR_NEW_SIMULAR_BEARER_TOKEN'
   ```

3. Start Codex from this repository's root directory. Trust the project if Codex asks.
4. Verify the server appears with:

   ```bash
   codex mcp list
   ```

   In the Codex TUI, use `/mcp` to inspect available MCP servers.

## Security

- Never commit the bearer token, `~/.codex/config.toml`, shell history containing secrets, or local `.env` files.
- The project config stores only the MCP URL and the environment-variable name.
- This configuration does not prove the MCP server is reachable or authenticated; verify from the Codex host.
- Treat the shared Simular Box viewer link as read-only. Only perform changes in the cloud desktop when explicitly authorized.

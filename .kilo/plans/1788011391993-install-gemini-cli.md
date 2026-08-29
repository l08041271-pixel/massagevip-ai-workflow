# Install Gemini CLI

## Goal
Install `@google/gemini-cli` globally in this environment so the `gemini` command is available for headless and interactive use.

## Current state
- Node.js v22.22.3 and npm 10.9.8 are available.
- No `gemini` binary is currently present in PATH.

## Steps
1. Install `@google/gemini-cli` globally via npm.
2. Verify the installation with `gemini --version`.
3. Check that `gemini` is in PATH.

## Constraints / Notes
- Global npm install may require write access to the global `node_modules` directory.
- If `npm install -g` fails due to permissions, retry with a user-local prefix:
  - `mkdir -p ~/.npm-global`
  - `npm config set prefix ~/.npm-global`
  - Add `~/.npm-global/bin` to PATH
  - Re-run install
- Authentication is not configured here; installation is independent of API keys.

## Validation
- `gemini --version` returns a version string.
- `which gemini` returns a valid path.

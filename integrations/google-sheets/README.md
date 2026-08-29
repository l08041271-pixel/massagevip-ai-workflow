# Google Sheets Integration (Bots.Business / BJS)

A production-ready Google Sheets API v4 integration for the Bots.Business
platform. It covers authentication, read/write, batch operations, command
synchronization with version control, CSV import with validation, and automated
backups — all built on the BJS `HTTP` runtime primitive already used across this
repository (see `code/crm-integration.js`).

## Modules

| File | Purpose |
|------|---------|
| `config.js` | Environment-based configuration, credentials, rate limiting, feature flags |
| `main.js` | Core Sheets API v4 client (auth, read/write, batch, retry) |
| `command-sync.js` | Sync bot commands from a sheet, with change detection + rollback |
| `csv-import.js` | Parse/validate/transform CSV (text or sheet), dedup, progress, errors |
| `backup.js` | Scheduled full/incremental backups, restore, retention, verification |

## Quick start

```js
const { createSheetsClient } = require('./main');

const sheets = createSheetsClient({
  auth: {
    mode: 'refreshToken',
    clientId: Bot.getProperty('SHEETS_CLIENT_ID'),
    clientSecret: Bot.getProperty('SHEETS_CLIENT_SECRET'),
    refreshToken: Bot.getProperty('SHEETS_REFRESH_TOKEN')
  },
  defaultSpreadsheetId: 'YOUR_SPREADSHEET_ID'
});

(async () => {
  // Read
  const rows = await sheets.getValues('Sheet1!A1:D10');
  // Append
  await sheets.appendValues('Sheet1!A1', [['hello', 'world']]);
})();
```

## Setup

### 1. Create Google Cloud credentials

1. In the [Google Cloud Console](https://console.cloud.google.com), create a
   project (or pick an existing one).
2. Enable the **Google Sheets API**.
3. Choose an auth method:
   - **OAuth client + refresh token** (recommended for most bots): create an
     OAuth 2.0 client ID, authorize the `https://www.googleapis.com/auth/spreadsheets`
     scope, and capture the refresh token.
   - **Service account**: create a service account, download the JSON key, and
     share the target spreadsheet with the service account email. Requires a
     `crypto` module in the runtime for JWT signing; otherwise use the
     refresh-token flow.
   - **API key**: read-only, and only for sheets shared publicly.

### 2. Configure the bot

Store credentials safely (do **not** hard-code secrets in source):

```js
Bot.setProperty('SHEETS_CLIENT_ID', '...', 'string');
Bot.setProperty('SHEETS_CLIENT_SECRET', '...', 'string');
Bot.setProperty('SHEETS_REFRESH_TOKEN', '...', 'string');
Bot.setProperty('SHEETS_SPREADSHEET_ID', '...', 'string');
```

Or expose them via environment variables (`SHEETS_CLIENT_ID`, …) which the
config layer also reads.

### 3. Share the spreadsheet

For OAuth/service-account auth, the bot's identity must have **Editor** (write)
or **Viewer** (read) access to the spreadsheet.

## Authentication

`auth.mode` controls the strategy:

| Mode | Required fields | Notes |
|------|-----------------|-------|
| `apiKey` | `apiKey` | Read-only; public sheets only |
| `oauth` | `accessToken` | Short-lived token, no refresh |
| `refreshToken` | `clientId`, `clientSecret`, `refreshToken` | Auto-refreshes before expiry |
| `serviceAccount` | `serviceAccount { client_email, private_key, scopes }` | JWT bearer grant (needs `crypto`) |

Access tokens are cached in-memory and refreshed ~5s before expiry, so you do
not pay the token cost on every request.

## API reference — `main.js`

Created via `createSheetsClient(userConfig)`.

### `getValues(range, opts)` → `Promise<Array<Array<string>>>`
Reads a range (A1 notation). `opts.spreadsheetId` overrides the default.

### `batchGetValues(ranges[], opts)` → `Promise<Array<Array<string>>>`
Batch read of multiple ranges in one call.

### `appendValues(range, values, opts)` → `Promise<Object>`
Appends rows. `opts.valueInputOption` defaults to `USER_ENTERED`.

### `updateValues(range, values, opts)` → `Promise<Object>`
Overwrites a range.

### `clearValues(range, opts)` → `Promise<Object>`
Clears values while preserving formatting.

### `batchUpdate(operations[], opts)` → `Promise<Object>`
Bulk writes. `operations: [{ range, values, majorDimension? }]`. Honors the
`features.batchEnabled` flag (falls back to sequential writes when disabled).

### `getSpreadsheet(opts)` → `Promise<Object>`
Spreadsheet metadata (sheets, properties).

All methods throw typed errors: `SheetsError`, `SheetsAuthError`,
`SheetsValidationError`, `SheetsNotFoundError`, `SheetsRateLimitError` — each
carrying a stable `code` and `meta`.

## Resilience

- **Retries**: exponential backoff with jitter on 408/429/500/502/503/504 and
  network errors (`config.retry`).
- **Rate limiting**: client-side token bucket (`config.rateLimit`) to stay under
  Sheets quota (~60 reads/min/project).
- **Validation**: values must be a 2D array of primitives; invalid input throws
  `SheetsValidationError` before any network call.

## Command sync — `command-sync.js`

Expected sheet layout (`Commands!A1:F`):

| command | response | description | enabled | tags | updated_at |
|---------|----------|-------------|---------|------|------------|
| /start  | Welcome! | Greeting    | TRUE    | core | 2026-01-01 |
| /help   | See docs | Help text   | TRUE    | core | 2026-01-01 |

```js
const { createCommandSync } = require('./command-sync');

const sync = createCommandSync({
  client: sheets,
  range: 'Commands!A1:F',
  versionBackend: 'property' // or 'memory'
});

const result = await sync.sync();
// { changed, version, count, added:[], updated:[], removed:[], commands:[] }

// Poll for changes cheaply:
const watch = await sync.watch(); // { changed, version, diff }

// Roll back to a previous version:
await sync.rollback(result.version);
```

- **Change detection**: a content hash (`computeVersionHash`) detects edits
  without re-applying every command.
- **Version control**: each successful sync stores an immutable snapshot.
- **Rollback**: overwrites the command range with a stored snapshot and
  re-syncs.

## CSV import — `csv-import.js`

```js
const { createCsvImporter } = require('./csv-import');

const importer = createCsvImporter({ client: sheets });

const summary = await importer.importFromSheet({
  range: 'Leads!A1:D',
  schema: [
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'email', required: true, unique: true },
    { name: 'score', type: 'number', default: 0 },
    { name: 'subscribed', type: 'boolean', default: false }
  ],
  options: {
    mode: 'upsert',              // 'insert' | 'upsert'
    dedupeKeys: ['email'],
    onProgress: (p) => Bot.sendMessage('Import ' + p.percent + '%'),
    onRow: (r) => { /* side effects */ }
  }
});
```

`importFromText(csvString, params)` parses raw CSV (with quoting, embedded
delimiters and newlines). The summary reports `inserted`, `updated`, `skipped`,
`errors` (with row numbers) and detected `duplicates`. Import failures are
recorded per-row and never abort the whole run.

## Backup — `backup.js`

```js
const { createBackupManager } = require('./backup');

const backups = createBackupManager({
  client: sheets,
  sourceRange: 'Data!A:Z',
  backupRange: 'Backups!A:F',   // where snapshots are stored
  retention: { maxCount: 30, maxAgeMs: 30 * 864e5, incremental: true }
});

await backups.createBackup({ label: 'nightly' });
const list = await backups.listBackups();
await backups.restoreBackup(list[0].id);
await backups.verifyBackup(list[0].id, { reconcile: true });
await backups.purgeOldBackups();

const handle = backups.startScheduler({ intervalMs: 3600 * 1000 });
// handle.stop()
```

- **Incremental**: when the source hash is unchanged, backups are skipped.
- **Restore**: rewrites the source range and re-verifies by default.
- **Retention**: caps by count and age.
- **Verification**: recomputes the payload hash; `reconcile: true` also compares
  against the live source.

## Configuration reference — `config.js`

`loadConfig(overrides)` merges `defaults < stored properties < overrides`. Key
fields:

- `auth` — credential strategy (see above).
- `retry` — `{ maxAttempts, baseDelayMs, maxDelayMs, backoffFactor, jitter, retryableStatuses }`.
- `rateLimit` — `{ enabled, maxTokens, windowMs, burst }`.
- `request` — `{ timeoutMs, valueInputOption, insertDataOption }`.
- `features` — `{ batchEnabled, incrementalBackup, validateOnRead, cacheEnabled, deadLetterQueue }`.
- `logging` — `{ level, prefix }` (`debug|info|warn|error|silent`).

## Security considerations

- Never commit secrets. Use `Bot.setProperty` or environment variables.
- Prefer **Editor** access scoped to a single service-account identity; avoid
  broad API keys.
- Refresh tokens are long-lived — store them like passwords and rotate regularly.
- Backups may contain PII; restrict the `Backups` sheet's sharing and apply
  retention so old data is purged.
- All user-supplied values written to sheets should be validated (see CSV
  schema / `SheetsValidationError`) to avoid injection of formulas — prefix
  untrusted strings with a single quote (`'`) if they may start with `=`, `+`,
  `-`, or `@`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `AUTH_ERROR` 401/403 | Wrong/expired credentials or no sheet access | Re-share sheet with the bot identity; refresh token |
| `RATE_LIMITED` 429 | Too many requests | Lower `rateLimit.maxTokens`; enable batch ops |
| `NOT_FOUND` 404 | Bad spreadsheetId / range | Verify A1 notation and that the sheet exists |
| `VALIDATION_ERROR` | Non-primitive cell or bad schema | Ensure values are strings/numbers/booleans |
| Empty reads with `apiKey` | Private sheet | Use OAuth/service-account instead of API key |
| JWT sign fails | No `crypto` module | Switch `auth.mode` to `refreshToken` |

## Testing

These modules are plain CommonJS and can be unit-tested under Node by mocking
the global `HTTP` (and optionally `Bot`):

```js
global.HTTP = { get: () => ({ values: [['a','b']] }), post: () => ({}) };
const { createSheetsClient } = require('./main');
```

# YCloud WhatsApp integration (initial server-side adapter)

## Scope and safety status

This branch adds a separate YCloud provider and receiver. It does not replace the existing Meta or WAHA providers. No live YCloud API calls, credential reads, webhook endpoint changes, message sends, or deployments were performed.

The receiver verifies YCloud's timestamped HMAC-SHA256 signature over the exact raw request bytes, checks the trusted endpoint ID, and commits the event to PostgreSQL before returning 2xx. The 300-second timestamp tolerance is an application default, not a YCloud guarantee. Duplicate events are identified by (endpoint ID, event ID); reused IDs with different payload hashes are recorded as conflicts.

**Inbound business mapping is intentionally not enabled yet.** The receiver stores the verified common event envelope. It does not infer event-specific phone/message fields, update the CRM, or trigger AI qualification. Add that mapping only from the selected official payload reference and cover it with fixtures before routing events into the business pipeline.

## Render environment

Set these values as server-side environment variables (never commit secret values):

- `WHATSAPP_PROVIDER=ycloud` — selects YCloud for outbound provider calls.
- `YCLOUD_API_BASE_URL` — exact API base URL confirmed from current YCloud documentation/account.
- `YCLOUD_API_KEY` — YCloud API key; sent only in the `X-API-Key` header.
- `YCLOUD_FROM` — sender phone number in E.164 format, e.g. `+9665XXXXXXXX`.
- `YCLOUD_WEBHOOK_SECRET` — secret for the configured YCloud webhook endpoint.
- `YCLOUD_WEBHOOK_ENDPOINT_ID` — endpoint ID bound to this receiver.
- `YCLOUD_WEBHOOK_TOLERANCE_SECONDS=300` — configurable local timestamp tolerance.

Do not set `WHATSAPP_PROVIDER=ycloud` until the sender, API base URL, credentials, and webhook are configured. Keep existing Meta/WAHA settings separate.

## Database migration

For an existing database, apply `migrations/001_ycloud_webhook_inbox.sql` before registering the webhook. The same table definition is included in `schema.sql` for fresh installations.

## Webhook registration

Configure the YCloud callback URL as:

`https://<your-public-host>/webhooks/ycloud`

The receiver requires both `YCloud-Signature` and `X-Webhook-Endpoint-ID`. The endpoint ID is matched against `YCLOUD_WEBHOOK_ENDPOINT_ID`; the request header never chooses a tenant or secret.

## Outbound text policy

The adapter uses `POST /whatsapp/messages/sendDirectly` with the YCloud `X-API-Key` header. It reports HTTP acceptance separately from final delivery and does not blindly retry a send after a timeout or lost response.

Free-form text is blocked unless the caller supplies `customer_service_window_open=True`. The current inbound receiver does not yet populate that per-recipient fact, so automated YCloud free-form replies remain blocked until an event-specific mapping and persisted 24-hour customer-service-window check are implemented. Approved template sending is not included in this first slice.

## Evidence and remaining work

- Added no-network tests for signature validity, tampering, wrong secrets, stale/future timestamps, malformed headers, endpoint mismatch, durable-acceptance boundary, request construction, and service-window guard.
- Apply migration and configure credentials manually.
- Run CI on the feature branch and review the pull request.
- Implement event-specific inbound mapping and delivery-status projection from current official YCloud examples.
- Add a durable inbox consumer/recovery worker before claiming end-to-end automated lead processing.
- A live smoke test and production deployment require separate explicit authorization.

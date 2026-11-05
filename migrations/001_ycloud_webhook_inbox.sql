-- Apply once to an existing PostgreSQL database before enabling YCloud webhooks.
CREATE TABLE IF NOT EXISTS ycloud_webhook_inbox (
    endpoint_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    conflict_count INT NOT NULL DEFAULT 0,
    last_conflict_hash CHAR(64),
    conflict_detected_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (endpoint_id, event_id)
);
CREATE INDEX IF NOT EXISTS idx_ycloud_inbox_received ON ycloud_webhook_inbox(received_at);
CREATE INDEX IF NOT EXISTS idx_ycloud_inbox_type ON ycloud_webhook_inbox(event_type);

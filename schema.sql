-- PostgreSQL schema for MassageVIP Automation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    handle TEXT,
    phone TEXT,
    source TEXT,
    opt_out BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE conversations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    contact_id TEXT REFERENCES contacts(id),
    source TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE event_store (
    event_id TEXT PRIMARY KEY,
    source TEXT,
    event_type TEXT,
    timestamp TIMESTAMPTZ,
    payload JSONB,
    dedupe_key TEXT UNIQUE,
    processed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE events (
    event_id TEXT PRIMARY KEY REFERENCES event_store(event_id),
    priority TEXT,
    lead_score INT,
    intent TEXT,
    sentiment TEXT,
    recommended_action TEXT,
    confidence FLOAT DEFAULT 0.0,
    human_handoff BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE outcomes (
    event_id TEXT REFERENCES events(event_id),
    predicted_score INT,
    actual_booked BOOLEAN,
    revenue NUMERIC,
    response_time_sec INT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE drafts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    event_id TEXT REFERENCES events(event_id),
    channel TEXT,
    reply TEXT,
    needs_approval BOOLEAN DEFAULT true,
    approved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE ai_memory (
    id SERIAL PRIMARY KEY,
    insight TEXT,
    pattern JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE dead_letter_queue (
    id SERIAL PRIMARY KEY,
    event_id TEXT,
    reason TEXT,
    payload JSONB,
    retry_count INT DEFAULT 0,
    resolved BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    event_id TEXT,
    decision TEXT,
    inputs JSONB,
    outputs JSONB,
    metadata JSONB,
    timestamp TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE bookings (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(event_id),
    customer_phone TEXT,
    service TEXT,
    status TEXT,
    missing_info JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE follow_ups (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(event_id),
    action TEXT,
    scheduled_at TIMESTAMPTZ,
    execute_at TIMESTAMPTZ,
    status TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(event_id),
    action TEXT,
    payload JSONB,
    status TEXT DEFAULT 'pending',
    approver TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE metrics (
    id SERIAL PRIMARY KEY,
    metric_name TEXT,
    metric_value NUMERIC,
    tags JSONB,
    timestamp TIMESTAMPTZ DEFAULT now()
);

-- Analytics materialized view
CREATE OR REPLACE VIEW daily_metrics AS
SELECT date_trunc('day', timestamp) as day, source,
    count(*) as total,
    count(*) FILTER (WHERE priority IN ('P0','P1')) as hot,
    avg(lead_score)::int as avg_score
FROM event_store JOIN events USING(event_id)
GROUP BY 1,2;

-- Indexes for performance
CREATE INDEX idx_event_store_dedupe ON event_store(dedupe_key);
CREATE INDEX idx_event_store_processed ON event_store(processed);
CREATE INDEX idx_events_intent ON events(intent);
CREATE INDEX idx_events_priority ON events(priority);
CREATE INDEX idx_dead_letter_unresolved ON dead_letter_queue(resolved) WHERE resolved = false;
CREATE INDEX idx_audit_event_id ON audit_log(event_id);
CREATE INDEX idx_bookings_event_id ON bookings(event_id);
CREATE INDEX idx_follow_ups_event_id ON follow_ups(event_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_metrics_timestamp ON metrics(timestamp);

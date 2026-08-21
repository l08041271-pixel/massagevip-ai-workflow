-- PostgreSQL schema for Control Plane
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE contacts (id TEXT PRIMARY KEY, handle TEXT, phone TEXT, source TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE conversations (id TEXT PRIMARY KEY, contact_id TEXT REFERENCES contacts(id), source TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE event_store (
  event_id TEXT PRIMARY KEY,
  source TEXT, event_type TEXT, timestamp TIMESTAMPTZ,
  payload JSONB, dedupe_key TEXT UNIQUE, processed BOOLEAN DEFAULT false
);
CREATE TABLE events (
  event_id TEXT PRIMARY KEY REFERENCES event_store(event_id),
  priority TEXT, lead_score INT, intent TEXT, sentiment TEXT, recommended_action TEXT
);
CREATE TABLE outcomes (
  event_id TEXT REFERENCES events(event_id),
  predicted_score INT, actual_booked BOOLEAN, revenue NUMERIC, response_time_sec INT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE drafts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_id TEXT REFERENCES events(event_id),
  channel TEXT, reply TEXT, needs_approval BOOLEAN DEFAULT true, approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE ai_memory (id SERIAL PRIMARY KEY, insight TEXT, pattern JSONB, created_at TIMESTAMPTZ DEFAULT now());

-- Analytics materialized view
CREATE OR REPLACE VIEW daily_metrics AS
SELECT date_trunc('day', timestamp) as day, source,
  count(*) as total, count(*) FILTER (WHERE priority IN ('P0','P1')) as hot,
  avg(lead_score)::int as avg_score from event_store JOIN events USING(event_id) GROUP BY 1,2;

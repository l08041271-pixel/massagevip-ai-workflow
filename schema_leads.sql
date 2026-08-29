-- Lead capture schema for MassageVIP Automation (WhatsApp clicks, Typeform, funnel)
-- Composable migration applied on top of schema.sql; pgcrypto already enabled.

CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    phone TEXT,
    email TEXT,
    name TEXT,
    source TEXT,
    campaign TEXT,
    landing_page TEXT,
    status TEXT NOT NULL DEFAULT 'NEW',
    score INT DEFAULT 0,
    notes TEXT,
    duplicate_of TEXT REFERENCES leads(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_clicks (
    id BIGSERIAL PRIMARY KEY,
    click_id TEXT UNIQUE,
    source TEXT,
    campaign TEXT,
    landing_page TEXT,
    referrer TEXT,
    device TEXT,
    user_agent TEXT,
    ip TEXT,
    lead_id TEXT REFERENCES leads(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- lead_status CHECK constraint (idempotent via DO block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'lead_status' AND conrelid = 'leads'::regclass
    ) THEN
        ALTER TABLE leads ADD CONSTRAINT lead_status
            CHECK (status IN ('NEW','CONTACTED','QUALIFIED','BOOKED','COMPLETED','LOST'));
    END IF;
END$$;

-- Partial unique indexes for dedup
CREATE INDEX IF NOT EXISTS idx_leads_phone_unique ON leads(phone) WHERE phone IS NOT NULL AND phone <> '';
CREATE INDEX IF NOT EXISTS idx_leads_email_unique ON leads(email) WHERE email IS NOT NULL AND email <> '';

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_clicks_created ON whatsapp_clicks(created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_clicks_source ON whatsapp_clicks(source);

-- Daily lead funnel view for dashboard
CREATE OR REPLACE VIEW lead_funnel_daily AS
SELECT
    date_trunc('day', created_at) AS day,
    status,
    count(*) AS count
FROM leads
GROUP BY 1, 2;

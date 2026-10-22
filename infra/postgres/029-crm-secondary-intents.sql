ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS secondary_intent_keys jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_tenant_dedupe_key_idx
  ON crm_leads (tenant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

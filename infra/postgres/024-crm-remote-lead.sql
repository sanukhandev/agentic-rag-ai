ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lead_id text;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS remote_crm text;

CREATE INDEX IF NOT EXISTS crm_leads_remote_crm_idx
  ON crm_leads (tenant_id, remote_crm, lead_id)
  WHERE remote_crm IS NOT NULL AND lead_id IS NOT NULL;

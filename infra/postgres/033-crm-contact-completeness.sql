ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS contact_completeness_score integer NOT NULL DEFAULT 0;

ALTER TABLE crm_leads
  DROP CONSTRAINT IF EXISTS crm_leads_contact_completeness_score_check;

ALTER TABLE crm_leads
  ADD CONSTRAINT crm_leads_contact_completeness_score_check CHECK (contact_completeness_score BETWEEN 0 AND 100);

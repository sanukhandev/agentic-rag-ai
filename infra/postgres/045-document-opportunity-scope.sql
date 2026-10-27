ALTER TABLE supporting_documents ADD COLUMN IF NOT EXISTS opportunity_id uuid;
CREATE INDEX IF NOT EXISTS supporting_documents_opportunity_idx ON supporting_documents(tenant_id, session_id, opportunity_id, requirement_key);

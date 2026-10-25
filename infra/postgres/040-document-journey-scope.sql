ALTER TABLE supporting_documents
  ADD COLUMN IF NOT EXISTS intent_key text,
  ADD COLUMN IF NOT EXISTS catalog_version_id uuid;

CREATE INDEX IF NOT EXISTS supporting_documents_journey_scope_idx
  ON supporting_documents (tenant_id, session_id, catalog_version_id, intent_key, requirement_key, status);

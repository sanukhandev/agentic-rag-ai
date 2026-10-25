ALTER TABLE supporting_documents
  ADD COLUMN IF NOT EXISTS requirement_key text,
  ADD COLUMN IF NOT EXISTS expected_document_type text;

CREATE INDEX IF NOT EXISTS supporting_documents_requirement_idx
  ON supporting_documents (tenant_id, session_id, requirement_key, status);

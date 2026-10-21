CREATE TABLE IF NOT EXISTS supporting_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm_leads(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 15728640),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('uploaded','queued','processing','completed','failed','reconciliation')),
  workflow_key text NOT NULL,
  extracted_text text,
  summary text,
  error_code text,
  consent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256, session_id)
);

CREATE INDEX IF NOT EXISTS supporting_documents_tenant_idx ON supporting_documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS supporting_documents_lead_idx ON supporting_documents (lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_processing_jobs (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL UNIQUE REFERENCES supporting_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_key text NOT NULL,
  webhook_path text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','processing','completed','failed','reconciliation')),
  attempts integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  execution_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_processing_jobs_claim_idx ON document_processing_jobs (status, created_at, id);

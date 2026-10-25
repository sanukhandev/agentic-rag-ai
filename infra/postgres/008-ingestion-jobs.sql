CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  mime_type text NOT NULL,
  source_url text,
  audience text NOT NULL CHECK (audience IN ('public', 'internal')),
  source_id uuid REFERENCES knowledge_sources(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code text,
  error_detail text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingestion_jobs_tenant_created_idx ON ingestion_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_jobs_claim_idx ON ingestion_jobs (status, lease_expires_at);

ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS audience text;
ALTER TABLE ingestion_jobs ADD COLUMN IF NOT EXISTS error_detail text;

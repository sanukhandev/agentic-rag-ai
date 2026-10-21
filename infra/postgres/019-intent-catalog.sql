CREATE TABLE IF NOT EXISTS intent_catalog_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  source_file_name text NOT NULL,
  source_hash text NOT NULL,
  parser_version text NOT NULL,
  catalog_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, version),
  UNIQUE (tenant_id, source_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS intent_catalog_one_published_idx
  ON intent_catalog_versions (tenant_id) WHERE status = 'published';

ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS webhook_path text NOT NULL DEFAULT 'lead-capture';
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS intent_key text NOT NULL DEFAULT 'lead.capture';
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS intent_score integer NOT NULL DEFAULT 0 CHECK (intent_score BETWEEN 0 AND 100);
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS intent_confidence numeric NOT NULL DEFAULT 0 CHECK (intent_confidence BETWEEN 0 AND 1);
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS catalog_version_id uuid REFERENCES intent_catalog_versions(id) ON DELETE SET NULL;

ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS intent_score integer NOT NULL DEFAULT 0 CHECK (intent_score BETWEEN 0 AND 100);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS intent_confidence numeric NOT NULL DEFAULT 0 CHECK (intent_confidence BETWEEN 0 AND 1);
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS catalog_version_id uuid REFERENCES intent_catalog_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS intent_catalog_versions_tenant_idx ON intent_catalog_versions (tenant_id, version DESC);

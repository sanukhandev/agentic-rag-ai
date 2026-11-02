CREATE TABLE IF NOT EXISTS intent_catalog_v2_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  source_file_name text NOT NULL,
  source_hash text NOT NULL,
  parser_version text NOT NULL,
  catalog_json jsonb NOT NULL,
  catalog_version_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, version),
  UNIQUE (tenant_id, source_hash),
  UNIQUE (tenant_id, catalog_version_ref)
);

CREATE UNIQUE INDEX IF NOT EXISTS intent_catalog_v2_one_published_idx
  ON intent_catalog_v2_versions (tenant_id) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS intent_catalog_v2_tenant_idx
  ON intent_catalog_v2_versions (tenant_id, version DESC);

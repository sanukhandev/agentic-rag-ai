CREATE TABLE IF NOT EXISTS source_versions (
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, version_id)
);

INSERT INTO source_versions (source_id, tenant_id, version_id, content_hash, created_at)
SELECT id, tenant_id, version_id, content_hash, created_at
FROM knowledge_sources
ON CONFLICT (source_id, version_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS source_versions_tenant_idx ON source_versions (tenant_id, source_id, created_at DESC);

-- Additive Catalog V2 identity support. Preserve UUID V1 FK columns and all applied migrations.
-- Runtime uses the canonical V2 version ref as a distinct tenant-scoped value.
ALTER TABLE action_requests
  ADD COLUMN IF NOT EXISTS catalog_v2_version_ref text NULL;
ALTER TABLE action_executions
  ADD COLUMN IF NOT EXISTS catalog_v2_version_ref text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_requests_catalog_v2_fk') THEN
    ALTER TABLE action_requests
      ADD CONSTRAINT action_requests_catalog_v2_fk
      FOREIGN KEY (tenant_id, catalog_v2_version_ref)
      REFERENCES intent_catalog_v2_versions(tenant_id, catalog_version_ref)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_executions_catalog_v2_fk') THEN
    ALTER TABLE action_executions
      ADD CONSTRAINT action_executions_catalog_v2_fk
      FOREIGN KEY (tenant_id, catalog_v2_version_ref)
      REFERENCES intent_catalog_v2_versions(tenant_id, catalog_version_ref)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_requests_one_catalog_identity') THEN
    ALTER TABLE action_requests ADD CONSTRAINT action_requests_one_catalog_identity
      CHECK (catalog_version_id IS NULL OR catalog_v2_version_ref IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_executions_one_catalog_identity') THEN
    ALTER TABLE action_executions ADD CONSTRAINT action_executions_one_catalog_identity
      CHECK (catalog_version_id IS NULL OR catalog_v2_version_ref IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS action_requests_catalog_v2_ref_idx
  ON action_requests(tenant_id, catalog_v2_version_ref)
  WHERE catalog_v2_version_ref IS NOT NULL;

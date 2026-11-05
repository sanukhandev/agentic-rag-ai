-- Additive V2 catalog identity for approved package and price records.
-- Keep the legacy UUID column for V1 data; never repin an existing offering.
ALTER TABLE package_offerings
  ADD COLUMN IF NOT EXISTS catalog_v2_version_ref text NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_offerings_catalog_v2_fk') THEN
    ALTER TABLE package_offerings
      ADD CONSTRAINT package_offerings_catalog_v2_fk
      FOREIGN KEY (tenant_id, catalog_v2_version_ref)
      REFERENCES intent_catalog_v2_versions(tenant_id, catalog_version_ref)
      ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_offerings_one_catalog_identity') THEN
    ALTER TABLE package_offerings
      ADD CONSTRAINT package_offerings_one_catalog_identity
      CHECK (catalog_version_id IS NULL OR catalog_v2_version_ref IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS package_offerings_tenant_v2_catalog_idx
  ON package_offerings (tenant_id, catalog_v2_version_ref, approval_status, package_key)
  WHERE catalog_v2_version_ref IS NOT NULL;

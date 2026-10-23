ALTER TABLE tenants ADD COLUMN IF NOT EXISTS catalog_query_normalization_enabled boolean NOT NULL DEFAULT false;

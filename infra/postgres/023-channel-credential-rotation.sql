ALTER TABLE channel_credentials DROP CONSTRAINT IF EXISTS channel_credentials_tenant_id_channel_key;
CREATE UNIQUE INDEX IF NOT EXISTS channel_credentials_active_tenant_channel_idx ON channel_credentials (tenant_id, channel) WHERE active;

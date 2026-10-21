CREATE TABLE IF NOT EXISTS channel_credentials (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel ~ '^[a-z][a-z0-9_-]{1,31}$'),
  key_id text NOT NULL UNIQUE,
  secret_ciphertext text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS channel_credentials_tenant_idx ON channel_credentials (tenant_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS channel_credentials_active_tenant_channel_idx ON channel_credentials (tenant_id, channel) WHERE active;

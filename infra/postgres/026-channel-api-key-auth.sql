ALTER TABLE channel_credentials
  ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'hmac',
  ADD COLUMN IF NOT EXISTS api_key_hash text;

ALTER TABLE channel_credentials
  DROP CONSTRAINT IF EXISTS channel_credentials_auth_mode_check;

ALTER TABLE channel_credentials
  ADD CONSTRAINT channel_credentials_auth_mode_check CHECK (auth_mode IN ('hmac', 'api_key'));

CREATE UNIQUE INDEX IF NOT EXISTS channel_credentials_api_key_hash_idx
  ON channel_credentials (api_key_hash)
  WHERE api_key_hash IS NOT NULL;

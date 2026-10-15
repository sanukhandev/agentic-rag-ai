CREATE TABLE IF NOT EXISTS callback_nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS callback_nonces_expiry_idx ON callback_nonces (expires_at);

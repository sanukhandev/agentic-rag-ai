CREATE TABLE IF NOT EXISTS v2_otp_challenges (
  challenge_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts_remaining integer NOT NULL CHECK (attempts_remaining >= 0),
  delivery_status text NOT NULL CHECK (delivery_status = 'accepted'),
  code_digest bytea NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS v2_otp_challenges_scope_idx
  ON v2_otp_challenges (tenant_id, challenge_id);

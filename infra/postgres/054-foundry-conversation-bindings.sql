CREATE TABLE IF NOT EXISTS chat_session_access_tokens (
  session_id uuid PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS foundry_conversation_bindings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  foundry_conversation_id text NOT NULL UNIQUE,
  foundry_agent_id text NOT NULL,
  foundry_agent_version text NULL,
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS foundry_bindings_active_session_agent_idx
  ON foundry_conversation_bindings (tenant_id, session_id, foundry_agent_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS foundry_bindings_tenant_session_idx
  ON foundry_conversation_bindings (tenant_id, session_id, last_used_at DESC);

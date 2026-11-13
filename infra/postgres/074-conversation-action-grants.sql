-- Conversation-core owned, explicit customer authorization evidence.
-- Does not touch protected RAG, vectors, source documents, or existing actions.
-- No model or tool callback is granted permission to INSERT into this table.
CREATE TABLE IF NOT EXISTS conversation_action_grants (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  catalog_version_ref text NOT NULL,
  goal_key text NOT NULL,
  stage_key text NOT NULL,
  action_key text NOT NULL,
  session_revision integer NOT NULL CHECK (session_revision >= 0),
  goal_confirmed_at timestamptz NOT NULL,
  purpose_consented_at timestamptz NOT NULL,
  customer_authorized_at timestamptz NOT NULL,
  consent_scope text NOT NULL,
  granted_by_principal_hash text NOT NULL CHECK (length(granted_by_principal_hash) = 64),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id, action_key, session_revision)
);
CREATE INDEX IF NOT EXISTS conversation_action_grants_scope_idx
  ON conversation_action_grants (tenant_id, session_id, session_revision, expires_at DESC)
  WHERE revoked_at IS NULL;

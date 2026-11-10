CREATE TABLE IF NOT EXISTS intent_vocabulary_candidates (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  intent_key text NOT NULL,
  phrase text NOT NULL,
  source_session_ids uuid[] NOT NULL DEFAULT '{}',
  source_message_ids uuid[] NOT NULL DEFAULT '{}',
  catalog_version_id uuid NULL,
  status text NOT NULL CHECK (status IN ('candidate','promotable','promoted','rejected','rolled_back')),
  reason text NULL,
  evaluation jsonb NOT NULL DEFAULT '{}'::jsonb,
  promoted_catalog_version_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz NULL,
  promoted_at timestamptz NULL,
  UNIQUE (tenant_id, intent_key, phrase)
);

CREATE INDEX IF NOT EXISTS intent_vocabulary_candidates_tenant_status_idx
  ON intent_vocabulary_candidates (tenant_id, status, created_at DESC);

COMMENT ON TABLE intent_vocabulary_candidates IS
  'Customer-origin intent phrases; may change vocabulary only, never RAG, documents, pricing, or workflow policy.';

CREATE TABLE IF NOT EXISTS user_intent_documents (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  opportunity_id uuid NULL,
  catalog_source text NOT NULL CHECK (catalog_source IN ('legacy_v1', 'v2')),
  catalog_version_ref text NOT NULL,
  persona_version_id uuid NULL REFERENCES persona_versions(id) ON DELETE SET NULL,
  business_goal_key text NULL,
  turn_intent_key text NULL,
  current_stage_key text NULL,
  stage_revision integer NOT NULL DEFAULT 0 CHECK (stage_revision >= 0),
  goal_confirmed boolean NOT NULL DEFAULT false,
  verified_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_requirement_key text NULL,
  last_question text NULL,
  approved_response jsonb NULL,
  tool_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  summary_revision integer NOT NULL DEFAULT 0 CHECK (summary_revision >= 0),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, session_id)
);

CREATE INDEX IF NOT EXISTS user_intent_documents_tenant_opportunity_idx
  ON user_intent_documents (tenant_id, opportunity_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS intent_turn_assessments (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES user_intent_documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  opportunity_id uuid NULL,
  turn_sequence integer NOT NULL CHECK (turn_sequence >= 1),
  client_message_id text NOT NULL,
  message_hash text NOT NULL CHECK (message_hash ~ '^[a-f0-9]{64}$'),
  business_goal_key text NULL,
  turn_intent_key text NULL,
  intent_category text NULL,
  verified_fact_patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  pending_requirement_key text NULL,
  last_question text NULL,
  approved_response jsonb NULL,
  tool_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_message_id),
  UNIQUE (document_id, turn_sequence)
);

CREATE INDEX IF NOT EXISTS intent_turn_assessments_tenant_session_idx
  ON intent_turn_assessments (tenant_id, session_id, turn_sequence);

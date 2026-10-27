-- Generic opportunity identity. Existing actions remain readable and nullable during migration.
CREATE TABLE IF NOT EXISTS journey_instances (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  intent_key text NOT NULL,
  catalog_version_id uuid NULL REFERENCES intent_catalog_versions(id),
  status text NOT NULL DEFAULT 'active',
  revision integer NOT NULL DEFAULT 0,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS journey_instances_session_idx ON journey_instances(tenant_id, session_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS journey_facts (
  journey_id uuid NOT NULL REFERENCES journey_instances(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  value jsonb NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (journey_id, fact_key)
);
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS opportunity_id uuid;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS action_key text;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS action_revision integer NOT NULL DEFAULT 1;
UPDATE action_requests SET action_key = COALESCE(action_key, intent_key, workflow_key) WHERE action_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS action_requests_opportunity_identity_idx ON action_requests(tenant_id, opportunity_id, action_key, action_revision) WHERE opportunity_id IS NOT NULL AND action_key IS NOT NULL;

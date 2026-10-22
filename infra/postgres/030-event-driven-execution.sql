CREATE TABLE IF NOT EXISTS event_outbox (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  stream text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid REFERENCES chat_sessions(id) ON DELETE CASCADE,
  action_id uuid REFERENCES action_requests(id) ON DELETE SET NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version > 0),
  workflow_key text,
  payload_ref text NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_expires_at timestamptz,
  last_error text,
  UNIQUE (stream, idempotency_key)
);

CREATE INDEX IF NOT EXISTS event_outbox_claim_idx
  ON event_outbox (published_at, lease_expires_at, occurred_at, event_id)
  WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS event_inbox (
  consumer text NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  result text NOT NULL DEFAULT 'processed',
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE IF NOT EXISTS action_executions (
  id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES action_requests(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_key text NOT NULL,
  catalog_version_id uuid,
  provider_status text NOT NULL,
  n8n_execution_ref text,
  idempotency_key text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  deadline_at timestamptz,
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS action_executions_status_idx
  ON action_executions (tenant_id, provider_status, updated_at DESC);

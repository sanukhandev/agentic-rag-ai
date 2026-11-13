-- 076: Tenant-consistent keys, operational indexes, and BCNF service integration records.
-- All durable integration records are scoped to one tenant and one provider connection.
-- Credentials, authorization tokens and raw provider payloads are NEVER stored here.

-- Composite ownership keys enable same-tenant foreign keys; global UUID PKs remain.
CREATE UNIQUE INDEX IF NOT EXISTS chat_sessions_tenant_identity_ux ON chat_sessions(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS action_requests_tenant_identity_ux ON action_requests(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_tenant_identity_ux ON crm_leads(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS supporting_documents_tenant_identity_ux ON supporting_documents(tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_canonical_ux ON users (lower(email));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_requests_tenant_session_fk') THEN
    ALTER TABLE action_requests ADD CONSTRAINT action_requests_tenant_session_fk
      FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_leads_tenant_session_fk') THEN
    ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_tenant_session_fk
      FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_leads_tenant_action_fk') THEN
    ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_tenant_action_fk
      FOREIGN KEY (tenant_id, action_id) REFERENCES action_requests(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supporting_documents_tenant_session_fk') THEN
    ALTER TABLE supporting_documents ADD CONSTRAINT supporting_documents_tenant_session_fk
      FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supporting_documents_tenant_lead_fk') THEN
    ALTER TABLE supporting_documents ADD CONSTRAINT supporting_documents_tenant_lead_fk
      FOREIGN KEY (tenant_id, lead_id) REFERENCES crm_leads(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_jobs_tenant_document_fk') THEN
    ALTER TABLE document_processing_jobs ADD CONSTRAINT document_jobs_tenant_document_fk
      FOREIGN KEY (tenant_id, document_id) REFERENCES supporting_documents(tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_grants_tenant_session_fk') THEN
    ALTER TABLE conversation_action_grants ADD CONSTRAINT conversation_grants_tenant_session_fk
      FOREIGN KEY (tenant_id, session_id) REFERENCES chat_sessions(tenant_id, id) NOT VALID;
  END IF;
END $$;

-- Common read paths and queue claims: tenant prefix, filtered working sets,
-- deterministic tie-break keys. Avoid duplicating existing indexes.
CREATE INDEX IF NOT EXISTS chat_messages_session_history_idx
  ON chat_messages (tenant_id, session_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS action_requests_session_recent_idx
  ON action_requests (tenant_id, session_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS action_executions_action_recent_idx
  ON action_executions (action_id, tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS document_processing_jobs_ready_idx
  ON document_processing_jobs (created_at, id)
  INCLUDE (lease_expires_at) WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS event_outbox_ready_idx
  ON event_outbox (occurred_at, event_id)
  INCLUDE (lease_expires_at) WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX IF NOT EXISTS event_inbox_retry_idx
  ON event_inbox (retry_at, updated_at, consumer, event_id)
  WHERE state = 'retry_scheduled';
CREATE INDEX IF NOT EXISTS auth_sessions_unrevoked_idx
  ON auth_sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS invoices_opportunity_status_idx
  ON invoices (tenant_id, opportunity_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_accounts_lead_status_idx
  ON crm_accounts (tenant_id, lead_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS conversation_action_grants_live_action_idx
  ON conversation_action_grants (tenant_id, session_id, action_key, session_revision, expires_at DESC)
  WHERE revoked_at IS NULL;

-- Connection entity: (tenant_id, provider_key, connection_key) is a candidate key.
-- Keep credentials in the secrets manager; only the opaque reference is persisted.
CREATE TABLE IF NOT EXISTS integration_connections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  connection_key text NOT NULL CHECK (connection_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  credential_ref text CHECK (credential_ref IS NULL OR
    (length(credential_ref) BETWEEN 8 AND 200 AND credential_ref !~ '[[:space:]]')),
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','ready','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider_key, connection_key),
  UNIQUE (tenant_id, id)
);

-- Remote object identity depends on a provider connection, type and external ID.
-- The action reference is optional but MUST be in the same tenant when provided.
CREATE TABLE IF NOT EXISTS integration_remote_objects (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type ~ '^[a-z][a-z0-9._-]{1,79}$'),
  external_id text NOT NULL CHECK (length(external_id) BETWEEN 1 AND 200),
  action_id uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, resource_type, external_id),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES integration_connections(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, action_id)
    REFERENCES action_requests(tenant_id, id) ON DELETE RESTRICT
);

-- Attempt is an atomic fact keyed by action, connection, and sequence.
-- Retries reuse a provider idempotency key but have DISTINCT attempt numbers.
CREATE TABLE IF NOT EXISTS integration_dispatch_attempts (
  tenant_id uuid NOT NULL,
  action_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 100000),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  status text NOT NULL CHECK (status IN
    ('dispatching','accepted','completed','failed','reconcile_required')),
  remote_request_id text CHECK (remote_request_id IS NULL OR length(remote_request_id) <= 200),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (tenant_id, action_id, connection_id, attempt_no),
  UNIQUE (connection_id, idempotency_key, attempt_no),
  FOREIGN KEY (tenant_id, action_id)
    REFERENCES action_requests(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES integration_connections(tenant_id, id) ON DELETE RESTRICT,
  CHECK (finished_at IS NULL OR finished_at >= started_at)
);
CREATE INDEX IF NOT EXISTS integration_attempts_reconcile_idx
  ON integration_dispatch_attempts (tenant_id, status, started_at, action_id)
  WHERE status IN ('dispatching','accepted','reconcile_required');

-- Inbound webhook deduplication: duplicate remote event ID is one delivery,
-- while signature validation and processing remain separate authoritative states.
CREATE TABLE IF NOT EXISTS integration_webhook_deliveries (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  external_event_id text NOT NULL CHECK (length(external_event_id) BETWEEN 1 AND 200),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature_verified_at timestamptz,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','verified','completed','rejected','reconcile_required')),
  UNIQUE (connection_id, external_event_id),
  FOREIGN KEY (tenant_id, connection_id)
    REFERENCES integration_connections(tenant_id, id) ON DELETE RESTRICT,
  CHECK (processed_at IS NULL OR signature_verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS integration_webhooks_pending_idx
  ON integration_webhook_deliveries (tenant_id, status, received_at, id)
  WHERE status IN ('received','verified','reconcile_required');

-- No silent fallback to unscoped reads. The future integration adapter MUST set
-- SET LOCAL app.tenant_id = '<validated server-side tenant UUID>' in each transaction.
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_remote_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_remote_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_dispatch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_dispatch_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_webhook_deliveries FORCE ROW LEVEL SECURITY;
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'integration_connections', 'integration_remote_objects',
    'integration_dispatch_attempts', 'integration_webhook_deliveries'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl AND policyname = 'integration_tenant_scope'
    ) THEN
      EXECUTE format(
        'CREATE POLICY integration_tenant_scope ON public.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'', true), '''')::uuid)',
        tbl
      );
    END IF;
  END LOOP;
END $$;

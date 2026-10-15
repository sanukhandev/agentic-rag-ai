CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  public_chat_enabled boolean NOT NULL DEFAULT true,
  public_origin text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('platform_admin', 'tenant_admin', 'tenant_agent')),
  tenant_id uuid REFERENCES tenants(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_personas (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  greeting text NOT NULL,
  personality text NOT NULL,
  tone text NOT NULL,
  speaking_style text NOT NULL,
  permitted_languages text[] NOT NULL DEFAULT ARRAY['en'],
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_sources (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  mime_type text NOT NULL,
  source_url text,
  audience text NOT NULL CHECK (audience IN ('public', 'internal')),
  status text NOT NULL CHECK (status IN ('awaiting_review', 'active', 'revoked')),
  version_id uuid NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS source_chunks (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  ordinal integer NOT NULL,
  locator text NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector(8) NOT NULL,
  UNIQUE (source_id, version_id, ordinal)
);

CREATE INDEX IF NOT EXISTS source_chunks_tenant_idx ON source_chunks (tenant_id, source_id, version_id);
CREATE INDEX IF NOT EXISTS knowledge_sources_active_idx ON knowledge_sources (tenant_id, status, audience);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  masked_content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, client_message_id)
);

CREATE TABLE IF NOT EXISTS action_requests (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  workflow_key text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL,
  opaque_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id uuid,
  event_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

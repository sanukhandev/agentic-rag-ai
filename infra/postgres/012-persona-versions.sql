CREATE TABLE IF NOT EXISTS persona_versions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'published')),
  name text NOT NULL,
  greeting text NOT NULL,
  personality text NOT NULL,
  tone text NOT NULL,
  speaking_style text NOT NULL,
  permitted_languages text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (tenant_id, version)
);

CREATE INDEX IF NOT EXISTS persona_versions_tenant_idx ON persona_versions (tenant_id, version DESC);

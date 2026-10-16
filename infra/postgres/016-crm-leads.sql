CREATE TABLE IF NOT EXISTS crm_leads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_id uuid NOT NULL UNIQUE REFERENCES action_requests(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  intent text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  validation_pass boolean NOT NULL,
  lead_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  conversation_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text,
  summary_status text NOT NULL DEFAULT 'pending' CHECK (summary_status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_leads_tenant_created_idx ON crm_leads (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_lead_associations (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  crm_lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE RESTRICT,
  action_id uuid NOT NULL REFERENCES action_requests(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE RESTRICT,
  opportunity_id uuid,
  association_type text NOT NULL CHECK (association_type IN ('canonical','deduplicated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, action_id),
  UNIQUE (tenant_id, opportunity_id, crm_lead_id)
);

CREATE INDEX IF NOT EXISTS crm_lead_associations_tenant_opportunity_idx
  ON crm_lead_associations (tenant_id, opportunity_id, created_at DESC);

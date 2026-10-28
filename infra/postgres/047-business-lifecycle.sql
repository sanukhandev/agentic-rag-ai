CREATE TABLE IF NOT EXISTS package_offerings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  catalog_version_id uuid REFERENCES intent_catalog_versions(id) ON DELETE SET NULL,
  package_key text NOT NULL,
  name text NOT NULL,
  eligible_entity_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligible_activities jsonb NOT NULL DEFAULT '[]'::jsonb,
  included_visa_quantity integer NOT NULL DEFAULT 0 CHECK (included_visa_quantity >= 0),
  office_requirement text,
  inclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_minor integer CHECK (price_minor IS NULL OR price_minor >= 0),
  currency text,
  pricing_effective_from timestamptz,
  pricing_effective_to timestamptz,
  additional_fees jsonb NOT NULL DEFAULT '[]'::jsonb,
  processing_time text,
  required_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  exclusions jsonb NOT NULL DEFAULT '[]'::jsonb,
  availability text NOT NULL DEFAULT 'development_only',
  approval_status text NOT NULL DEFAULT 'unavailable' CHECK (approval_status IN ('approved','unavailable','expired')),
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, package_key)
);

CREATE TABLE IF NOT EXISTS crm_accounts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES crm_leads(id) ON DELETE RESTRICT,
  remote_account_id text,
  remote_contact_id text,
  remote_opportunity_id text,
  status text NOT NULL CHECK (status IN ('pending','verified','reconcile_required','failed')),
  conversion_rule text NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  package_offering_id uuid NOT NULL REFERENCES package_offerings(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL,
  valid_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','approved','expired','rejected')),
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_selections (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  package_offering_id uuid NOT NULL REFERENCES package_offerings(id) ON DELETE RESTRICT,
  quote_id uuid REFERENCES quotes(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('proposed','confirmed','rejected')),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  external_invoice_id text,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL,
  payment_url text,
  status text NOT NULL CHECK (status IN ('draft','pending','paid','failed','reconcile_required')),
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, quote_id)
);

CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  package_selection_id uuid NOT NULL REFERENCES package_selections(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  external_contract_id text,
  template_key text NOT NULL,
  signing_url text,
  status text NOT NULL CHECK (status IN ('draft','approval_required','sent','signed','failed','reconcile_required')),
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS package_offerings_tenant_approval_idx ON package_offerings (tenant_id, approval_status, package_key);
CREATE INDEX IF NOT EXISTS crm_accounts_tenant_opportunity_idx ON crm_accounts (tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS lifecycle_quotes_tenant_opportunity_idx ON quotes (tenant_id, opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lifecycle_contracts_tenant_opportunity_idx ON contracts (tenant_id, opportunity_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS package_selections_one_confirmed_idx ON package_selections (tenant_id, opportunity_id) WHERE status = 'confirmed';

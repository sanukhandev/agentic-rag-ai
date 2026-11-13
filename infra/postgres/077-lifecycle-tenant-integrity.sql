-- 077: Explicit tenant-ownership foreign keys across the seven-stage business lifecycle.
-- Global UUID PKs do not on their own prevent accidentally joining another tenant's rows.
-- NOT VALID preserves historic rows pending an audited tenant-integrity verification;
-- all new/updated foreign-key references are checked from migration time onward.

CREATE UNIQUE INDEX IF NOT EXISTS package_offerings_tenant_identity_ux ON package_offerings(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS quotes_tenant_identity_ux ON quotes(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS package_selections_tenant_identity_ux ON package_selections(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_tenant_identity_ux ON invoices(tenant_id,id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='crm_accounts_tenant_lead_fk') THEN
    ALTER TABLE crm_accounts ADD CONSTRAINT crm_accounts_tenant_lead_fk
      FOREIGN KEY (tenant_id,lead_id) REFERENCES crm_leads(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='quotes_tenant_package_fk') THEN
    ALTER TABLE quotes ADD CONSTRAINT quotes_tenant_package_fk
      FOREIGN KEY (tenant_id,package_offering_id) REFERENCES package_offerings(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='selections_tenant_session_fk') THEN
    ALTER TABLE package_selections ADD CONSTRAINT selections_tenant_session_fk
      FOREIGN KEY (tenant_id,session_id) REFERENCES chat_sessions(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='selections_tenant_package_fk') THEN
    ALTER TABLE package_selections ADD CONSTRAINT selections_tenant_package_fk
      FOREIGN KEY (tenant_id,package_offering_id) REFERENCES package_offerings(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='selections_tenant_quote_fk') THEN
    ALTER TABLE package_selections ADD CONSTRAINT selections_tenant_quote_fk
      FOREIGN KEY (tenant_id,quote_id) REFERENCES quotes(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_tenant_quote_fk') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_tenant_quote_fk
      FOREIGN KEY (tenant_id,quote_id) REFERENCES quotes(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_tenant_selection_fk') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_tenant_selection_fk
      FOREIGN KEY (tenant_id,package_selection_id) REFERENCES package_selections(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='contracts_tenant_invoice_fk') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_tenant_invoice_fk
      FOREIGN KEY (tenant_id,invoice_id) REFERENCES invoices(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lead_associations_tenant_lead_fk') THEN
    ALTER TABLE crm_lead_associations ADD CONSTRAINT lead_associations_tenant_lead_fk
      FOREIGN KEY (tenant_id,crm_lead_id) REFERENCES crm_leads(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lead_associations_tenant_action_fk') THEN
    ALTER TABLE crm_lead_associations ADD CONSTRAINT lead_associations_tenant_action_fk
      FOREIGN KEY (tenant_id,action_id) REFERENCES action_requests(tenant_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='lead_associations_tenant_session_fk') THEN
    ALTER TABLE crm_lead_associations ADD CONSTRAINT lead_associations_tenant_session_fk
      FOREIGN KEY (tenant_id,session_id) REFERENCES chat_sessions(tenant_id,id) NOT VALID;
  END IF;
END $$;

-- A remote payment/contract identity is unique per provider and tenant. A
-- repeated remote callback must not identify two local financial records.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_provider_remote_id_ux
  ON invoices(tenant_id,provider,external_invoice_id)
  WHERE external_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contracts_provider_remote_id_ux
  ON contracts(tenant_id,provider,external_contract_id)
  WHERE external_contract_id IS NOT NULL;

-- Redundant: the 047 UNIQUE (tenant_id,opportunity_id) constraint on crm_accounts
-- already creates a covering B-tree index for the exact same lookup.
DROP INDEX IF EXISTS crm_accounts_tenant_opportunity_idx;

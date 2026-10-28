-- Prevent a retry or cross-opportunity callback from claiming the same remote CRM identity twice.
CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_tenant_remote_account_uidx
  ON crm_accounts (tenant_id, remote_account_id)
  WHERE remote_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_tenant_remote_contact_uidx
  ON crm_accounts (tenant_id, remote_contact_id)
  WHERE remote_contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_accounts_tenant_remote_opportunity_uidx
  ON crm_accounts (tenant_id, remote_opportunity_id)
  WHERE remote_opportunity_id IS NOT NULL;

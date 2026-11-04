# Salesforce Sandbox Report

**Status:** BLOCKED_EXTERNAL_DEPENDENCY / NOT RUN

- API runtime provider configuration reports Salesforce as the configured remote CRM provider.
- Local lead, qualification, summary and provider-evidence unit suites pass.
- No synthetic Salesforce sandbox Lead was created or read back during this checkpoint.
- No provider completion is claimed.

Additional live development checks (2026-11-04):

- `.env` selects `REMOTE_CRM_PROVIDER=salesforce`.
- The published ANCFZ V2 catalog is `b63b931f-0713-4d18-bcea-88621bd1b5ed` (`anc:r2:1b7342efc6ed15e10c811dd462e192a08bbdf41ea4c89ba6fac9843974b73a67`).
- Its `lead.create` ToolBinding and `crm.lead.create` WorkflowBinding are both `enabled=false`.
- The repository V2 n8n template is `active=false`, points to `https://configure-provider.invalid/...`, has no credential configured, and calls `/api/v2/internal/provider-evidence/verify`. The API boundary now exists, but deliberately moves Salesforce to reconciliation until a configured Node provider adapter performs independent readback.
- Therefore enabling the binding or reporting a deterministic mock as Salesforce success would violate the provider-verification gate.

Resume procedure: provide verified development Salesforce sandbox credentials and permissions, run the existing CRM workflow through the public API with a unique synthetic identity, then capture Lead create/readback, duplicate handling, update/readback and correlation evidence.

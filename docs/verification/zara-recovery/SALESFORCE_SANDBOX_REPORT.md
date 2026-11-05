# Salesforce Sandbox Report

**Status:** PARTIAL_LIVE_EVIDENCE / NOT_READY

The initial credential-free audit below is historical. The latest checkpoint at the end of this report records a verified direct n8n Salesforce Lead create/readback; the full action-gated ANCFZ journey remains unverified.

- API runtime provider configuration reports Salesforce as the configured remote CRM provider.
- Local lead, qualification, summary and provider-evidence unit suites pass.
- No synthetic Salesforce sandbox Lead was created or read back during the initial credential-free checkpoint.
- No provider completion is claimed.

Additional live development checks (2026-11-04):

- `.env` selects `REMOTE_CRM_PROVIDER=salesforce`.
- The published ANCFZ V2 catalog is `b63b931f-0713-4d18-bcea-88621bd1b5ed` (`anc:r2:1b7342efc6ed15e10c811dd462e192a08bbdf41ea4c89ba6fac9843974b73a67`).
- Its `lead.create` ToolBinding and `crm.lead.create` WorkflowBinding are both `enabled=false`.
- The repository V2 n8n template is `active=false`, now reads its Lead create/readback endpoints from `REMOTE_CRM_LEAD_URL` and `REMOTE_CRM_LEAD_READ_URL`, has no credential configured, and calls `/api/v2/internal/provider-evidence/verify`. The API boundary now includes a fail-closed Node readback adapter, but still moves Salesforce to reconciliation until that adapter and the n8n provider call have real sandbox configuration and independent readback evidence.
- Therefore enabling the binding or reporting a deterministic mock as Salesforce success would violate the provider-verification gate.

Resume procedure: provide verified development Salesforce sandbox credentials and permissions, run the existing CRM workflow through the public API with a unique synthetic identity, then capture Lead create/readback, duplicate handling, update/readback and correlation evidence.

## Exact blocker audit — 2026-11-05

The live gate is blocked by a chain of missing runtime dependencies, not by a failed Salesforce response:

1. The local environment selects `REMOTE_CRM_PROVIDER=salesforce` and provides a development `REMOTE_CRM_LEAD_URL`, but exposes no Salesforce OAuth/access-token material or provider permission set to the API runtime. A credential-free `HEAD` probe to the configured endpoint returned HTTP 401; no customer payload was sent.
2. The Node implementation contains the typed `salesforce_sandbox` result validator and a readback adapter, but no live sandbox provider configuration has been supplied and the broader search/create/update contract remains unverified.
3. The published ANCFZ catalog keeps `lead.create` and `crm.lead.create` disabled, so Node correctly refuses to dispatch the Lead action.
4. The repository n8n workflow is inactive and has no Salesforce credential. Enabling the catalog binding now would create an unauthorized/unverifiable side-effect path.

Required evidence to unblock the gate:

- A development-only Salesforce sandbox create/readback endpoint and authenticated integration credential with Lead search/create/update/read permissions.
- A configured Node readback adapter plus active n8n workflow that preserves tenant/session/opportunity/action/idempotency correlation.
- A fresh synthetic Lead run proving create-or-dedupe, provider readback, qualification, update/readback, and replay idempotency.
- Only after those checks pass: a reviewed catalog revision enabling the bindings, without repinning existing sessions.

The 2026-11-05 API/model/worker restart replay passed locally, but it does not satisfy any of the provider requirements above.

## 2026-11-05 live n8n credential and Lead contract checkpoint

- Created the project-scoped n8n credential `SalesForce ANC - CREDS` (`oAuth2Api`) using the supplied development Salesforce Connected App. The credential is encrypted in n8n and no secret was written to Git or the repository `.env`.
- n8n credential smoke execution: **PASS**. The encrypted credential reached the Salesforce Apex endpoint; the endpoint returned HTTP 405 with `POST` as the allowed method rather than HTTP 401.
- n8n Salesforce Lead smoke execution: **PASS**. A synthetic sandbox Lead was created through the n8n HTTP Request node using the approved body contract (`Name`, `Company`, `Phone`, `Email`, `Description`). Salesforce returned a provider Lead identifier.
- Salesforce provider readback: **PASS** for this smoke record through standard Salesforce REST API v68.0. The returned ID and all reference fields matched the submitted body. This is direct sandbox evidence, not a mock.
- The temporary smoke workflow, execution records and plaintext payload fixture were removed after verification.
- This checkpoint does **not** activate the ANCFZ V2 workflow or catalog binding. The production path still lacks the configured Node `REMOTE_CRM_LEAD_READ_URL`, action-gated end-to-end dispatch, duplicate/replay proof and approved Account/SF-02 contracts.

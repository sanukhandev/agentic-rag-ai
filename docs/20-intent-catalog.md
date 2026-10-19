# Versioned Excel intent catalog

The intent catalog is an internal, tenant-scoped reference for deterministic intent scoring and approved workflow selection. It is not a replacement for source-grounded RAG answers.

## Flow

1. A tenant administrator uploads the reviewed `.xlsx` workbook through `POST /api/v1/admin/intent-catalog/upload`.
2. The private Python worker parses the required `README`, `Intents`, `Signals`, `Slots`, `Relations`, and `WorkflowBindings` sheets. Formulas, external links, unsupported files and malformed rows are rejected.
3. The API validates the normalized result, checks tenant scope, stores a draft version and records an audit event. Re-uploading the same source hash is idempotent.
4. A tenant administrator publishes one version through `POST /api/v1/admin/intent-catalog/versions/:id/publish`. Only the published version is used at chat time.
5. Node scores the masked conversation against the published catalog, collects required slots, checks the threshold/confidence and active allowlisted binding, then creates a confirmation-gated action. The model never authorizes the action.
6. n8n receives the minimal masked payload and forwards the approved lead data to the internal Node CRM endpoint. The workflow does not receive workbook contents, raw customer messages or token-vault credentials.

## Workbook contract

`README` is a two-column key/value sheet and must include a tenant scope when the workbook is tenant-specific. The other sheets use the headers in the sample workbook. Intent and workflow keys are stable identifiers; scores and confidence thresholds are server-validated.

The current sample enables `crm.lead.create` through `lead-capture`. The appointment binding remains inactive until its consent, slot validation and calendar destination are reviewed.

## Safety boundaries

- Tenant, role, source status and catalog publication checks happen in Node before retrieval or action execution.
- Catalog text is configuration, not executable instructions.
- PII stays tokenized inside the backend boundary; only masked values and opaque IDs cross to n8n.
- A proposed intent without required slots, threshold, confidence, active binding or explicit confirmation produces no side effect.
- This local workflow set is a smoke-test/demo configuration, not approval for production n8n exposure or external CRM credentials.

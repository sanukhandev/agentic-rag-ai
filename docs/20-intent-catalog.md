# Versioned Excel intent catalog

The intent catalog is an internal, tenant-scoped reference for deterministic intent scoring and approved workflow selection. It is not a replacement for source-grounded RAG answers.

## Flow

1. A tenant administrator uploads the reviewed `.xlsx` workbook through `POST /api/v1/admin/intent-catalog/upload`.
2. The private Python worker parses the required `README`, `Intents`, `Signals`, `Slots`, `Relations`, and `WorkflowBindings` sheets plus the optional `QualityRules` sheet. Formulas, external links, unsupported files and malformed rows are rejected.
3. The API validates the normalized result, checks tenant scope, stores a draft version and records an audit event. Re-uploading the same source hash is idempotent.
4. A tenant administrator publishes one version through `POST /api/v1/admin/intent-catalog/versions/:id/publish`. Only the published version is used at chat time.
5. Node scores the masked conversation against the published catalog. A signal candidate below its score/confidence threshold gets a catalog-derived clarification question before PII slot collection; once the intent qualifies, required slots are requested in collection order. An `alternative_group` requires one value from that group. Only after the threshold/confidence, active allowlisted binding and required slots pass does Node create a confirmation-gated action. The model never authorizes the action.
6. Node changes the action to `approved` but never calls n8n. The scheduled n8n lead workflow polls the authenticated claim endpoint, which atomically changes claimed actions to `processing` and returns masked conversation data plus the published catalog metadata.
7. n8n validates the catalog binding, writes the CRM lead through Node, and executes the separate quality workflow. That workflow calculates the score from `QualityRules` and slot `quality_weight` values, then stores the score and deterministic summary through Node.
8. The CRM write is an upsert: the tenant-scoped HMAC of the normalized email (or phone fallback) prevents repeated submissions from creating another lead. Chat retries and n8n claims are idempotent.

## Post-capture conversation

After a confirmed CRM action is queued, the conversation remains active. A later visitor turn is treated as a post-capture follow-up rather than another lead-collection turn. Node keeps the published primary intent and sends the masked conversation, the latest question and the tenant's enabled document policies through the normal retrieval and LLM path.

The model may explain packages, requirements, steps or timelines only when the approved tenant sources support them. It may offer the next document upload action only when the published document policy allows it, and it must ask one question at a time. It must not repeat contact collection, create a second lead, invent a requirement or claim that a document was received before the document event is completed.

The deterministic catalog prompts and action-status messages remain control-plane messages for slot collection, consent and workflow state. They are not used for post-capture business answers; those answers are generated from retrieved evidence and validated citations.

## Query normalization rollout

Deterministic query cleanup is always available. LLM-assisted catalog normalization is disabled by default and requires both the global `CATALOG_QUERY_NORMALIZATION_ENABLED=true` kill-switch and the tenant feature `catalogQueryNormalizationEnabled=true`, managed through `/api/v1/admin/features`.

The normalizer receives masked text and bounded masked conversation context. Its cache key includes the tenant, catalog version, selected intent and context digest. A failed, unsafe or semantically changed rewrite returns `null`; Node then uses the original deterministic query and records the fallback/failure in tenant telemetry. Negation, quantities and privacy tokens must remain unchanged before a rewrite can influence intent routing.

CRM actions require a valid name, email and phone, plus the normal catalog, consent and qualification gates. A session may create separate actions for separate intents, while an already submitted action for the same intent remains idempotently deduplicated.

## Workbook contract

`README` is a two-column key/value sheet and must include a tenant scope when the workbook is tenant-specific. The other sheets use the headers in the sample workbook. Intent and workflow keys are stable identifiers; scores and confidence thresholds are server-validated.

The current sample workbook is [crm-lead-capture-intent-catalog.xlsx](../examples/crm-lead-capture-intent-catalog.xlsx). It enables `crm.lead.create` and `crm.lead.quality.score`; `QualityRules` defines a 60% intent, 20% confidence and 20% contact-completeness score with hot/warm/nurture thresholds. The appointment binding remains inactive until its consent, slot validation and calendar destination are reviewed.

The admin Intent Catalog view displays the loaded version's intents, thresholds, signals and workflow bindings. Uploading another `.xlsx` creates a new draft; publishing that draft replaces the active catalog. Tenant admins and platform admins with a selected tenant can use **Edit catalog** to change the JSON contract; `POST /api/v1/admin/intent-catalog/versions/:id/drafts` validates the complete catalog and creates a new draft without mutating the published version. The **Export published Excel** action downloads the selected tenant's currently published version through `GET /api/v1/admin/intent-catalog/published/export`; the server enforces tenant scope, published status and admin authorization, and records an audit event. Load and ingestion failures are shown inline with the API error and a retry action.

`QualityRules` is the only source for lead-quality weights and thresholds. Code validates that the selected quality workflow is active and catalog-bound, but does not select or invoke a workflow.

The existing `webhook_path` column remains a stable workflow-registry identifier for compatibility; the sample n8n flow is schedule-triggered and the API never posts to that path.

## CRM lead-capture catalog

The smallest useful catalog for this workflow is:

| Intent | Display name / CRM interest | Signals | Required slots | Workflow |
| --- | --- | --- | --- | --- |
| `lead.capture` | Request a service | `i need a demo`, `book a demo`, `live demo`, `schedule a demo`, `schedule a call`, `connect with Sanu`, `call with Sanu`, `talk to Sanu`, `let him know`, `pass along a message`, quote, consultation, developer, ERP, build an ERP solution, hire | `name` plus `email` or `phone` | `crm.lead.create` → `lead-capture` |

Node copies the published display name into the lead as the controlled `interest` value; visitors cannot set it directly. The complete masked conversation is retained on the lead so the CRM summary can capture the request and requirements without sending raw PII to n8n.

## Safety boundaries

- Tenant, role, source status and catalog publication checks happen in Node before retrieval or action execution.
- Catalog text is configuration, not executable instructions.
- PII stays tokenized inside the backend boundary; only masked values and opaque IDs cross to n8n.
- A proposed intent without required slots, threshold, confidence, active binding or explicit confirmation produces no side effect.
- This local workflow set is a smoke-test/demo configuration, not approval for production n8n exposure or external CRM credentials.

During multi-turn collection, Node stores only masked slot values and the pending catalog intent in the backend session history. A standalone answer such as `Alice` is accepted only for the catalog's supported `token:NAME` slot; unsupported slot validation rules remain unfilled rather than being sent to a workflow as unvalidated text.

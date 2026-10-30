# Versioned Excel intent catalog

The intent catalog is an internal, tenant-scoped reference for deterministic intent scoring and approved workflow selection. It is not a replacement for source-grounded RAG answers.

## Published catalog → authorized action flow

1. A tenant administrator uploads the reviewed workbook to `POST /api/v1/admin/intent-catalog/upload`. The private Python worker validates the required `README`, `Intents`, `Signals`, `Slots`, `Relations` and `WorkflowBindings` sheets and supported optional extensions. The API stages, validates, audits and stores a **draft** catalog for its tenant.
2. Authorized tenant administration publishes a version through `POST /api/v1/admin/intent-catalog/versions/:id/publish`. Active journeys remain pinned to their selected version; later publications govern new journeys.
3. Node evaluates masked customer turns against the **published, pinned** intent catalog. Signal scores, confidence/ambiguity, active workflow binding, required slot values, validation rules, `JourneyRequirements`, `JourneyTransitions` and `BusinessStages` constrain the next permitted operation.
4. The existing catalog and journey engine preserve the active intent, pending requirement and opportunity through multi-turn fact collection, knowledge interruptions, corrections, retries and new agent responses. Foundry may phrase answers or request read-only lookup functions; it cannot authorize a workflow or fulfill a business stage.
5. When action prerequisites genuinely pass, Node produces an opportunity- and revision-scoped `ActionRequest` / `actionProposal`. Purpose-specific consent and confirmation remain mandatory. Duplicate and stale requests are rejected or idempotently associated.
6. An authorized confirmation records the action and an outbox event transactionally. The outbox relay publishes to Redis Streams; the event worker makes an authenticated minimal-data call to n8n. Any old scheduled polling/claim workflows are compatibility paths, **not the primary route**.
7. n8n invokes the configured provider using approved credentials; Node validates external callbacks, provider identifiers and reconciliation outcomes before marking a business step completed. A model statement, queued action, local CRM record or n8n execution alone is not verified Salesforce completion.
8. For the current ANCFZ focus, preserve **Lead Generation → Lead Qualification → Account Creation → Package Selection → Document Upload (OCR + SF-02) → Payment Details & Invoice → Contract**. Never create an Account for an unqualified Lead or bypass configured confirmation/email verification.

## Post-capture conversation

After a confirmed CRM action is queued, the conversation remains active while Node awaits its authoritative provider outcome; the stage must not be marked complete merely because dispatch succeeded. A later visitor turn is treated as a post-capture follow-up rather than another lead-collection turn. Node keeps the published primary intent and sends the masked conversation, the latest question and the tenant's enabled document policies through the normal retrieval and LLM path.

The model may explain packages, requirements, steps or timelines only when the approved tenant sources support them. It may offer the next document upload action only when the published document policy allows it, and it must ask one question at a time. It must not repeat contact collection, create a second lead, invent a requirement or claim that a document was received before the document event is completed.

The deterministic catalog prompts and action-status messages remain control-plane messages for slot collection, consent and workflow state. They are not used for post-capture business answers; those answers are generated from retrieved evidence and validated citations.

## Intent journey contract

`JourneyRequirements` is a typed, optional sheet. Each row belongs to one catalog intent and declares one bounded requirement: `slot`, `document`, `consent` or `confirmation`. Slot requirements must reference a slot in `Slots`; document requirements must reference a document type allowed by that intent's `DocumentPolicies` row. `fulfillment_mode` distinguishes conversational completion from a requirement that must wait for a verified external result, such as OCR.

`JourneyTransitions` is also typed and optional. A transition may `offer` a related intent or `automatically` activate it. Automatic transitions require a bounded `max_depth`, and the API rejects cycles. The backend keeps bounded per-session progress in `conversation_state.intentProgress`, including active, paused and fulfilled intents, completed requirement keys, the current requirement and a journey revision. Catalogs without these sheets continue using the existing slot-only behavior.

The model can phrase the next requirement, but it cannot mark it fulfilled or activate a transition. Node validates slot values, document completion, consent purpose, catalog version and workflow state before advancing the journey. A knowledge question temporarily pauses the active requirement and resumes it afterward; farewell is the only normal session-closing transition.

## Query normalization rollout

Deterministic query cleanup is always available. LLM-assisted catalog normalization is disabled by default and requires both the global `CATALOG_QUERY_NORMALIZATION_ENABLED=true` kill-switch and the tenant feature `catalogQueryNormalizationEnabled=true`, managed through `/api/v1/admin/features`.

The normalizer receives masked text and bounded masked conversation context. Its cache key includes the tenant, catalog version, selected intent and context digest. A failed, unsafe or semantically changed rewrite returns `null`; Node then uses the original deterministic query and records the fallback/failure in tenant telemetry. Negation, quantities and privacy tokens must remain unchanged before a rewrite can influence intent routing.

CRM actions require a valid name, email and phone, plus the normal catalog, consent and qualification gates. A session may create separate actions for separate intents, while an already submitted action for the same intent remains idempotently deduplicated.

## Workbook contract

`README` is a two-column key/value sheet and must include a tenant scope when the workbook is tenant-specific. The other sheets use the headers in the sample workbook. Intent and workflow keys are stable identifiers; scores and confidence thresholds are server-validated.

The **historical generic sample** workbook is [crm-lead-capture-intent-catalog.xlsx](../examples/crm-lead-capture-intent-catalog.xlsx). It enables `crm.lead.create` and `crm.lead.quality.score`; `QualityRules` defines a 60% intent, 20% confidence and 20% contact-completeness score with hot/warm/nurture thresholds. The appointment binding remains inactive until its consent, slot validation and calendar destination are reviewed.

The admin Intent Catalog view displays the loaded version's intents, thresholds, signals and workflow bindings. Uploading another `.xlsx` creates a new draft; publishing that draft replaces the active catalog. Tenant admins and platform admins with a selected tenant can use **Edit catalog** to change the JSON contract; `POST /api/v1/admin/intent-catalog/versions/:id/drafts` validates the complete catalog and creates a new draft without mutating the published version. The **Export published Excel** action downloads the selected tenant's currently published version through `GET /api/v1/admin/intent-catalog/published/export`; the server enforces tenant scope, published status and admin authorization, and records an audit event. Load and ingestion failures are shown inline with the API error and a retry action.

`QualityRules` is the only source for lead-quality weights and thresholds. Code validates that the selected quality workflow is active and catalog-bound, but does not select or invoke a workflow.

The existing `webhook_path` column remains a stable workflow-registry identifier for compatibility; sample scheduled polling workflows are not the authoritative event-driven dispatch path.

## Historical generic lead-capture example (not the active ANCFZ requirements)

This minimal demo is retained only for workbook compatibility and should **not** be published in place of the current ANCFZ catalog. The old sample is:

| Intent | Display name / CRM interest | Signals | Required slots | Workflow |
| --- | --- | --- | --- | --- |
| `lead.capture` | Request a service | `i need a demo`, `book a demo`, `live demo`, `schedule a demo`, `schedule a call`, `connect with Sanu`, `call with Sanu`, `talk to Sanu`, `let him know`, `pass along a message`, quote, consultation, developer, ERP, build an ERP solution, hire | `name` plus `email` or `phone` | `crm.lead.create` → `lead-capture` |

Node copies the published display name into the lead as the controlled `interest` value; visitors cannot set it directly. The complete masked conversation is retained on the lead so the CRM summary can capture the request and requirements without sending raw PII to n8n.

## Safety boundaries

- Tenant, role, source status and catalog publication checks happen in Node before retrieval or action execution.
- Catalog text is configuration, not executable instructions.
- PII stays tokenized inside the backend boundary; only masked values and opaque IDs cross to n8n.
- A proposed intent without required slots, threshold, confidence, active binding or explicit confirmation produces no side effect.
- The generic sample/polling workflow is a smoke-test/demo configuration, not the ANCFZ production catalog and not approval for public n8n exposure or external CRM credentials.

During multi-turn collection, Node stores only masked slot values and the pending catalog intent in the backend session history. A standalone answer such as `Alice` is accepted only for the catalog's supported `token:NAME` slot; unsupported slot validation rules remain unfilled rather than being sent to a workflow as unvalidated text.

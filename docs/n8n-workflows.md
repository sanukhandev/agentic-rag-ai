# Intent-catalog tool bindings → authorized n8n execution

**Status: TARGET integration upgrade.** Existing repository has `ActionRequest`, PostgreSQL outbox, Redis Streams and n8n bridge; keep them. GPT is the **conversation planner** that selects the customer's Business Goal and proposes relevant catalog tools only when needed. A **Lead capture action is not the primary intent**. Python/LLM may propose a catalog tool, but can never call n8n directly.

## Conversation Engine v2 action boundary

The **Workflow & Event Engine is logical component 7**, not a separate conversational agent. Python's agent may request **read-only Node status/context tools** while planning, or return a **catalog action proposal**. The Node Action Gateway independently requires an authorized goal, correct stage-specific requirements, separate purpose-specific user consent/confirmation and stable idempotency before committing ActionRequest + outbox. Redis/n8n delivery, webhook 2xx and provider evidence are distinct progress levels. **Only verified provider-state policy can advance a stage**.

Do not give Python n8n URLs, Salesforce credentials, uploaded passport bytes, OTP values, or direct write connections. Four reported ANCFZ `/webhook-test/` routes remain disabled pending auth, listener, response contract and callback verification. See [interfaces](conversation-engine-contracts.md), [P5–P6 integration plan](conversation-engine-delivery-plan.md) and [remote registry](remote-n8n-integration.md).

## Catalog-driven tool model

Add or extend reviewed tenant-published catalog `ToolBindings` / stage action policies with:

- **`businessGoalKey` + supporting `turnIntentCategory`**, `intentKey`, `stageKey`, `toolKey`, `workflowKey` and published version. Tool activation depends on goal, stage and current user request, not the mere occurrence of a keyword.
- `toolDescription` and allowed **structured** argument schema; no arbitrary URL or code.
- `sideEffectClass` (`read_only`, `crm_write`, `document_transfer`, `invoice_create`, `payment_initiate`, `contract_create`, etc.).
- Required validated fact keys, permitted source scopes, purpose-specific consent and explicit action confirmation policy.
- Allowed from/to stage, required previous provider evidence, dedupe/idempotency template, correlation and callback contract.
- n8n workflow registry reference, provider configuration and authorized status reconciliation mapping.
- If no approved active binding exists, return `TOOL_NOT_AVAILABLE`; never invent a generic fallback workflow. **Some goals require only a grounded answer or clarification, not a document, contact record or n8n workflow.**

Allow model proposals only for advertised tool keys within the **current pinned** catalog. The GPT planner may choose **no tool call** if it should answer a question, clarify business activity, gather a missing document or offer customer guidance first. Keep read-only information lookups inside Node when possible; expensive reasoning calls use Python model gateway but never execute side effects.

## Proposed flow matrix (keys are placeholders; published catalog is authoritative)

| Stage | Intent-derived capability | Workflow result needed |
| --- | --- | --- |
| Lead Generation | create or deduplicate approved Salesforce Lead and notify | remote Lead verified; duplicate associated safely |
| Lead Qualification | persist qualified/not-qualified decision with approved rules; notify if configured | deterministic qualification evidence |
| Account Creation | associate verified Lead with Account/Contact/Opportunity | verified remote associations |
| Package Selection | list eligible packages, generate approved quote and confirm choice | quote + selection revision |
| Document Upload | upload/OCR/review and **SF-02** Salesforce attachment | reviewed content and provider-verified attachment |
| Payment Details & Invoice | issue authorized invoice, optionally initiate **mock-only** payment | invoice reference/artifact hash and distinct payment state |
| Contract | generate approved draft, submit to provider when authorized | provider reference, delivery and signing proof (not just URL) |

Not every "stage" requires an n8n write (e.g. qualification may be deterministic Node-only). Bind actions **when the catalog requires them**; do not manufacture a tool call for the sake of seven calls.

## Two confirmation boundaries

1. **Business goal confirmation:** user confirms the primary outcome sought (e.g. company formation). This does **not** imply consent for CRM Lead creation and does not itself activate a workflow. Knowledge-only users can receive answers without this business-goal confirmation.
2. **Business-action confirmation/consent:** after the LLM identifies a useful next catalog action and Node verifies its prerequisites and purpose-specific consent, the user explicitly approves each eligible external side effect. This controls action execution. Never infer permission from `yes` when the pending prompt belongs to another stage, old journey or ambiguous question.

## Orchestration sequence

```mermaid
sequenceDiagram
  participant C as Customer
  participant N as Node Chat API
  participant DB as PostgreSQL
  participant W as Redis event worker
  participant X as n8n
  participant P as Provider
  C->>N: confirm specific catalog action
  N->>DB: CAS check intent, stage, fact provenance, consent, action revision
  N->>DB: commit ActionRequest + event_outbox atomically
  N-->>C: approved / queued; not externally completed
  DB-->>W: outbox relay to Redis Streams
  W->>X: authenticated bound workflow + opaque action reference
  X->>P: credentialed request
  P-->>X: provider result / external identifier
  X->>N: authenticated correlated callback
  N->>DB: provider verification + idempotent reconciliation
  DB-->>C: next request observes verified stage state
```

## Non-negotiable failure states

- A `202`, n8n `success`, HTTP timeout, local CRM row, produced invoice PDF or signing URL does **not** prove provider completion.
- 429/5xx model retries and n8n provider retries are separate policies. **Never** retry a state-changing provider call without stable idempotency key/provider dedupe/reconciliation.
- Ambiguous remote writes become `reconcile_required` with an operator follow-up path; don't create duplicate Salesforce records.
- Validated callbacks must match exact tenant/session/opportunity/action/stage revision and configured provider signature.
- Keep private n8n credentials and Salesforce OAuth data in their authorized environment; only minimal approved payload is rehydrated for the specific provider operation.

## ANCFZ initial bottleneck

The latest focused scenario created a local Lead ActionRequest and worker execution, but no verified remote Salesforce Lead ID was observed. Before attempting later stages, inspect catalog workflow binding, remote CRM endpoint, n8n credential references, callback authentication and result parsing. Do **not** bypass Lead verification to make a seven-stage run green.

## Required test suite

Tool schema/allowlist, wrong stage, wrong tenant, stale intent document revision, missing consent, confirmation replay, incorrect n8n mapping, duplicate provider timeout, callback replay/late callback, provider ID verification and recovered action. Only an independently verified provider or explicitly labeled sandbox/mock may complete an external gate.

## User-supplied remote workflow inventory

Four n8n webhook-test paths (Lead creation, account verification send/check, Salesforce SF-02 document upload) are now mapped in [`remote-n8n-integration.md`](remote-n8n-integration.md). **Their IDs, auth and provider results are not verified, and no live calls were made.** Do not conflate OTP verification with Account creation or activate an unreviewed URL.

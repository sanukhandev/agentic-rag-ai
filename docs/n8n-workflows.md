# Intent-catalog tool bindings → authorized n8n execution

**Status: TARGET integration upgrade.** Existing repository has `ActionRequest`, PostgreSQL outbox, Redis Streams and n8n bridge; keep them. Python/LLM **may propose** an intent or catalog tool, but can never call n8n directly.

## Catalog-driven tool model

Add or extend reviewed tenant-published catalog `ToolBindings` / stage action policies with:

- `intentKey`, `stageKey`, `toolKey`, `workflowKey` and version.
- `toolDescription` and allowed **structured** argument schema; no arbitrary URL or code.
- `sideEffectClass` (`read_only`, `crm_write`, `document_transfer`, `invoice_create`, `payment_initiate`, `contract_create`, etc.).
- Required validated fact keys, permitted source scopes, purpose-specific consent and explicit action confirmation policy.
- Allowed from/to stage, required previous provider evidence, dedupe/idempotency template, correlation and callback contract.
- n8n workflow registry reference, provider configuration and authorized status reconciliation mapping.
- If no approved active binding exists, return `TOOL_NOT_AVAILABLE`; never invent a generic fallback workflow.

Allow model proposals only for advertised tool keys within the **current pinned** catalog. Keep read-only information lookups inside Node when possible; expensive reasoning calls use Python model gateway but never execute side effects.

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

1. **Intent confirmation:** user confirms the single intended service/journey. This allows catalog-defined fact collection only.
2. **Business-action confirmation/consent:** after prerequisites and scope-specific consent, user explicitly approves each eligible external side effect. This controls action execution. Never infer permission from `yes` when the pending prompt belongs to another stage, old journey or ambiguous question.

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

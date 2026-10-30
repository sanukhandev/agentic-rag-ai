# AGENTS.md — Agentic RAG AI: current engineering contract

**Effective 2026-10-30.** This replaces prior Foundry-agent, 25/200-message, 25-commit and greenfield-build instructions. Read `docs/README.md`, `docs/current-state.md` and `docs/requirements.md` **before** coding. The existing source is the implemented state; these documents define the migration target, not a claim it is already working.

## Mission and acceptance

Build a dependable tenant-configurable conversational sales assistant. The **only acceptance tenant for this phase is ANCFZ**, but never hardcode its slug, intent keys, identity fields, package names, stage rules, URLs, n8n workflow IDs or prices in shared code. Tenant configuration, published catalog and workflow registry are authoritative.

Complete **one customer session and one opportunity** across the seven ordered stages:
1. Lead Generation
2. Lead Qualification
3. Account Creation (only after successful qualification and required explicit confirmation/verification)
4. Package Selection
5. Document Upload, review/OCR and existing Salesforce SF-02 attachment
6. Payment Details & Invoice (differentiate mock payment from real settlement)
7. Contract (signed only with verified provider proof).

The agent must recognize catalog intents, ask **one appropriate next question on every grounded, active-journey response**, confirm the single selected intent with the customer before initiating its requirements/actions, and preserve intent/fact context across knowledge interruptions, corrections, duplicate turns, restarts and provider callbacks. Exceptions: explicit farewell, user refusal/handoff, blocked/error state, or genuinely completed journey (then offer a relevant optional follow-up, not a fabricated requirement). No mandatory 25-turn, 200-message or commit-count quota.

## Target architecture (NOT implemented yet)

Next.js / other validated channels → Node Express API → catalog and per-session intent engine → private Python Model Gateway → GPT deployment via **Azure OpenAI / Foundry Models Responses API using an API key**. Node retrieves approved pgvector evidence, supplies bounded context, validates model interpretations/citations, confirms intent and chooses the next requirement. Node alone authorizes catalog workflow actions and persists them transactionally to PostgreSQL outbox → Redis Streams → event worker → n8n → verified provider callback. Python is an inference-only service: no customer database credentials, n8n webhooks, tenant switching, direct CRM writes or policy authority.

**Do not use the named `agentic-rag-core-dev` Foundry Agent for the target chat path.** Existing v4/v6 integrations remain current historical code until the replacement is implemented and verified. Model deployments are selected by configured deployment name, not by Foundry agent version. Keep a provider-neutral Node boundary for future provider changes.

## Mandatory implementation boundaries

- Node (TypeScript) is the sole external business API and authority for tenant/session scope, catalog publication/version, opportunity/stage state, fact validation, user intent confirmation, consent, tool eligibility, idempotency, outbox and callback reconciliation. Preserve existing public Chat API and Admin API contracts unless explicitly migrated with tests.
- Python (FastAPI proposed) provides strictly typed `normalize`, `interpret`, and `compose` inference operations using approved GPT calls only. It must not select another tenant, mutate DB, invoke n8n, store raw transcript history or accept arbitrary tool URLs. Node supplies an authorized context envelope.
- PostgreSQL persists a **User Intent Document** per active opportunity, with a per-turn append-only assessment trail, normalized query, candidate score evidence, confirmed intent, pinned catalog, fact provenance, pending requirement, stage/action references and revision. Redis holds optional ephemeral caches/locks only, never business truth.
- A real customer may pursue multiple opportunities across time, but a single acceptance run uses one. Corrections and stage transitions cannot silently rebind action, document or consent identity.
- Every intent assessment is durable; cached lookups are keyed by tenant/session/opportunity/catalog/version/turn+context digest, with explicit invalidation and a persistent replay-safe result.
- Catalog keywords/phrases/exclusions and signals determine candidates; an optional GPT interpretation *helps* normalization and slot extraction but **does not unilaterally authorize** or choose a different workflow. Calibrated confidence plus user confirmation selects exactly one primary intent for that opportunity.
- n8n is execution, not planning. The model may produce a **tool proposal** from catalog-defined capabilities, but Node must validate the active binding, prerequisites, purpose-specific consent and explicit action confirmation before dispatch.
- All external writes must have idempotency, webhook auth/correlation, callback verification and reconciliation. HTTP 200/202, local CRUD, n8n success, PDF existence, `mock_paid` and unsigned contracts are not authoritative completion.

## Azure API-key and reliability rules

Use the configured Azure OpenAI **model deployment endpoint** (e.g. resource `/openai/v1/`), NOT a project `/api/projects/...` agent endpoint. Keep `AZURE_OPENAI_API_KEY` only in the private Python runtime secret environment; never send to Node/UI, logs, traces, tests or Git. Local development only until key-management and privacy controls are approved.

For transient 408/409/429/5xx and connection/timeout failures, make **one initial attempt plus up to three retries**, respecting `retry-after-ms` / `Retry-After`, exponential backoff and jitter. Disable duplicate nested retries (Python OpenAI SDK `max_retries=3` OR one application retry layer, never both). Enforce bounded total deadline, rate-limit/concurrency budget and circuit breaker. Do not retry invalid requests, auth failures, explicit refusals or side-effecting n8n workflows as model calls. Fail with a typed `MODEL_UNAVAILABLE` after the final unsuccessful attempt; never invent a grounded response.

## Privacy for the prototype

Advanced new PII detection is **deferred**; it is NOT permission to remove existing production-safe controls. Keep authorization, existing PII masking/token vault and consent protections intact during migration. Use synthetic customers while testing. Minimize model payloads, avoid sending identity-document bytes or payment credentials, and mask email/phone/contact data where not required for an inference operation. Revisit explicit PII-filter scope before any real-customer traffic. Do not disable audited security boundaries for convenience.

## Engineering process

1. Compare implementation with `docs/current-state.md`; update it whenever a gap is closed.
2. Implement in small additive phases from `docs/migration-plan.md`, not a sweeping replacement.
3. Follow `docs/architecture.md`, `docs/intent-engine.md`, `docs/user-intent-document.md`, `docs/model-gateway.md`, `docs/journey.md` and `docs/n8n-workflows.md` for target contracts.
4. Preserve migrations, data, code and evidence until compatibility cutover and rollback are verified. Never delete existing Foundry code simply because it is not the target.
5. Unit/integration-test deterministic scoring, candidate ambiguity, confirmation, exact one-question progression, cache invalidation, retries, outage, conversation continuity, cross-tenant isolation, action dedupe and callbacks.
6. Run typecheck, lint, tests, build, Compose/security tests and one complete seven-stage journey using authorized sandbox/mock providers with truthfully labeled external evidence. No fabricated results.
7. Update the canonical docs and `docs/current-state.md` with exact code paths and measured pass/fail/blocked results. Preserve dated `docs/verification` artifacts as **historical evidence**, not instructions.
8. Do not push, merge, promote Azure resources, trigger real charges/signatures or change production credentials without explicit approval.

## Single read order for coding agents

`docs/README.md` → `docs/current-state.md` → `docs/requirements.md` → `docs/architecture.md` → `docs/intent-engine.md` → `docs/user-intent-document.md` → `docs/model-gateway.md` → `docs/journey.md` → `docs/n8n-workflows.md` → `docs/migration-plan.md` → `docs/acceptance.md`.

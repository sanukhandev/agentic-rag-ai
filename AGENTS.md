# AGENTS.md — Agentic RAG AI: current engineering contract

**Effective 2026-10-30.** This replaces prior Foundry-agent, 25/200-message, 25-commit and greenfield-build instructions. Read `docs/README.md`, `docs/current-state.md` and `docs/requirements.md` **before** coding. The existing source is the implemented state; these documents define the migration target, not a claim it is already working.

## Mission and acceptance

Build a dependable tenant-configurable **LLM-led conversational sales advisor**. ANCFZ is the **only acceptance tenant for this phase**, not a hardcoded exception in shared code. The customer's **business goal** (e.g., company formation) is primary; **knowledge questions, requirement gathering, clarification, status and workflow execution** are supporting turn intents. **CRM Lead capture is a conditional workflow capability, never the universal primary customer intent.** The approved catalog defines valid goals, categories, requirements, questions, tool bindings, stage sequences and completion criteria. Tenant configuration, published catalog and workflow registry are authoritative.

Complete **one customer session and one opportunity** across the seven ordered stages:
1. Lead Generation
2. Lead Qualification
3. Account Creation (only after successful qualification and required explicit confirmation/verification)
4. Package Selection
5. Document Upload, review/OCR and existing Salesforce SF-02 attachment
6. Payment Details & Invoice (differentiate mock payment from real settlement)
7. Contract (signed only with verified provider proof).

The **GPT conversation planner is the master of conversation delivery**: each substantive turn it interprets the full bounded conversation summary, weighs published catalog signals and previously verified facts, selects the best next move (answer RAG, clarify, confirm goal, collect a fact/document/contact, check status, propose an allowed action, complete goal), and drafts **one contextually useful follow-up**. The primary business goal remains bound to the opportunity through supporting sub-intents. Node validates the planner's catalog keys, proposed weights, allowed next moves, fact updates and tool eligibility; only Node performs business changes. Every factual business answer uses approved RAG/provider/catalog evidence. Once the **business goal**, not merely the CRM Lead, is verified fulfilled, ask if the customer needs more help. Do not ask duplicate requirements or unnecessarily collect PII for knowledge-only queries. See `docs/intent-taxonomy.md` and `docs/conversation-planner.md`. No 25-turn/200-message/commit-count quota.

## Target architecture (NOT implemented yet)

Next.js / other validated channels → Node Express API → catalog and per-session intent engine → private Python Model Gateway → GPT deployment via **Azure OpenAI / Foundry Models Responses API using an API key**. Node retrieves approved pgvector evidence, supplies bounded context, validates model interpretations/citations, confirms intent and chooses the next requirement. Node alone authorizes catalog workflow actions and persists them transactionally to PostgreSQL outbox → Redis Streams → event worker → n8n → verified provider callback. Python is an inference-only service: no customer database credentials, n8n webhooks, tenant switching, direct CRM writes or policy authority.

**Do not use the named `agentic-rag-core-dev` Foundry Agent for the new chat path.** Its SDK/tool source was retired in `refactor/python-conversation-core-v2`; historical PostgreSQL migration and verification evidence remain untouched. The Python gateway and Node compatibility adapter are the first slice only—the new goal-first conversation coordinator is not yet implemented. Model deployments are selected by configured deployment name, not by Foundry agent version. Keep a provider-neutral Node boundary for future provider changes.

## Mandatory implementation boundaries

- Node (TypeScript) is the sole external business API and authority for tenant/session scope, catalog publication/version, opportunity/stage state, fact validation, user intent confirmation, consent, tool eligibility, idempotency, outbox and callback reconciliation. Preserve existing public Chat API and Admin API contracts unless explicitly migrated with tests.
- Python (FastAPI proposed) provides a **primary structured `plan` task** (goal/turn category, model-guided weighting within catalog bounds, context summary, next move/question), plus `normalize` and `compose` inference operations using approved GPT model calls. It must not select another tenant, mutate DB, invoke n8n, store raw transcript history or accept arbitrary tool URLs. Python proposes; Node owns validated persisted decisions and action execution. Node supplies an authorized context envelope.
- PostgreSQL persists a **User Intent Document** per active opportunity, with a per-turn append-only assessment trail, normalized query, candidate score evidence, confirmed intent, pinned catalog, fact provenance, pending requirement, stage/action references and revision. Redis holds optional ephemeral caches/locks only, never business truth.
- A real customer may pursue multiple opportunities across time, but a single acceptance run uses one. Corrections and stage transitions cannot silently rebind action, document or consent identity.
- Every intent assessment is durable; cached lookups are keyed by tenant/session/opportunity/catalog/version/turn+context digest, with explicit invalidation and a persistent replay-safe result.
- **LLM-led intent assessment every substantive turn:** supply a bounded verified conversation summary and compact approved catalog goals/intents/categories/signals/requirements/actions. GPT identifies competing business goals, recognizes a supporting turn intent, proposes evidence-based weighting within published policy bounds and chooses the next high-information question or grounded knowledge answer. Node verifies candidate catalog membership and scoring constraints and persists the full assessment. Keep separate **goal match confidence**, **requirement fulfillment coverage**, and **action readiness**. Require customer confirmation for a new primary business goal before executing its side-effectful workflow; never infer consent from confirmation.
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
3. Follow `docs/architecture.md`, `docs/intent-taxonomy.md`, `docs/conversation-planner.md`, `docs/intent-engine.md`, `docs/user-intent-document.md`, `docs/model-gateway.md`, `docs/journey.md` and `docs/n8n-workflows.md` for target contracts.
4. Preserve migrations, data, code and evidence until compatibility cutover and rollback are verified. Never delete existing Foundry code simply because it is not the target.
5. Unit/integration-test deterministic scoring, candidate ambiguity, confirmation, exact one-question progression, cache invalidation, retries, outage, conversation continuity, cross-tenant isolation, action dedupe and callbacks.
6. Run typecheck, lint, tests, build, Compose/security tests and one complete seven-stage journey using authorized sandbox/mock providers with truthfully labeled external evidence. No fabricated results.
7. Update the canonical docs and `docs/current-state.md` with exact code paths and measured pass/fail/blocked results. Preserve dated `docs/verification` artifacts as **historical evidence**, not instructions.
8. Do not push, merge, promote Azure resources, trigger real charges/signatures or change production credentials without explicit approval.

## Single read order for coding agents

`docs/README.md` → `docs/current-state.md` → `docs/requirements.md` → `docs/intent-taxonomy.md` → `docs/conversation-planner.md` → `docs/architecture.md` → `docs/intent-engine.md` → `docs/user-intent-document.md` → `docs/model-gateway.md` → `docs/journey.md` → `docs/n8n-workflows.md` → `docs/migration-plan.md` → `docs/acceptance.md`.

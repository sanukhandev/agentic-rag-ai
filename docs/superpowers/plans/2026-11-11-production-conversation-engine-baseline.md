# Production Conversation Engine Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the active hybrid chat path with one model-led, catalog-driven conversation coordinator that produces natural grounded replies, preserves the public chat API, and reaches quotation generation through an authorized workflow boundary.

**Architecture:** Node owns tenant/session scope, the pinned persona and published intent catalog, the durable User Intent Document, trusted read tools, response validation, and all side effects. Python owns one bounded planning/tool/composition cycle. The customer receives one Persona Composer response or one approved tenant fallback; no legacy planner or Node heuristic may compete for response ownership.

**Tech Stack:** Node.js/TypeScript, FastAPI/Python, Azure OpenAI Responses API, PostgreSQL/pgvector, Redis Streams, n8n, Docker Compose, Vitest, pytest.

**Spec:** `docs/conversation-engine-architecture.md`, `docs/conversation-engine-contracts.md`, `docs/persona-response-contract.md`, `docs/agent-tool-loop.md`, `docs/conversation-engine-delivery-plan.md`, `docs/conversation-engine-evaluation.md`, `docs/acceptance.md`.

## Global Constraints

- The public Node chat/session/action/document contracts remain compatible unless a contract test proves an explicit migration is required.
- The published tenant catalog and session-pinned persona are authoritative; shared code must not hardcode ANCFZ business content or Zara.
- Python has no database, Redis, n8n, CRM, provider, credential, document-byte, or arbitrary-URL access.
- Node validates every model key, fact, evidence reference, tool call, question, consent, action, and state revision before persistence or execution.
- Redis is transport/cache only; PostgreSQL remains the source of truth.
- Existing masking, token-vault, authorization, migration, data, SSL, and callback controls remain intact.
- No session rows are deleted. Local lead cleanup, if later requested, is limited to the approved lead tables and is dry-run first.
- The supplied n8n paths and payload shapes are used with synthetic data only; secrets remain environment-only.
- No Docker image, VM, remote workflow, real Salesforce record, payment, or signature is declared successful without independently verified evidence.
- Full unit tests must pass before Docker build; Docker/API journey testing must pass before any VM promotion.

## Review Focus

- A knowledge interruption must answer from approved RAG/catalog evidence and preserve the same goal, stage, and pending requirement.
- A repeated quote/package question must produce a contextual continuation, not the same package list or generic fallback.
- A document-stage turn must request the catalog-required document exactly when eligible and never expose internal requirement keys.
- A model/RAG/tool outage must produce a typed tenant-persona fallback without inventing a fact, action, quote, or provider result.
- A stale or replayed message/action/callback must not mutate state or dispatch a duplicate workflow.
- The lead is a conditional action, not the primary intent; knowledge-only customers must not be pushed into CRM.
- A quotation must use the pinned catalog/package revision, explicit customer confirmation, idempotency, and a truthful pending/completed state.

---

## 1. Scope and file inventory

The new branch starts clean from `origin/main`. The following inventory is the change boundary. “Remove” means remove from active source and delete after import/tests prove there are no required callers. Historical migrations and dated evidence are not deleted.

### Keep unchanged unless a compiler or contract test requires an adapter

- `infra/postgres/001-073*.sql` — historical schema and rollback evidence; never rewrite or squash.
- SSL certificates, keys, nginx SSL configuration, and deployment secrets — never remove or rename.
- `services/api/src/actions.ts`, `event-bus.ts`, `event-relay.ts`, `event-worker.ts` — preserve the outbox, Redis Streams, n8n dispatch, callback, retry, and reconciliation boundary.
- `services/api/src/knowledge.ts`, `search-query.ts`, `embedding.ts` — preserve approved pgvector retrieval and masking; expose them only through the trusted tool gateway.
- `services/api/src/conversation/catalog.ts`, `catalog-runtime.ts`, `catalog-xlsx.ts`, catalog Admin routes, and published catalog fixtures — keep as the authoritative V2 catalog implementation, with tests strengthened where needed.
- `services/api/src/conversation/response-guard.ts` — retain the trust boundary, but remove any response-authoring behavior that competes with the Persona Composer; deterministic approved fallback remains allowed.
- `services/api/src/routes/admin.ts`, `apps/admin`, `apps/web`, authentication, privacy, document upload/download, lifecycle/provider callback routes — preserve public/admin behavior and rewire only their chat dependencies.
- `docs/verification/**` — retain as historical evidence and label new reports with the new branch/date.

### Rewrite fresh as the active engine

- `services/api/src/conversation/coordinator.ts` — replace `V2ConversationCoordinator` with the sole `ConversationTurnCoordinator` and its typed request/result boundary.
- `services/api/src/conversation/planning.ts` and `services/api/src/python-model/contracts.ts` — replace mixed planner/composer contracts with one strict `TurnPlan`, `ToolRequest`, `ToolResult`, `PersonaResponse`, and guard-result contract.
- `services/api/src/conversation/tool-gateway.ts` — keep the file but rewrite the active registry and handlers around published catalog bindings and read-only tools only.
- `services/api/src/conversation/fallbacks.ts` — keep only versioned tenant-persona fallback templates keyed by typed failure class.
- `services/api/src/python-model/chat-model-adapter.ts` — replace V1 plan/normalize/summary calls with one authenticated `/internal/v2/conversation/turn` client plus bounded deadline/retry handling.
- `services/model-gateway/gateway/app.py` — expose only health, grounding-review if still required, and the new V2 conversation-turn endpoint; remove V1 runtime routes.
- `services/model-gateway/gateway/agent.py`, `graph.py`, `persona_composer.py`, `v2_contracts.py`, `tool_definitions.py` — recreate as one bounded Python agent implementation with strict schemas, read-tool loop, final composition, and no side effects.
- `services/api/src/index.ts` — instantiate the new coordinator unconditionally for chat and fail fast when its private model configuration is incomplete.
- `services/api/src/app.ts` — preserve authentication, dedupe, session creation, public response mapping, actions, documents, and callbacks; replace the 1,800–2,758 chat implementation with a thin call to the coordinator.

### Remove from active execution and delete after migration

- `services/api/src/conversation/turn-controller.ts` and `turn-controller.test.ts` — delete the orchestration layer containing competing package/document/contact heuristics after its verified behavior is covered by coordinator tests.
- `services/api/src/agent-tools.ts` and `agent-tools.test.ts` — delete the legacy model-driven tool planner after all read tools are registered in `conversation/tool-gateway.ts`.
- Chat-authoring functions in `services/api/src/model.ts` and their tests — remove deterministic greeting, lead-first, package, knowledge, and fallback authors. Move only genuinely shared evidence/CRM-summary types to the new contract module.
- `services/api/src/conversation/knowledge-preflight.ts` and any duplicate preflight path — delete if the new coordinator’s typed read-tool loop covers the same call; otherwise retain as a pure read helper with no reply authoring.
- `scripts/check-v2-retirement-safety.mjs`, `check-v2-retirement-safety.test.mjs`, `check-v2-runtime-safety.mjs`, and `check-v2-runtime-safety.test.mjs` — replace scaffolding-specific checks with one active-boundary verifier.
- `/internal/v1/model/plan`, `/normalize`, and `/summarize` contracts/routes and their dedicated tests — remove after CRM summary is moved to a separate non-chat summary adapter or explicitly retained as a separately named service contract.

### Keep only as compatibility/rollback adapters, never as chat decision makers

- `services/api/src/conversation-state.ts`, `intent-journey.ts`, `journey-engine.ts` — retain the minimum projection/callback functions required by existing workflow/document/admin routes; the new coordinator reads/writes the User Intent Document as the conversational authority.
- `services/api/src/intent-catalog.ts` and `conversation/catalog-migration.ts` — retain legacy catalog import/migration/admin compatibility only; no new chat turn may call the legacy scorer.
- Foundry binding types and migration/store methods — retain for rollback/data compatibility but remove all runtime chat imports.
- `services/api/src/python-model/chat-model-adapter.ts` summary support — retain only if the CRM summary route still needs it, under a separate summary client that cannot enter chat.

### Add or extend

- `services/api/src/conversation/turn-snapshot.ts` — build one verified per-turn snapshot from tenant, session, opportunity, pinned catalog/persona, User Intent Document, bounded history, verified facts, current stage, requirements, and action status.
- `services/api/src/conversation/turn-plan-validator.ts` — validate model proposals against catalog membership, current state, evidence, question policy, consent, and state revision.
- `services/api/src/conversation/turn-ledger.ts` — create/merge the User Intent Document and append one accepted/rejected assessment with tool trace, evidence, fallback, and guard outcome.
- `scripts/verify-conversation-engine-boundary.mjs` and its test — assert no legacy chat imports, no Python side effects, no direct n8n URL use by Python, and one active response owner.
- `scripts/acceptance-conversation-journey.mjs` — drive the real API with synthetic messages based on the VM conversation corpus and produce a redacted transcript/metrics report.
- `scripts/verify-remote-n8n-workflows.mjs` — call the supplied Lead and quotation endpoints once each with synthetic payloads, redact secrets/responses, and distinguish HTTP acknowledgement from provider completion.
- `docs/verification/conversation-engine-baseline-2026-11-11.json` — generated only after final validation; no raw PII or secrets.

---

## 2. Task-by-task implementation plan

### Task 1: Freeze baseline and verify the clean starting point

**Files:**
- Read: `docs/current-state.md`, all files listed in `Spec`, current `package.json`, `docker-compose.yml`, and the inventory above.
- Create: `docs/engineering/conversation-engine-baseline-2026-11-11.md` only if a dated baseline is needed for measured results.

**Interfaces:** none; this task prevents scope drift.

- [ ] Record branch, commit, Node/Python versions, tracked files, environment variable names (never values), migration head, and current test commands.
- [ ] Run baseline checks without changing code: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, Python gateway tests, `npm run verify:secrets`, and `npm run verify:compose`.
- [ ] Confirm the clean branch has no local lead/session mutation and no SSL/config deletion.
- [ ] Stop and record any baseline failure before implementation; do not hide it inside the rewrite.

### Task 2: Define the single turn contract first

**Files:**
- Rewrite: `services/api/src/conversation/planning.ts`, `services/api/src/python-model/contracts.ts`.
- Create: `services/api/src/conversation/turn-snapshot.ts`, `turn-plan-validator.ts`, `turn-ledger.ts`.
- Test: `services/api/src/conversation/planning.test.ts`, `turn-plan-validator.test.ts`, `turn-snapshot.test.ts`, `turn-ledger.test.ts`.

**Interfaces:**
- `ConversationTurnInput` consumes tenant/session/message/client id and dependencies from Node.
- `TurnEnvelopeV2` contains the signed scope, revision, pinned catalog/persona, masked message, bounded turns, intent projection, tool allowlist, and budgets.
- `TurnPlan` contains `businessGoalProposal`, `turnIntentCategory`, `factProposals`, `knowledgePlan`, one `nextMove`, one `questionPolicy`, and `summaryPatch`.
- `PersonaResponse` contains only persona version, language, answer, citation IDs, optional next question/key, and decision reference.
- `ConversationTurnResult` contains the public response plus internal redacted audit metadata; no raw model JSON is exposed.

- [ ] Write failing schema tests for unknown keys, tenant/session IDs in Python arguments, unbounded text, invalid catalog keys, more than one question, arbitrary URLs, side-effect tool names, and stale revisions.
- [ ] Implement strict TypeScript/Pydantic-compatible schemas with the exact same field names and enum values.
- [ ] Implement `buildTurnSnapshot()` so the coordinator never reads separate legacy state fragments while planning.
- [ ] Implement `validateTurnPlan()` so model proposals are untrusted until catalog/state/evidence validation succeeds.
- [ ] Implement `commitAcceptedTurn()` around the existing transactional `commitV2IntentTurn()`/CAS store contract; persist rejection/fallback information without mutating verified facts or stage.
- [ ] Run focused contract tests and inspect the serialized payloads on both sides.

### Task 3: Rebuild the Python model gateway as one bounded agent

**Files:**
- Rewrite: `services/model-gateway/gateway/app.py`, `agent.py`, `graph.py`, `persona_composer.py`, `v2_contracts.py`, `tool_definitions.py`.
- Remove: V1 `PlanRequest`, `NormalizeRequest`, `CrmSummaryRequest` runtime routes from `contracts.py`/`app.py` after summary migration decision.
- Test: `services/model-gateway/tests/test_agent.py`, `test_graph.py`, `test_persona_composer.py`, `test_v2_contracts.py`, `test_reliability.py`, plus new `test_conversation_turn.py`.

**Interfaces:**
- `POST /internal/v2/conversation/turn` accepts only `TurnEnvelopeV2` and returns `AgentTurnResultV2`.
- The Python agent may request only Node-advertised read tools and must return correlated tool calls/results.
- The final model generation is Persona Composer; Python returns structured output, never a side effect.

- [ ] Write failing tests for plan → read tool → evidence → composition, no-tool greeting/consent, knowledge-only response, outage fallback signal, tool timeout, stale scope, and prompt injection.
- [ ] Implement one agent loop with bounded model attempts, max tool rounds, shared deadline, rate limiting, circuit breaker, and up to three retries only for transient model failures.
- [ ] Remove direct imports/paths that could access DB, Redis, n8n, CRM, filesystem commands, provider credentials, or arbitrary URLs.
- [ ] Make model/RAG unavailability a typed result consumed by Node; never generate a fabricated answer in Python.
- [ ] Keep CRM summary inference separate from the customer-chat endpoint if it remains required.
- [ ] Run the full Python suite before wiring Node to it.

### Task 4: Rebuild the Node trusted tool gateway and catalog projection

**Files:**
- Rewrite: `services/api/src/conversation/tool-gateway.ts`.
- Modify: `services/api/src/conversation/catalog-runtime.ts`, `catalog.ts`, `knowledge.ts` only where the trusted projection needs a typed source/evidence contract.
- Remove: `services/api/src/agent-tools.ts` after import migration.
- Test: `tool-gateway.unit.test.ts`, `catalog-runtime.test.ts`, `claim-support.test.ts`, `knowledge.test.ts`, new cross-tenant/stale-revision tests.

**Interfaces:**
- Read tools: `get_conversation_context`, `get_persona`, `get_intent_catalog`, `get_journey_state`, `get_missing_requirements`, `search_knowledge`, `get_available_packages`, `get_action_status`.
- Every result includes `toolCallId`, status, bounded result, evidence refs, source/catalog version, and state revision.

- [ ] Generate the allowlist from the pinned catalog and current stage; reject unknown or inactive bindings.
- [ ] Make package/price/document/status evidence source-versioned and scoped to tenant/session/opportunity/catalog revision.
- [ ] Return `temporarily_unavailable`, `stale_state`, `not_authorized`, and `invalid_args` distinctly.
- [ ] Prove wrong-tenant, wrong-stage, arbitrary-tool, arbitrary-URL, and stale-revision calls cannot return business data or execute writes.
- [ ] Ensure RAG is required only for factual claims that need it; greetings, consent, and navigation remain valid without retrieval.

### Task 5: Implement the canonical `ConversationTurnCoordinator`

**Files:**
- Rewrite: `services/api/src/conversation/coordinator.ts`.
- Modify: `services/api/src/conversation/response-guard.ts`, `fallbacks.ts`, `user-intent-document.ts`.
- Test: new `conversation-turn-coordinator.test.ts`, `response-guard.test.ts`, `persona-quality.test.ts`, `user-intent-document.test.ts`.

**Interfaces:**
- `ConversationTurnCoordinator.run(input: ConversationTurnInput): Promise<ConversationTurnResult>` is the only active chat orchestration entry point.
- Order: authorize snapshot → call Python → execute authorized read tools → replan/compose → validate guard → CAS commit → return public response.

- [ ] Write failing transcript-level tests for continuity, package quote follow-up, document request, knowledge interruption, correction, opt-out, human handoff, model outage, RAG outage, and repeated message.
- [ ] Implement the coordinator using `buildTurnSnapshot`, the typed Python client, `validateTurnPlan`, `createV2ToolGateway`, `guardV2Response`, and `commitAcceptedTurn`.
- [ ] Allow one approved tenant-persona fallback only when the typed failure requires it; do not route to legacy `model.ts` replies.
- [ ] Enforce at most one purposeful question and suppress it only for farewell, opt-out, closed, handoff, or action-pending states.
- [ ] Record model/tool/guard/fallback metrics and redacted failure reasons for every turn.
- [ ] Prove an identical `clientMessageId` replays the persisted answer with zero model/tool/n8n calls.

### Task 6: Replace the public chat route with a thin adapter

**Files:**
- Modify: `services/api/src/app.ts`, `services/api/src/index.ts`, `services/api/src/chat-stream.ts`, `services/api/src/chat-turn-queue.ts` only as required for the coordinator result.
- Delete after migration: `services/api/src/conversation/turn-controller.ts`, `agent-tools.ts`, and their tests.
- Test: `app.test.ts`/chat route tests, `chat-stream.test.ts`, `chat-turn-queue.test.ts`, public contract tests.

- [ ] Preserve session authentication, masking, access-token authorization, idempotency, cache replay, response shape, streaming, and error status codes.
- [ ] Remove the `CONVERSATION_ENGINE_V2_TENANTS` split and the legacy branch; the new coordinator is the only active chat path.
- [ ] Remove chat-specific deterministic helper calls from `app.ts`; keep business workflow callback/document/admin routes unchanged.
- [ ] Make startup fail closed if the private model gateway or required catalog/persona configuration is unavailable.
- [ ] Assert every `/api/v1/chat/messages` response has passed the coordinator guard or an approved fallback.

### Task 7: Make the User Intent Document the conversational source of truth

**Files:**
- Modify: `services/api/src/types.ts`, `store-memory.ts`, `store-postgres.ts`, `conversation-state.ts`, `intent-journey.ts`, `journey-engine.ts`.
- Migration: add the next numbered migration only if schema inspection confirms missing fields; never edit `056-073`.
- Test: store CAS/replay tests, PostgreSQL integration tests, lifecycle/provider callback tests.

- [ ] Map the coordinator snapshot and accepted plan to one `(tenant, session, opportunity, catalogVersion, personaVersion)` document.
- [ ] Persist candidate goal evidence, accepted goal, turn category, verified fact provenance, pending requirement, question, tool refs, source refs, guard/fallback result, and revision.
- [ ] Preserve the existing `conversationState` projection for workflow/admin compatibility, but prohibit it from overriding the User Intent Document during planning.
- [ ] Add additive JSONB/audit columns only when needed for replay diagnostics; document every new field and index.
- [ ] Prove CAS conflicts replan or return a typed retry without applying stale state.

### Task 8: Rewire catalog-driven actions and supplied n8n workflows

**Files:**
- Modify: `services/api/src/actions.ts`, `event-bus.ts`, `event-worker.ts`, `app.ts` action confirmation routes, catalog workflow-binding validation, `.env.example`, `docker-compose.yml`.
- Create: `scripts/verify-remote-n8n-workflows.mjs` and tests.
- Keep secrets only in ignored local/VM environment files; never commit the supplied key.

**Required remote configuration:**
- Base URL: `https://ai.techcarrot.ae`.
- Lead path: `/n8n/webhook/salesforce-lead` with synthetic `{Name,Company,Phone,Email,Description}`.
- Quotation path: `/n8n/webhook/generate-quotation` with the supplied `x-api-key`, synthetic customer/account/package/items, and no real customer PII.

- [ ] Resolve each workflow from the published catalog binding; do not infer it from a keyword or let Python choose a URL.
- [ ] Enforce separate business-goal confirmation, action confirmation, purpose-specific consent, prerequisites, catalog/package revision, and stable idempotency.
- [ ] Keep the existing outbox → Redis → n8n → authenticated callback → provider verification sequence.
- [ ] Report HTTP 200/202, n8n execution, PDF creation, and provider completion as separate states.
- [ ] Run each supplied remote endpoint once, redact response bodies, and mark 404/unavailable as an external blocker rather than retrying side effects.
- [ ] For local API acceptance, use a deterministic/mock workflow only when clearly labeled; quote generation must reach the workflow boundary and return a truthful status.

### Task 9: Remove conflicting runtime files and update configuration

**Files:**
- Delete only after `rg` import checks are empty: legacy chat model files/functions, V1 model gateway contracts/routes, old turn controller, old agent tools, and obsolete retirement scripts listed in the inventory.
- Modify: `package.json`, workspace scripts, `.env.example`, `docker-compose.yml`, `scripts/verify-compose.mjs`, `docs/current-state.md`, `docs/migration-plan.md`.
- Do not modify: SSL files, migration history, data volumes, or historical verification files.

- [ ] Run an import graph check before each deletion and compile immediately after each deletion.
- [ ] Remove old feature flags and aliases from active execution; retain only an explicit rollback note in documentation.
- [ ] Ensure Node is the only external business API and Python has only the private turn endpoint.
- [ ] Replace old retirement checks with the new active-boundary verifier.
- [ ] Update `docs/current-state.md` with exact `IMPLEMENTED`, `TESTED`, `BLOCKED`, and `NOT_RUN` statuses; do not claim provider acceptance from mocks.

### Task 10: Final unit-test gate

**Files:** all changed source/test files; generated test reports only under `docs/verification/`.

- [ ] Run Python tests: `PYTHONPATH=services/model-gateway python -m pytest services/model-gateway/tests -q`.
- [ ] Run the full workspace unit suite: `npm run test:unit`.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm run verify:secrets`, `npm run verify:compose`, and `npm run build`.
- [ ] If any test fails, fix the implementation and rerun the failing scope plus the full unit suite; do not proceed to Docker with a failing suite.
- [ ] Require zero legacy active-path imports, zero secret findings, zero type/lint failures, and zero unit failures before the Docker gate.

### Task 11: Local Docker and API-level natural journey

**Files:** `docker-compose.yml`, acceptance scripts, generated redacted report.

- [ ] Build the local images with `docker compose build`.
- [ ] Start the stack and verify PostgreSQL, Redis, model gateway, API, worker, event relay, n8n, web, admin, ingestion, quote-PDF, mock-payment, and nginx health checks.
- [ ] Run migrations idempotently; do not reset sessions or truncate shared tables.
- [ ] Drive the real `/api/v1/chat/sessions` and `/api/v1/chat/messages` endpoints with synthetic conversation history covering: greeting, company-formation goal, catalog clarification, knowledge interruption, contact/consent, lead action confirmation, package selection, quotation request, quote status, and document request.
- [ ] Assert catalog version and persona remain pinned, RAG evidence is used for factual claims, one purposeful follow-up is selected, no duplicate answer is emitted, and no internal keys leak.
- [ ] Assert quotation reaches the configured workflow boundary only after confirmation and reports queued/completed/reconciliation truthfully.
- [ ] Save the transcript and metrics report without raw PII or secrets.

### Task 12: VM promotion gate and final review

**Files:** deployment scripts/config only after local acceptance; no SSL changes.

- [ ] Verify remote n8n Lead and quotation paths are available and their callback/provider contracts are known; otherwise report `INTEGRATIONS_BLOCKED`.
- [ ] Deploy the tested image to VM using the existing migration runner and rollback procedure; never delete VM migrations, sessions, RAG data, or SSL files.
- [ ] Pull the latest branch/PR only after review, flush/import only the explicitly approved vector/database scopes, and record counts before/after.
- [ ] Run the same API-level synthetic conversation on VM, then replay the VM conversation corpus and inspect all transcripts manually for naturalness and continuity.
- [ ] Do not merge or report complete until the first failing boundary is either fixed and retested or recorded as an explicit external blocker.

---

## 3. Acceptance criteria

The change is accepted only when all of the following are true:

1. There is one active customer-facing conversation coordinator and one normal response author.
2. The model receives the verified bounded context and chooses the next dialogue move; Node validates but does not silently replace it with an unrelated heuristic answer.
3. Intent catalog, pinned persona, User Intent Document, RAG evidence, and stage requirements are present in the same turn snapshot.
4. Knowledge-only questions do not create CRM actions or collect unnecessary PII.
5. Goal confirmation, action confirmation, consent, and provider completion remain distinct.
6. Repeated quote/package turns, corrections, knowledge interruptions, document requests, and outage fallbacks pass transcript-level tests without duplicate answers.
7. All side effects are catalog-bound, idempotent, outbox-backed, callback-correlated, and truthfully reported.
8. Full unit/type/lint/build/Compose/security gates pass before Docker deployment.
9. Local Docker API conversation reaches quotation generation with synthetic data and a truthful workflow status.
10. VM acceptance is labeled `SEVEN_STAGE_SIMULATED`, `SEVEN_STAGE_PROVIDER_VERIFIED`, `CONVERSATION_INTENT_AND_TOOLS_VERIFIED_INTEGRATIONS_BLOCKED`, `PARTIAL`, or `BLOCKED`; no ambiguous green status is allowed.

## 4. Explicit non-goals

- No new autonomous agent per business stage.
- No arbitrary Python tool execution or direct model-to-n8n calls.
- No deletion of migrations, SSL/configuration, sessions, RAG data, historical evidence, or source history.
- No real PII, charges, signatures, or production provider writes during local acceptance.
- No promise of perfect LLM prose; the production guarantee is single ownership, grounded evidence, truthful failure, durable state, and measurable replay quality.

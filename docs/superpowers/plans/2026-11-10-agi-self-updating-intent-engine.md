# AGI Self-Updating Intent and Natural Conversation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed versioned conversation runtime with one neutral GPT-first conversation engine, a protected canonical intent catalog, and a tenant-scoped self-updating vocabulary lifecycle while preserving public APIs and seven-stage business safety.

**Architecture:** Perform a full neutral-module rewrite under `services/api/src/conversation/` and one model-gateway execution path. Use HTTP only for authenticated session bootstrap/resume and a WebSocket turn/event stream for active conversations. Redis holds bounded active context, summaries, immutable instruction fragments, locks, and resumable event streams; PostgreSQL remains the source of truth for verified state, facts, consent, actions, stages, and provider evidence. Node remains the authority for state, catalog/persona pins, tool authorization, evidence, consent, persistence and external actions; Python/Azure remains inference-only and chooses read tools through a bounded loop. Since this is a development cutover, migrate all callers and delete old v1/v2 runtime code instead of preserving planner compatibility aliases.

**Tech Stack:** TypeScript/Express, PostgreSQL migrations and Store interface, Redis/outbox/n8n, FastAPI/Pydantic, Azure OpenAI Responses API, LangGraph where useful, Vitest, pytest, Docker Compose, synthetic Azure-backed E2E.

**Spec:** `docs/superpowers/specs/2026-11-10-agi-self-updating-intent-engine-design.md`, with requirements from the user task and `AGENTS.md`.

## Global Constraints

- One active conversation controller; do not create V3/V4 or a parallel planner runtime.
- Every incoming message reaches the model controller when the model runtime is enabled; lexical rules cannot decide whether GPT is consulted or force a tool call.
- Redis context is a rebuildable cache; loss or eviction must recover from PostgreSQL without losing verified state.
- Customer turns and server progress use ordered, resumable WebSocket events backed by Redis Streams; HTTP responses do not wait for provider work.
- Transient model/read-tool/Redis/transport work uses an initial attempt plus at most three retries at 3s, 6s, and 12s. Non-transient validation and non-idempotent side effects are not retried.
- GPT may select only typed, tenant-scoped, Node-authorized read tools; it cannot write CRM, call n8n, access databases, or use arbitrary URLs.
- The customer’s business goal is primary; CRM Lead creation is a conditional workflow capability.
- All seven stages remain ordered and provider-evidence gated.
- RAG sources/chunks/embeddings/citations are immutable to conversation and learning runtime.
- Only intent vocabulary may self-update; documents, products, prices, requirements, policies, workflows and action authorization cannot self-update.
- Preserve auth, token vault, consent, masking, secret redaction, callback authenticity, idempotency and tenant isolation.
- Use Azure model deployments and synthetic data for integration tests; never use hardcoded test responses as live evidence.
- Do not push or merge until all acceptance/security gates pass; create a merge-ready PR only after final review.

## Review Focus

- A greeting, farewell, general chat, ambiguous goal, or knowledge-only question must use the same model controller without forced RAG/CRM capture.
- An unseen expression must identify a registered goal semantically without mutating the published catalog.
- A short acknowledgement or correction must resolve against the current pending question and conversation history without repeating collected facts.
- A multi-part question must be answered from all relevant approved evidence, with unsupported parts clearly marked rather than silently omitted.
- A model-proposed CRM Lead/quote/PDF action must be blocked unless catalog requirements, consent, explicit confirmation, idempotency and provider evidence gates are satisfied.
- A vocabulary candidate must be rejected for negation, hypothetical language, quotation, PII, cross-tenant provenance, duplicate meaning, or ambiguous intent.
- A republished catalog/vocabulary must not change an active session’s pinned snapshot.
- Prompt injection in customer messages, RAG text, tool output, or candidate phrases must never become instructions or authorization.
- The RAG checksum and source metadata must remain unchanged after conversations and learning tests.
- Repeated failures must produce a diagnosis and decision request rather than an unbounded repair loop.
- The external assistant payload is a natural string; internal proposals and safety metadata never leak into the customer message.

---

### Task 1: Freeze baseline and rewrite inventory

**Files:**
- Create: `docs/verification/agi-rewrite-baseline-2026-11-10.md`
- Create: `docs/verification/agi-rag-integrity-baseline-2026-11-10.json`
- Modify: `docs/current-state.md`
- Modify: `docs/engineering/legacy-conversation-retirement-inventory.md`
- Modify: `docker-compose.yml`, Redis/worker/WebSocket configuration only where the baseline shows they are missing

**Interfaces:**
- Consumes: current public routes, current Store methods, current catalog/persona pins, current Azure/Compose configuration.
- Produces: an exact caller/dependency map, current test counts, runtime flag inventory, protected RAG source/chunk checksums, and a list of files safe/unsafe to retire.

- [ ] Step 1: Fetch and verify `origin/main`, record its exact SHA, and ensure this branch is based on that SHA before implementation.
- [ ] Step 2: Run `git status --short --branch`, `rg` inventory for all chat routes/controllers/planners/guards/model adapters, HTTP clients, WebSocket clients, Redis consumers/producers, and record every caller.
- [ ] Step 3: Run baseline typecheck, lint, API tests, Python tests with `PYTHONPATH=services/model-gateway`, Redis/worker/WebSocket health checks, Docker health checks, and the current Azure synthetic conversation without modifying code.
- [ ] Step 4: Record protected source/version/chunk metadata and content hashes using a read-only Store/API query; do not export raw PII or document bytes.
- [ ] Step 5: Classify each versioned module as delete-after-cutover, migrated responsibility, or historical-only; no v1/v2 runtime compatibility alias is planned.
- [ ] Step 6: Update the two baseline documents with exact measured pass/fail/blocked results.
- [ ] Step 7: Stop and ask for a decision if the baseline cannot be reproduced or if a required provider/credential is unavailable after three safe checks.

### Task 2: Define neutral contracts and canonical catalog model

**Files:**
- Create: `services/api/src/conversation/contracts.ts`
- Create: `services/api/src/conversation/catalog.ts`
- Create: `services/api/src/conversation/catalog.test.ts`
- Create: `services/api/src/conversation/README.md`
- Modify: `services/api/src/python-model/v2-contracts.ts` or replace with neutral compatibility exports
- Modify: `services/model-gateway/gateway/contracts.py`
- Modify: `services/model-gateway/gateway/v2_contracts.py` or replace with neutral compatibility exports

**Interfaces:**
- `ConversationEnvelope`, `ConversationProposal`, `ReadToolRequest`, `ReadToolResult`, `ConversationResponse`, `ActionProposal`, `VocabularyCandidateProposal`.
- `CanonicalIntentCatalog`, `BusinessIntent`, `RequirementDefinition`, `BusinessStageDefinition`, `ToolBinding`, `CompletionPolicy`.
- `ConversationContextSnapshot`, `ConversationEvent`, `WebSocketClientMessage`, `WebSocketServerEvent`, and Redis key/TTL contracts.
- All identifiers are catalog-provided and tenant-neutral; no tenant slug or assistant name appears in shared code.

- [ ] Step 1: Write failing schema tests for strict envelope pins, bounded history, catalog membership, typed tool calls, action proposal separation, and unknown-field rejection.
- [ ] Step 2: Run the focused tests and verify they fail for the missing neutral contracts.
- [ ] Step 3: Implement the smallest Pydantic/TypeScript contract pair for the neutral runtime. Do not preserve v1/v2 planner or response contracts; only retain explicitly required external session/action/callback contracts.
- [ ] Step 4: Write failing catalog tests for one goal with seven ordered stages, requirement dependencies, tools, completion evidence, and no copied package/document facts.
- [ ] Step 5: Implement canonical catalog validation/import adapters from the existing workbook/JSON versions; keep stable database version pins and legacy import/export compatibility.
- [ ] Step 6: Verify tests pass and reject orphan goals, duplicate keys, backward dependencies, unsafe evidence classes, disabled tools, and tenant mismatch.
- [ ] Step 7: Verify the external response is a natural string plus separately validated event metadata; no v1/v2 response shape remains in the active contract.

### Task 3: Build one neutral Node conversation boundary

**Files:**
- Create: `services/api/src/conversation/controller.ts`
- Create: `services/api/src/conversation/state.ts`
- Create: `services/api/src/conversation/context.ts`
- Create: `services/api/src/conversation/intent.ts`
- Create: `services/api/src/conversation/knowledge.ts`
- Create: `services/api/src/conversation/tools.ts`
- Create: `services/api/src/conversation/response-guard.ts`
- Create: `services/api/src/conversation/controller.test.ts`
- Modify: `services/api/src/app.ts`
- Modify: `services/api/src/types.ts`
- Modify: WebSocket/session transport wiring and Redis stream consumers/producers

**Interfaces:**
- `ConversationController.handleTurn(input): Promise<ConversationTurnResult>` is the sole public chat turn owner.
- `ConversationStateStore` reads/writes session snapshot, User Intent Document, turn ledger and revisions through existing Store/CAS methods.
- `ConversationContextStore` reads/writes bounded Redis context and summaries, tracks revision/digest/TTL, and reconstructs from PostgreSQL on cache miss or stale data.
- `ConversationStream` accepts authenticated messages and emits ordered resumable events through Redis Streams and WebSocket connections.
- `TrustedReadToolGateway.execute()` exposes all ten read tools only when published catalog/stage policy authorizes them.

- [ ] Step 1: Write failing controller tests proving greetings, general chat, knowledge-only, ambiguous goal, correction, and active-goal interruption all enter the model controller; assert no legacy planner call.
- [ ] Step 2: Run focused tests and verify the current route fails because lexical preflight/legacy paths still own some turns.
- [ ] Step 3: Implement the neutral controller around the existing authenticated session/dedupe boundary and commit accepted response/state atomically.
- [ ] Step 4: Remove lexical tool filtering from `authorizedV2ReadToolsForTurn`; replace it with catalog/stage authorization only. Keep message text as model input, never as a tool permission decision.
- [ ] Step 5: Add model-selected `get_conversation_context` and `get_conversation_history_summary` read tools with bounded summaries, redacted PII, revision/correlation checks, and no raw transcript persistence in Python.
- [ ] Step 6: Add Redis context tests for cache hit, cache miss reconstruction, stale revision, eviction, Redis outage, bounded size, TTL refresh, and no sensitive payloads.
- [ ] Step 7: Add WebSocket/Stream tests for authentication, heartbeat, ordered events, reconnect replay, duplicate client message, pending-entry recovery, dead-letter routing, and no duplicate committed action.
- [ ] Step 8: Add tests for parallel independent reads, sequential dependent reads, stale state, unavailable tool, oversized result, unauthorized tool, and duplicate client message.
- [ ] Step 9: Add transport tests for short-lived session-bound WebSocket tokens, origin/tenant/opportunity enforcement, message size limits, heartbeat timeout, and client reconnection from a last acknowledged sequence.
- [ ] Step 10: Verify controller tests and all existing action/security tests pass before migrating the next caller.

### Task 4: Replace Python gateway with one model-first agent path

**Files:**
- Modify: `services/model-gateway/gateway/agent.py`
- Modify: `services/model-gateway/gateway/graph.py`
- Modify: `services/model-gateway/gateway/tool_definitions.py`
- Create: `services/model-gateway/gateway/tools.py`
- Create: `services/model-gateway/gateway/persona.py`
- Create: `services/model-gateway/gateway/reliability.py` only if existing module cannot support the neutral contract
- Modify: `services/model-gateway/gateway/app.py`
- Create/modify: `services/model-gateway/tests/test_agent.py`, `test_graph.py`, `test_tools.py`, `test_persona.py`

**Interfaces:**
- `ConversationAgent.run(envelope) -> AgentTurnResult` is the only model entry point.
- Model loop: initial reasoning, zero or more authorized read-tool rounds, final persona composition, optional validated action/vocabulary proposals.

- [ ] Step 1: Add failing Azure-client contract tests for model-selected tools, multiple tool rounds, no-tool greeting, tool failure recovery, and bounded retries.
- [ ] Step 2: Add failing tests proving the model sees relevant history/summary, active goal, verified facts, requirements, persona and catalog snapshot.
- [ ] Step 3: Implement one neutral agent path using the current LangGraph loop where it reduces duplication; eliminate direct competing `plan`/legacy conversation ownership from the chat route.
- [ ] Step 4: Simplify final response schema so natural answers are not forced into exact question text or lexical overlap while preserving citation membership, persona, language, privacy and status guards.
- [ ] Step 5: Preserve one initial request plus up to three transient retries, shared turn deadline, circuit breaker, concurrency/rate limits, and typed model-unavailable errors.
- [ ] Step 6: Implement the exact retry schedule: initial attempt, then 3s, 6s, and 12s delays, with a shared turn deadline and jitter only if it does not exceed the deadline. Do not retry auth, validation, policy refusal, or non-idempotent side effects.
- [ ] Step 7: Run Python unit tests, contract tests, Redis failure tests, WebSocket event tests, and a real Azure model smoke test with no mock response path enabled.

### Task 5: Migrate the intent catalog to clear goal-first data

**Files:**
- Create: `services/api/src/conversation/catalog-loader.ts`
- Create: `services/api/src/conversation/catalog-loader.test.ts`
- Modify: `services/api/src/catalog-v2.ts`
- Modify: `services/api/src/catalog-v2-runtime.ts`
- Modify: `services/api/src/catalog-v2-xlsx.ts`
- Modify: `services/api/src/routes/admin.ts`
- Modify: `apps/admin/src/app/services/*` only where the API contract changes
- Modify: neutral catalog fixture(s) under `services/api/src/fixtures/`

**Interfaces:**
- Admin/import output is one `CanonicalIntentCatalog`; workbook is an input/output format, not the runtime taxonomy.
- Company formation content defines seven stages and requirements as data, including lead, qualification, account, package, documents, invoice/payment, and contract gates.

- [ ] Step 1: Write failing semantic catalog tests for direct/indirect/unseen expressions, ambiguous requests, information-only turns, corrections, and goal changes.
- [ ] Step 2: Implement plain-text `description`, `keywords`, `customerExpressions`, `requirements`, `documentsRef`, `steps`, `packagesRef`, `tools`, and `completion` fields with typed metadata only where authorization requires it.
- [ ] Step 3: Migrate existing catalog readers and Admin preview/publish/export to the canonical shape through one adapter; preserve versioning and active-session pins.
- [ ] Step 4: Remove shared runtime references to any tenant-specific slug, name, assistant, package, price, or stage phrase. Keep acceptance data only in tenant fixtures/seed migrations.
- [ ] Step 5: Verify legacy catalog data can be imported, reviewed, published, pinned and exported without activating unreviewed mappings.

### Task 6: Implement the self-updating vocabulary lifecycle

**Files:**
- Create: `infra/postgres/072-intent-vocabulary-learning.sql`
- Create: `services/api/src/conversation/learning.ts`
- Create: `services/api/src/conversation/learning.test.ts`
- Modify: `services/api/src/types.ts`
- Modify: `services/api/src/store-memory.ts`
- Modify: `services/api/src/store-postgres.ts`
- Modify: Admin routes/components for candidate review and rollback
- Create: `services/model-gateway/gateway/vocabulary.py` and tests if evaluation is model-backed

**Interfaces:**
- `observeVocabularyCandidate()`, `validateVocabularyCandidate()`, `evaluateVocabularyCandidate()`, `promoteVocabularyRevision()`, `rollbackVocabularyPhrase()`.
- Candidate status: `candidate`, `evaluating`, `approved`, `rejected`, `promoted`, `rolled_back`.

- [ ] Step 1: Write failing tests for provenance, current-turn-only source, negation/hypothetical/quotation rejection, PII rejection, duplicate/equivalence, ambiguity, cross-tenant isolation, and concurrent CAS updates.
- [ ] Step 2: Add separate vocabulary tables for candidates, evaluations, active phrase revisions and audit transitions; never store them in RAG tables or mutate catalog source documents.
- [ ] Step 3: Implement Node validation against the registered intent and the actual masked customer message; assistant text cannot create a candidate.
- [ ] Step 4: Implement independent evaluation over separate examples/conversations; automatically promote only after two independent eligible conversations plus configured quality gates. Expose an admin read-only audit view with reject/rollback controls; do not require manual approval in this development cutover.
- [ ] Step 5: Publish immutable vocabulary revisions for new sessions and preserve active-session catalog/vocabulary pins.
- [ ] Step 6: Add monitor/rollback records and Admin review endpoints; verify rollback does not delete historical evidence or alter RAG.
- [ ] Step 7: Demonstrate unseen phrase observation, rejection, promotion, recognition in a new session, and rollback in a synthetic test artifact.

### Task 7: Connect model readiness to CRM Lead and quote/PDF actions

**Files:**
- Create: `services/api/src/conversation/actions.ts`
- Create: `services/api/src/conversation/actions.test.ts`
- Modify: `services/api/src/v2-action-gate.ts` or migrate its logic into the neutral action module
- Modify: `services/api/src/business-lifecycle.ts`
- Modify: `services/api/src/event-bus.ts`
- Modify: `services/api/src/app.ts`
- Modify: existing CRM/quote/document provider tests

**Interfaces:**
- `evaluateActionReadiness()` returns separate readiness for `lead.create` and `quote.generate`.
- `authorizeActionProposal()` returns Node-owned action records/outbox events only after purpose consent, explicit confirmation, required facts/package, and idempotency checks.

- [ ] Step 1: Write failing tests for enough-information-but-no-consent, consent-without-action-confirmation, action confirmation, duplicate replay, Lead-before-quote dependency, provider failure, reconciliation, and verified completion.
- [ ] Step 2: Implement model action proposals as catalog keys only; Node resolves bindings and creates separate idempotent action requests.
- [ ] Step 3: Allow one turn to propose both workflows when both are eligible, but execute them in dependency order and report each status truthfully.
- [ ] Step 4: Preserve PDF customer contact fields, quote evidence labels, Salesforce correlation, document upload prerequisites, and provider verification.
- [ ] Step 5: Publish action status and provider verification through Redis Streams/WebSocket events; reconnect must replay status without re-running the action.
- [ ] Step 6: Verify the model cannot skip qualification/account/package/document prerequisites or claim success from mock/PDF/n8n transport evidence.

### Task 8: Migrate every caller and remove competing runtime code

**Files:**
- Modify: `services/api/src/app.ts`, `services/api/src/index.ts`, routes and dependency wiring
- Modify: web/Admin callers only where response fields or route ownership require it
- Remove after reference proof: all obsolete v1/v2 controllers, planners, lexical preflights, response contracts, guard duplicates, and duplicate runtime schemas
- Preserve: migrations, provider adapters, explicitly retained Admin/action/callback contracts, and historical verification evidence

- [ ] Step 1: Add a cutover test that enumerates all public chat entrypoints and asserts they resolve to `conversation/controller.ts`.
- [ ] Step 2: Switch the development route to neutral HTTP session bootstrap plus `/api/chat/stream`; remove the legacy planner call from every request path.
- [ ] Step 3: Run `rg` to prove no active caller imports the retired v1/v2 runtime modules, contracts, or lexical preflights; do not retain compatibility aliases.
- [ ] Step 4: Remove obsolete files in small batches, running typecheck and tests after each batch.
- [ ] Step 5: Confirm no `v3-*`, `v4-*`, or duplicate active engine is introduced; version identifiers needed by migrations remain untouched.

### Task 9: RAG protection and security verification

**Files:**
- Create: `services/api/src/conversation/rag-integrity.test.ts`
- Modify: `services/api/src/knowledge.ts`, `services/api/src/privacy.ts`, `services/api/src/runtime-security.ts` only where tests prove a boundary gap
- Add migration/database role configuration under `infra/postgres/` if current runtime role is not read-only
- Update: `docs/security-operations.md`

- [ ] Step 1: Snapshot source/source-version/chunk metadata and hashes before the new runtime.
- [ ] Step 2: Add tests proving conversation tools and vocabulary learning cannot insert/update/delete sources, chunks, embeddings, citations, ownership or scope.
- [ ] Step 3: Add database permission checks for the conversation role; keep ingestion/admin roles separate.
- [ ] Step 4: Add an explicit development-only switch for the problematic advanced semantic PII rejection layer only if the baseline proves it rejects ordinary valid conversation; production configuration must reject that switch, and token-vault masking, auth, consent, secret redaction, identity-document and payment protections remain enabled.
- [ ] Step 5: Test prompt injection in customer text, RAG text, tool output and candidate phrases.
- [ ] Step 6: Compare after-test checksums and fail the gate on any protected-data change.

### Task 10: Natural conversation and independent evaluation suite

**Files:**
- Create: `tools/agi-evaluation/` dataset, runner, rubric and redacted reports
- Create: `scripts/live-neutral-conversation.mjs`
- Create: `services/api/src/conversation/acceptance.test.ts`
- Modify: `docs/conversation-engine-evaluation.md`, `docs/acceptance.md`

- [ ] Step 1: Generate unseen synthetic conversations covering direct/indirect intent, ambiguity, negative statements, correction, goal change, history lookup, knowledge, packages, documents, CRM consent, quote readiness, tool failure, farewell, injection and learning.
- [ ] Step 2: Use semantic assertions and an independent judge; avoid exact wording and hardcoded assistant turns.
- [ ] Step 3: Run real Azure model executions with `MODEL_MODE=azure`; never use mock responses for acceptance evidence.
- [ ] Step 4: Record intent accuracy, naturalness, context retention, tool selection, evidence grounding, workflow readiness, unauthorized-action count, and judge disagreement.
- [ ] Step 5: Require at least 90% semantic conversation success and intent correctness, zero unauthorized actions, zero cross-tenant exposure, zero RAG mutations, and zero unverified completion claims.
- [ ] Step 6: Re-run any failed scenario after root-cause repair and preserve a redacted transcript plus diagnosis.
- [ ] Step 7: Test WebSocket reconnect, event replay, client timeout, Redis eviction, worker restart, and provider work continuing after the client disconnects.

### Task 11: Documentation and artifact cleanup

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/README.md`, `docs/current-state.md`, `docs/architecture.md`, `docs/conversation-engine-architecture.md`, `docs/conversation-engine-contracts.md`, `docs/model-gateway.md`, `docs/migration-plan.md`, `docs/acceptance.md`
- Remove only after reference scan: superseded plans/specs, generated scratch reports, abandoned experiments, and obsolete runtime documentation
- Preserve: migrations, security/operations docs, required verification evidence, public API docs, and audit artifacts

- [ ] Step 1: Build a reference inventory for every candidate deletion using `rg` across source, CI, Docker, README and scripts.
- [ ] Step 2: Update maintained docs to mark the neutral engine as implemented, list exact paths, explain only retained external contracts, and state measured limitations truthfully.
- [ ] Step 3: Update `AGENTS.md` with the neutral-module ownership, model/history tool contract, vocabulary-only self-update boundary, and loop-exit rule.
- [ ] Step 4: Delete only proven-unused artifacts; run documentation link/reference checks and the full test suite.
- [ ] Step 5: Confirm no shared code-level tenant-specific references remain; acceptance fixtures and migrations may retain tenant data where required.

### Task 12: Full verification, review, commit, push and PR readiness

**Files:**
- Create: `docs/verification/agi-neutral-engine-final-2026-11-10.md`
- Create: `docs/verification/agi-neutral-engine-final-2026-11-10.json`
- Modify: maintained docs only when verification reveals a documented gap

- [ ] Step 1: Run TypeScript typecheck, lint, unit/integration tests, Python compile/tests, ingestion tests, database migration tests, Docker build/health, and security checks.
- [ ] Step 2: Run the complete seven-stage synthetic Azure journey through the WebSocket stream, including natural turns, CRM Lead proposal/confirmation, quote/PDF generation, document stage, payment/contract gates, and truthful blocked provider states.
- [ ] Step 3: Run duplicate/replay/restart/correction/cross-tenant/prompt-injection/RAG-checksum tests, including Redis loss and event replay.
- [ ] Step 4: Verify the exact retry schedule and prove no side-effect is duplicated by model retry, stream redelivery, worker restart, or WebSocket reconnect.
- [ ] Step 5: Restart/evict the development in-memory Redis instance and prove terminal turns, verified facts, action status, and final assistant messages are reconstructed from PostgreSQL and replayable to a reconnecting client.
- [ ] Step 6: Review every failed case. If the same root cause remains after three consecutive repair attempts, stop, record the evidence and ask the user for the decision that changes authority/scope; do not continue blindly.
- [ ] Step 7: Run `git diff --check`, inspect the final diff for secrets, tenant-specific shared code, mock-only acceptance claims, deleted migration dependencies, accidental generated files, and residual v1/v2 runtime references.
- [ ] Step 8: Commit in coherent phases with tests and docs included; do not commit until all mandatory gates are green or explicitly documented as blocked.
- [ ] Step 9: Push `feat/agi-self-updating-data-set`, open a PR to `main`, run CI and start the PR review process. Report exact checks, scores, failures repaired, remaining blockers and merge readiness.
- [ ] Step 10: Do not merge without a separate explicit approval after the PR review reports no blockers.

## Loop-exit and progress protocol

After every task, report:

1. Completed files and tests.
2. Current acceptance score/status.
3. New failures and root cause.
4. Whether the next repair changes code, data, environment, or user authority.
5. Remaining risk and the next bounded action.

If three consecutive attempts reproduce the same root cause without new evidence, stop that workstream and ask one decision question. Decisions that require the user include production/provider credentials, promotion policy, deleting historical artifacts with active consumers, changing public API behavior, or accepting a provider-blocked gate.

## Final deliverables

- One neutral conversation controller and model gateway path.
- One clear canonical intent catalog for company formation and seven stages.
- One tenant-scoped vocabulary learning lifecycle with audit, promotion and rollback.
- One protected read-only RAG boundary.
- One Node-owned CRM/quote/PDF action gateway.
- One independent semantic evaluation suite and redacted final report.
- Updated requirements/architecture/AGENTS documentation.
- Cleaned repository with only proven-needed historical artifacts.
- Commit, pushed branch, and merge-ready PR; merge itself remains separately authorized.

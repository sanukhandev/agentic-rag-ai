# Neutral Runtime, Vocabulary Learning, and Redis Chat Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the active `v2-*` runtime naming, add safe automatic intent-vocabulary promotion with an admin audit surface, and make WebSocket turns durable Redis-stream jobs with reconnect replay.

**Architecture:** Keep PostgreSQL as business truth and the existing Node API as the authority. Rename or consolidate only active runtime modules into neutral `conversation/*` responsibilities; historical migrations and acceptance evidence remain untouched. Redis Streams carry turn jobs/events, while Redis context is cache-only and replay state is rebuilt from PostgreSQL when unavailable.

**Tech Stack:** TypeScript/Express, PostgreSQL stores and migrations, Redis Streams, WebSocket (`ws`), existing Azure Python gateway, n8n workflow bridge, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-10-agi-self-updating-intent-engine-design.md`

## Global Constraints

- No hardcoded assistant/customer response fixtures in production or live tests.
- Node validates tenant scope, catalog membership, authorization, consent, idempotency, persistence, and provider evidence.
- Redis is ephemeral transport/cache only; PostgreSQL remains authoritative.
- Vocabulary learning may change only intent phrases; it must reject PII, negation, ambiguity, assistant text, and cross-tenant data.
- Existing historical migrations and dated verification evidence are preserved.
- Development may use automatic promotion; provider results remain truthful and development/mock-labelled.

## Review Focus

- A Redis outage during a turn must recover from PostgreSQL without losing verified facts or duplicating actions.
- A reconnect must replay only the caller's session events and never duplicate a committed turn or provider action.
- A learned phrase from a negated, quoted, hypothetical, or PII-bearing message must remain rejected.
- A vocabulary candidate must be tenant-scoped and require independent evidence before promotion.
- The provider journey must report pending/blocked states rather than claiming payment or contract completion without evidence.

---

### Task 1: Neutral active conversation runtime cutover

**Files:**
- Create/rename: active runtime modules under `services/api/src/conversation/`.
- Modify: `services/api/src/app.ts`, `services/api/src/index.ts`, `services/api/src/event-bus.ts`, `services/api/src/types.ts`, store interfaces and tests.
- Remove: active imports and runtime references whose only purpose is the `v2-*` name.
- Preserve: historical migrations, dated verification artifacts, and tests that still prove provider/data invariants until replacement tests pass.

**Interfaces:**
- Produces the existing chat route behavior and the existing `Store`, `CacheStore`, `StreamBus`, and provider evidence contracts.
- Exposes neutral names for turn control, tools, planning, response guard, provider evidence, and catalog runtime.

- [ ] **Step 1: Add a failing import/route contract test** proving the application loads the neutral controller and no active app import resolves a `v2-*` runtime module.
- [ ] **Step 2: Run the focused API contract test and confirm it fails because the neutral modules are absent.**
- [ ] **Step 3: Move active modules to neutral names, migrate callers, and remove only obsolete runtime aliases after all callers compile.** Keep behavior unchanged while changing ownership and names.
- [ ] **Step 4: Run the focused controller/provider tests, typecheck, and full API suite.**
- [ ] **Step 5: Run a repository scan excluding historical migrations/evidence and confirm no active runtime import or route requires `v2-*`.**

### Task 2: Automatic tenant-safe vocabulary lifecycle and admin audit

**Files:**
- Create: `infra/postgres/072-intent-vocabulary-learning.sql`, `services/api/src/conversation/vocabulary.ts`, `services/api/src/conversation/vocabulary.test.ts`.
- Modify: `services/api/src/types.ts`, `services/api/src/store-memory.ts`, `services/api/src/store-postgres.ts`, `services/api/src/app.ts`, admin vocabulary service/component/tests.

**Interfaces:**
- `observeCandidate(input): Promise<VocabularyCandidate | null>` records only customer-origin phrases.
- `evaluateCandidate(candidateId): Promise<VocabularyEvaluation>` applies independent-session count, PII/negation/ambiguity checks, and catalog membership.
- `promoteCandidate(candidateId): Promise<PublishedVocabulary>` creates a new catalog revision transactionally and writes an audit event.
- Admin read endpoint returns tenant-scoped candidates, decisions, provenance, revision, and rollback metadata; admin reject/rollback is explicit.

- [ ] **Step 1: Add failing tests for candidate rejection, two-session automatic promotion, tenant isolation, audit visibility, and rollback.**
- [ ] **Step 2: Run them and confirm the lifecycle/store methods are missing.**
- [ ] **Step 3: Add the migration and store methods with optimistic revision checks and append-only audit records.**
- [ ] **Step 4: Implement model-proposed phrase ingestion from customer turns only; reject assistant text, PII, quoted/hypothetical/negative text, duplicates, and ambiguous intent matches.**
- [ ] **Step 5: Expose the protected admin audit/reject/rollback endpoints and minimal Admin view using existing auth roles.**
- [ ] **Step 6: Run vocabulary tests, API tests, and Admin tests.**

### Task 3: Redis-streamed WebSocket turns and reconnect replay

**Files:**
- Modify: `services/api/src/chat-stream.ts`, `services/api/src/index.ts`, `services/api/src/event-bus.ts`, `services/api/src/cache.ts`, `docker-compose.yml`.
- Create: `services/api/src/chat-turn-stream.ts`, `services/api/src/chat-turn-stream.test.ts`.

**Interfaces:**
- WebSocket client sends `authenticate`, then `message` with `clientMessageId` and optional `afterEventId`.
- API publishes a tenant/session-scoped job with an idempotency key to Redis and immediately emits `turn.accepted`.
- Worker claims the job, executes the existing authoritative turn handler once, and publishes `assistant.message`, `turn.completed`, or safe `turn.failed` events.
- Reconnect subscribes from `afterEventId`; PostgreSQL fallback returns the committed turn if Redis history is unavailable.

- [ ] **Step 1: Add failing tests for publish/claim/ack, duplicate clientMessageId, reconnect replay, tenant isolation, and Redis failure fallback.**
- [ ] **Step 2: Run the tests and confirm the stream worker/replay implementation is absent.**
- [ ] **Step 3: Implement bounded Redis Streams with consumer-group recovery, pending-message reclaim, stream trimming, and PostgreSQL idempotency checks.**
- [ ] **Step 4: Wire WebSocket frames to the stream worker and keep the HTTP route as a compatibility transport only.**
- [ ] **Step 5: Run the stream unit tests and a live Nginx WebSocket reconnect test against Azure mode.**

### Task 4: Complete development provider workflow verification

**Files:**
- Modify only provider/n8n adapters and tests required by observed failures.
- Add: `docs/verification/neutral-runtime-seven-stage-2026-11-10.json`.

- [ ] **Step 1: Run the existing local seven-stage acceptance through the real Azure deployment, n8n credential path, Salesforce sandbox readback, quote PDF, document/OCR, payment, and contract adapters.**
- [ ] **Step 2: Record every stage as completed, pending, blocked, or reconciliation-required from authoritative provider evidence.**
- [ ] **Step 3: Fix only reproducible provider/idempotency/reconnect failures with a failing regression test first.**
- [ ] **Step 4: Re-run the full API/Python/Admin/Web suites, Docker Compose health checks, Redis restart/recovery test, and the complete acceptance export.**

### Completion gate

- [ ] Active runtime has one neutral controller and no active `v2-*` import path.
- [ ] Vocabulary lifecycle tests pass and Admin audit is tenant-scoped.
- [ ] WebSocket turns are Redis-streamed, idempotent, replayable, and PostgreSQL-recoverable.
- [ ] Provider test report contains no false completion claims and identifies any external blocker.
- [ ] Commit and push only after all gates pass; do not merge without explicit approval.

## Implementation status — 2026-11-10

- Tasks 1–3 implementation slices are present and live-verified through Docker: neutral source-module filenames/imports, automatic tenant-scoped vocabulary lifecycle with Admin audit controls, and Redis-streamed WebSocket turn jobs with replay/dedupe/reclaim.
- Task 4 is partially complete: the real Azure-mode conversation now exercises n8n-only Lead → package → development/mock quote → authenticated download → requirement-gated document upload. The persistent n8n published history had to be synchronized because rebuilding application containers does not update n8n's database.
- Full provider-backed Account, SF-02, invoice/payment settlement and contract-signature acceptance remains blocked by environment/provider readiness. Unit tests are intentionally not run for this execution; typechecks, builds, Compose validation and live provider/transport checks are the verification evidence.

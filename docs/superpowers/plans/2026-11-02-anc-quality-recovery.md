# ANC Conversation Quality Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify the 23 Azure GPT-5.4 rejected turns, fix only demonstrated evidence/guard/composer defects, and measure model acceptance, relevance and workflow correctness separately.

**Architecture:** Keep Python as the dialogue planner/composer and Node as the trusted evidence, guard and lifecycle authority. Reuse the existing V2 contracts and tool traces; add only the smallest typed evidence conversion or guard correction proven by the turn diagnosis. No lifecycle or database redesign.

**Tech Stack:** TypeScript/Vitest, Python/Pytest, FastAPI LangGraph gateway, Azure OpenAI Responses API, PostgreSQL-backed isolated Docker UAT, Node HTTP runner.

**Spec:** `docs/conversation-engine-architecture.md`, `docs/conversation-engine-contracts.md`, `docs/conversation-engine-evaluation.md`

## Global Constraints

- Do not modify operational PostgreSQL, Redis, Docker volumes or the ignored `.env`.
- Keep tenant/session/opportunity, persona, catalog and source-version checks fail closed.
- Never treat customer facts as legal/provider evidence or model citations as proof without Node matching.
- Do not change the seven-stage lifecycle, action consent, SF-02 evidence tier or payment/contract boundaries.
- Use synthetic customers and redacted reports only; preserve historical reports and unrelated uncommitted files.
- Do not lower safety thresholds merely to raise acceptance; Azure and mock outcomes remain separate.

## Review Focus

- A verified customer fact reflected in natural prose must pass only when its scoped provenance is present; test cross-tenant and conflicting facts.
- An approved journey/status/package/document result must support only the matching claim and current revision; test stale and wrong-opportunity evidence.
- A knowledge question must be answered before the pending requirement is asked, while the pending requirement remains unchanged; test empty and populated RAG.
- A model outage or invalid candidate must return a guarded persona fallback without counting as model-authored acceptance; test telemetry and replay.
- The quality denominator must disclose all model turns and eligible dialogue exclusions; test report aggregation against a fixed fixture.

---

### Task 1: Diagnose and classify the baseline

**Files:**
- Read: `artifacts/ancfz-stage5-api-uat/gate2-retest/final-acceptance-v2/azure-gpt54-conversation-redacted.json`
- Read: `services/api/src/v2-coordinator.ts`, `v2-response-guard.ts`, `v2-evidence.ts`, `v2-tool-gateway.ts`, `app.ts`
- Read: `services/model-gateway/gateway/agent.py`, `persona_composer.py`, `v2_contracts.py`
- Create: `artifacts/ancfz-stage5-api-uat/gate2-quality-recovery/root-cause-analysis.md`
- Create: `artifacts/ancfz-stage5-api-uat/gate2-quality-recovery/candidate-rejection-classification.json`

**Interfaces:**
- Consumes the existing redacted transcript and persisted `v2.model.turn` audit fields.
- Produces exactly one primary class per rejected candidate, or `INSUFFICIENT_DIAGNOSTIC_EVIDENCE` when original candidate text is absent. Later tasks must use this classification rather than assumptions.

- [x] **Step 1: Build a 23-row diagnosis table** from the retained redacted transcript and aggregate audit evidence; turn-specific claims remain bounded where the source lacks candidate text.
- [x] **Step 2: Trace each rejected candidate backward** to the first recorded failure and mark unsupported-claim groups as diagnostically insufficient when claim text is absent.
- [x] **Step 3: Write the redacted reports** without raw PII, credentials, chain-of-thought or unrestricted candidate dumps.
- [x] **Step 4: Verify the diagnosis** by parsing the 23 retained records and checking the allowed primary-category vocabulary.

### Task 2: Fix only demonstrated evidence propagation defects

**Files:**
- Modify only the existing evidence conversion/guard files identified by Task 1.
- Test: the smallest existing Node evidence/guard/coordinator test file.

**Interfaces:**
- Consumes scoped trusted tool results and persisted verified facts already returned by the Node gateway.
- Produces typed evidence with tenant/session/opportunity, source/state revision, category, identifier, value/text and current/authorized status sufficient for the existing guard.

- [x] **Step 1: Write failing tests** for non-search trusted-tool evidence and safe no-evidence dialogue with authorized context.
- [x] **Step 2: Run the focused tests** and confirm the new cases fail for the diagnosed propagation gap.
- [x] **Step 3: Implement the minimum conversion/matching correction** without accepting model-supplied evidence IDs or widening scope.
- [x] **Step 4: Run focused tests** and confirm the new cases pass while existing scope, stale and revoked-evidence cases remain rejected.

### Task 3: Correct claim/category validation and response relevance

**Files:**
- Modify: `services/api/src/v2-evidence.ts`, `services/api/src/v2-response-guard.ts`, `services/api/src/v2-coordinator.ts` only where Task 1 proves a false positive.
- Modify: `services/model-gateway/gateway/persona_composer.py` only where the model is not receiving an authoritative requirement/status/evidence instruction.
- Test: `services/api/src/v2-response-guard.test.ts`, `v2-coordinator.test.ts`, `v2-persona-quality.test.ts`, and Python persona tests.

**Interfaces:**
- Consumes the existing `PersonaComposedResponse` and authorized evidence refs.
- Produces the same response contract, with at most one relevant question and no weakened consequential-claim checks.

- [x] **Step 1: Add failing tests** for authorized non-search evidence and safe dialogue acceptance; no retained evidence justified weakening consequential claim rules.
- [x] **Step 2: Run focused tests to observe RED.**
- [x] **Step 3: Implement minimal evidence and persona-instruction fixes; no broad regex exception or scripted acceptance was added.
- [x] **Step 4: Run focused tests GREEN and inspect delivered responses and guard telemetry.

### Task 4: Separate acceptance, relevance and workflow metrics

**Files:**
- Modify: `tools/qa/ancfz-final-quality-report.mjs` and `tools/qa/ancfz-stage5-api-conversation.mjs` only if required by the evidence.
- Create: `artifacts/ancfz-stage5-api-uat/gate2-quality-recovery/quality-comparison.json`, `azure-acceptance-report.md`, `azure-acceptance-report.json`, `azure-conversation-redacted.json`, `regression-summary.md`, `code-review-summary.md`.

**Interfaces:**
- Consumes redacted model-turn audits and scenario assertions.
- Produces overall acceptance, eligible-dialogue acceptance with explicit exclusions, relevance scoring, workflow correctness and candidate/final fallback counts without counting fallback as GPT acceptance.

- [ ] **Step 1: Add a separate fixed-fixture aggregation test/assertion.** Existing runner metrics were used for this run; a new aggregator was not justified by the evidence.
- [x] **Step 2: Produce the smallest versioned report package without rewriting historical reports.
- [x] **Step 3: Verify the report against the baseline and final 23-turn evidence.

### Task 5: Regression, isolated Azure UAT and review

**Files:**
- Read-only: `docker-compose.anc-mock-uat.yml`, isolated container/env configuration and PR #126.
- Update: `docs/current-state.md` only with measured results and blockers after verification.

- [x] **Step 1: Run Node focused/full tests, Python gateway tests and contract/type checks.
- [x] **Step 2: Rebuild only `model-gateway` and `api` in Compose project `anc-mock-uat`; verify loopback binding, health, Azure deployment and flags without printing secrets.
- [x] **Step 3: Run bounded 25-turn Azure UAT into versioned `gate2-quality-recovery` directories; do not overwrite historical evidence.
- [x] **Step 4: Run mock regression, security regression and lifecycle checks; compare all metrics.
- [x] **Step 5: Perform Ponytail review of changed files and a whole-branch self-review because no reviewer subagent was available.
- [ ] **Step 6: Push the existing branch and update draft PR #126 with actual evidence.** Pending the final commit/report staging in this session.

## Self-review decisions

- The task does not add a new evidence service, database schema, model framework or lifecycle abstraction because the existing contracts and scoped tool traces are sufficient unless Task 1 proves otherwise.
- The live Azure run is bounded to one final 25-turn run after deterministic tests; repeated paid retries are not justified by this acceptance task.
- If original candidate text is unavailable, the report will remain `INSUFFICIENT_DIAGNOSTIC_EVIDENCE` rather than infer a false-positive rate.

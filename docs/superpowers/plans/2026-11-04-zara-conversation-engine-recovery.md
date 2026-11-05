# Zara Conversation Engine Recovery Implementation Plan

> **For agentic workers:** Use the native execution approach in this session. Steps use checkbox syntax for tracking.

**Goal:** Recover the GPT-first Zara conversation path and validate the ANCFZ company-formation journey without weakening grounding or action authorization.

**Architecture:** Keep the existing Node coordinator, turn controller, trusted tool gateway, User Intent Document, outbox, and provider boundaries. Correct only the coupling points found in the live trace: question validation, post-tool evidence eligibility, and candidate-planning persistence.

**Tech Stack:** TypeScript/Express/Vitest/PostgreSQL/Redis/Docker Compose, Python FastAPI model gateway, Azure OpenAI deployment, existing Salesforce/n8n adapters.

**Spec:** `docs/superpowers/specs/2026-11-04-zara-conversation-engine-recovery-design.md`

## Global Constraints

- Node is the sole external business authority; Python proposes and composes only.
- Every customer-visible response uses the session-pinned published persona and passes the Node response guard.
- Every consequential factual answer uses approved tenant-scoped evidence or a Node-minted grounding proof.
- Business goal confirmation is separate from contact consent, action authorization, and provider completion.
- Do not delete historical migrations, production-safe controls, or rollback paths.
- Tests and live evaluations use synthetic development data and truthful PASS/FAIL/BLOCKED_EXTERNAL_DEPENDENCY/NOT_RUN statuses.

## Review Focus

- A valid cited answer with malformed optional question metadata must survive with the question suppressed; required questions remain strict.
- Evidence returned by `search_knowledge` after model tool execution must be source/version/scope checked and eligible for one bounded repair.
- A valid candidate planning proposal must still reach Node confirmation when the generated answer is rejected.
- Knowledge-only questions must not create an opportunity or Lead, and an existing pending goal prompt must survive knowledge interruption.
- Refusal, correction, duplicate message, stale revision, and provider timeout must preserve authoritative state and never fake completion.

### Task 1: Baseline and forensic evidence

**Files:**
- Create: `docs/verification/zara-recovery/BASELINE_REPORT.md`
- Create: `docs/verification/zara-recovery/ROOT_CAUSE_ANALYSIS.md`
- Inspect: `Diagnose-ZaraV2.ps1`, public Chat API, V2 coordinator/guard/turn controller, runtime/container configuration

- [ ] Record branch/base SHA, clean status, workspace test count, typecheck/lint/build and static safety results.
- [ ] Reproduce the five-turn public API behavior and record only redacted response/guard/state metadata.
- [ ] Record the exact code-path matrix and external blockers; do not call this acceptance.
- [ ] Commit the forensic checkpoint.

### Task 2: Independent response decisions

**Files:**
- Modify: `services/api/src/v2-response-guard.ts`
- Modify: `services/api/src/v2-coordinator.ts`
- Test: `services/api/src/v2-response-guard.test.ts`
- Test: `services/api/src/v2-coordinator.test.ts`

- [ ] Add the failing optional-question regression tests.
- [ ] Run the focused tests and confirm the original `invalid_question` rejection.
- [ ] Suppress only invalid optional question metadata after independently validating the answer; retain the original question failure in diagnostics.
- [ ] Keep required question identity, forbidden questions, duplicate prevention, persona checks, claim checks, and fallback safety unchanged.
- [ ] Run focused and full API tests.

### Task 3: Post-tool grounding and planning continuity

**Files:**
- Modify: `services/api/src/v2-coordinator.ts`
- Modify: `services/api/src/v2-turn-controller.ts`
- Modify: `services/api/src/types.ts` or audit contract only if required by compiler
- Test: `services/api/src/v2-coordinator.test.ts`
- Test: `services/api/src/v2-turn-controller.test.ts`

- [ ] Add failing tests for successful correlated `search_knowledge` evidence with a rejected first answer and for a valid candidate plan with a rejected answer.
- [ ] Run them red.
- [ ] Merge only exact Node-prefetch and successful correlated read-tool evidence into grounding/repair context.
- [ ] Pass the trusted evidence union into the bounded no-tool repair envelope.
- [ ] Preserve `candidateResponse.planning` for Node catalog/evidence validation even when the customer-facing draft is rejected.
- [ ] Add diagnostic fields for question-recovery and preserve original claim/guard reason codes.
- [ ] Run focused and full API tests.

### Task 4: Catalog, persona, and state integration audit

**Files:**
- Inspect/fix only where evidence requires: `services/api/src/v2-intent-evidence.ts`, `v2-planning.ts`, `v2-journey-bootstrap.ts`, catalog fixture/importer, Python persona composer/contracts
- Test: existing catalog, intent, persona, journey and controller tests plus new minimal regressions
- Docs: `docs/current-state.md`, `docs/verification/zara-recovery/INTENT_CATALOG_VALIDATION.md`, `PERSONA_VALIDATION.md`

- [ ] Verify formation synonyms, information-vs-initiation classification, refusal/correction, pinned persona and no premature lead behavior against the published ANCFZ V2 catalog.
- [ ] Correct only missing or contradictory published development configuration, never hardcode ANCFZ in shared logic.
- [ ] Record measured results and remaining gaps.

### Task 5: Journey/provider verification

**Files:**
- Inspect/fix only evidence-backed gaps in Lead, qualification, document, package, quotation, outbox, Salesforce and callback modules.
- Reports: `SALESFORCE_SANDBOX_REPORT.md`, `CUSTOMER_JOURNEY_E2E_REPORT.md`, `SECURITY_AND_REPLAY_REPORT.md`

- [ ] Run local deterministic provider tests and the existing QA journey.
- [ ] Run sandbox operations only with synthetic identities and verify readback; otherwise record the exact blocked credential/workflow boundary.
- [ ] Verify package/quote calculations, invalidation, document lifecycle gates, idempotency, restart and replay.

### Task 6: Docker, Azure, browser, and final evidence

**Files:**
- Modify: `docs/current-state.md` and canonical docs only with actual evidence
- Create: `ARCHITECTURE_CHANGELOG.md`, `RAG_QUALITY_REPORT.md`, `SALESFORCE_SANDBOX_REPORT.md`, `CUSTOMER_JOURNEY_E2E_REPORT.md`, `AZURE_CONVERSATION_EVALUATION.md`, `SECURITY_AND_REPLAY_REPORT.md`, `PERFORMANCE_COMPARISON.md`, `FINAL_ACCEPTANCE_REPORT.md`

- [ ] Build and run the actual Compose stack; check health endpoints and public API/UI behavior.
- [ ] Run three independent live Azure evaluations if configured; otherwise record the exact external blocker and keep the gate unverified.
- [ ] Run browser and security/replay checks where available.
- [ ] Run verification-before-completion checks, review the diff, commit milestones, push the single branch, and open one comprehensive PR only if user-authorized gates are satisfied.


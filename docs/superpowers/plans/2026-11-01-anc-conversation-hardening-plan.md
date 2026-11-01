# ANC Conversation Engine v2 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ANC v2 conversation state-aware and fact-safe, enable v2/LangGraph by default when configured, and produce honest mock/Azure UAT evidence without filler turns or stage shortcuts.

**Architecture:** Keep Node as the authority for catalog validation, slot provenance, lifecycle gates, consent, action execution and response guarding. Keep Python/LangGraph inference-only; improve the authorized context and deterministic fallback behavior rather than adding a second business state store. The HTTP runner will drive chat and customer-approved action routes, then verify the disposable PostgreSQL state.

**Tech Stack:** TypeScript/Express/Vitest, Python/FastAPI/LangGraph/pytest, Docker Compose, PostgreSQL, Redis, Node HTTP runner.

**Spec:** User-provided ANC Conversation Engine v2 Hardening & Real GPT-5.4 UAT specification; `AGENTS.md` and the existing v2 architecture/contracts.

## Global Constraints

- Never modify the operational `.env`, operational database, operational volumes or real provider credentials.
- Use only the isolated `anc-mock-uat` Compose project, synthetic `example.test` identities and deterministic providers for Mode A.
- Preserve explicit `false` rollback flags and tenant allowlisting; no silent legacy fallback when v2 is enabled but misconfigured.
- Do not claim Azure GPT-5.4 or SF-02 evidence unless the configured deployment/provider returns independently verified evidence.
- Do not execute payment, invoice or contract actions in the Stage 5 acceptance journey.

## Review Focus

- Knowledge interruption while a slot is pending must resume that exact requirement and must not repeat a generic response.
- Corrections and multi-slot messages must preserve slot-to-requirement mapping and provenance.
- Enabled defaults must fail clearly when the private model gateway is unavailable, while explicit rollback remains possible.
- A runner failure must be attributable to a conversation assertion, an approved action route, or a provider/state assertion—not a filler turn.
- Stage reporting must distinguish last completed, current active, next pending and intentional stop stage.

### Task 1: Reproduce conversation and extraction defects

**Files:**
- Test: `services/api/src/app.test.ts`, `services/api/src/v2-qualification.test.ts`, `tools/qa/ancfz-stage5-api-conversation.mjs`
- Modify: none until the failing assertions are observed

- [ ] Add focused failing tests for repeated generic replies after a knowledge interruption, unrelated timeline contamination, wrong/incomplete qualification facts, and enabled-default configuration.
- [ ] Run only those tests and record the expected failures before production edits.

### Task 2: Repair catalog-bound qualification and state-aware dialogue

**Files:**
- Modify: `services/api/src/app.ts`, `services/api/src/v2-qualification.ts`, `services/api/src/v2-coordinator.ts`, `services/model-gateway/gateway/graph.py` or `agent.py` only where the trace proves it is needed.
- Test: `services/api/src/app.test.ts`, `services/api/src/v2-qualification.test.ts`, `services/api/src/v2-coordinator.test.ts`.

- [ ] Make slot updates accept only validated values for the active catalog requirement; unrelated prose must remain in the turn context, not become a slot value.
- [ ] Preserve correction provenance/revision and require all qualification slots to be valid before account readiness.
- [ ] Carry the active requirement, verified facts, recent assistant questions and interruption intent into the LangGraph context; reject generic/repeated drafts with the existing response guard/fallback path.
- [ ] Run focused tests and the API suite.

### Task 3: Restore safe default-on configuration

**Files:**
- Modify: `.env.example`, `docker-compose.python-gpt.yml`, `services/model-gateway/gateway/app.py`, `services/api/src/app.ts` only where startup validation requires it.
- Test: configuration/startup tests in `services/api/src/app.test.ts` and model-gateway tests.

- [ ] Make v2/LangGraph defaults true when the private gateway is the configured path; retain explicit `false`, tenant allowlisting and clear missing-configuration errors.
- [ ] Verify the model gateway remains internal-only and Azure deployment selection uses `AZURE_OPENAI_DEPLOYMENT`.
- [ ] Run focused default/rollback/missing-config tests and Compose config validation.

### Task 4: Replace filler-driven UAT with meaningful conversation evidence

**Files:**
- Modify: `tools/qa/ancfz-stage5-api-conversation.mjs`, `tools/qa/anc-mock-provider-server.mjs` only if provider evidence needs a missing correlation.
- Create: redacted transcript/report outputs under `artifacts/ancfz-stage5-api-uat/`.
- Test: runner in mock mode, then Azure mode when configured.

- [ ] Remove artificial padding and make 25 turns meaningful: goal, requirements, knowledge questions, corrections, status, consent, confirmations and follow-ups.
- [ ] Keep direct action confirmation only where the customer UI would use it; do not mutate lifecycle state directly.
- [ ] Add separate fields for last completed stage, current active stage, next pending stage and intentional stop stage.
- [ ] Add qualification accuracy, repetition, tool/guard, latency/provider-error, transcript and chat/action/provider orchestration evidence.
- [ ] Run Mode A and classify Mode B as `BLOCKED_MODEL_NOT_CONFIGURED` if endpoint/deployment/key verification fails.

### Task 5: Synthetic SF-02 boundary, full verification and handoff

**Files:**
- Modify: `tools/qa/ancfz-stage5-api-conversation.mjs` and mock provider only if an existing verified SF-02 boundary can be exercised without weakening evidence gates.
- Modify: `docs/current-state.md` with measured results.

- [ ] Run local document/OCR and separately run the SF-02 mock attachment scenario; require verified attachment evidence or report it blocked.
- [ ] Rebuild the isolated stack, run unit/typecheck/lint/Python/API tests, then run both UAT modes.
- [ ] Generate `hardening-report.md`, `hardening-report.json`, redacted transcripts and a stage verification table without overwriting historical reports.
- [ ] Commit logical changes locally, leave the isolated stack available, and do not merge or push.

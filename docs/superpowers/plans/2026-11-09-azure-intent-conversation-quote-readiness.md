# Azure Intent Conversation and Quote Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Azure-backed V2 conversation reliable and production-grade through stages 1–4: goal discovery, qualification, account gate, package selection and quote generation, while preserving the seven-stage model and explicitly leaving document, payment and contract execution outside this phase.

**Architecture:** Keep the existing seven-component V2 boundary. Azure Python owns normal dialogue planning and persona composition; Node owns tenant/session/catalog validation, verified facts, stage transitions, consent, action authorization, quote state and the final response guard. The focused fix removes accidental Node prose overrides from ordinary turns, bounds Azure with the correct catalog evidence for the current question, and makes stage/quote readiness explicit instead of inferred from conversation text.

**Tech Stack:** TypeScript/Express, Zod, Vitest, Python/FastAPI, Azure OpenAI Responses API with API key, PostgreSQL/Redis/n8n boundaries, Docker Compose, existing ANCFZ catalog fixtures and acceptance scripts.

**Spec:** `docs/conversation-engine-architecture.md`, `docs/conversation-engine-contracts.md`, `docs/conversation-engine-delivery-plan.md`, `docs/conversation-engine-evaluation.md`, `docs/persona-response-contract.md`, `docs/agent-tool-loop.md`, `docs/intent-taxonomy.md`, `docs/conversation-planner.md`, `docs/journey.md`, `docs/n8n-workflows.md`, `docs/acceptance.md`

## Global Constraints

- ANCFZ is the acceptance tenant for this phase, but tenant-specific names, copy, package values and workflow keys stay in the published catalog/persona; shared services must remain tenant-neutral.
- The seven stages remain ordered: `lead_generation` → `lead_qualification` → `account_creation` → `package_selection` → `document_upload` → `payment_invoice` → `contract`.
- This implementation scope stops at a verified development/sandbox quote artifact. It must not claim document review, Salesforce SF-02 attachment, payment settlement, invoice completion or contract signature.
- CRM Lead capture is a conditional service action, not the primary customer intent. Knowledge-only turns must not collect contact details or create CRM actions.
- Azure Python proposes; Node validates and persists. Python receives no database credentials, provider credentials or arbitrary URLs and cannot execute side effects.
- Every customer-visible model response passes the Node response guard. Offline text is used only for typed model/tool/authorization failures or narrowly defined Node-owned action status.
- Azure uses the configured `/openai/v1` deployment and keeps `AZURE_OPENAI_API_KEY` private to the model-gateway runtime. Never log or persist secret values, document bytes or raw PII.
- Use one initial Azure request plus at most three transient retries, with the existing deadline, rate limit and circuit breaker. Do not combine an application retry loop with SDK retries that exceed this budget.
- Use synthetic customers and development/mock provider labels for acceptance. A local deterministic provider or PDF is evidence only of the development boundary, never Salesforce or official pricing evidence.

## Review Focus

- A licensing, eligibility, visa, setup or timeline question must be answered from the matching approved evidence before any pending requirement is mentioned; it must never receive unrelated package prose. Pin this in the intent/relevance tests.
- A confirmed goal must survive a knowledge detour and resume at the next missing requirement, not repeat “Would you like to proceed?” or re-ask an already verified fact. Pin this in the conversation controller tests.
- A knowledge-only or exploratory customer must not create a Lead, collect contact details or expose action controls. Pin this in the API integration tests.
- A generic “yes”, correction, refusal, pause, opt-out or status question must apply only to the current persisted prompt/action and must not authorize a different stage. Pin this in goal/action state tests.
- A quote must be tied to the pinned catalog, eligible package, approved price provenance, opportunity, explicit package confirmation and a stable action revision; a downloadable PDF must be labelled development-only. Pin this in lifecycle and live acceptance tests.
- Azure outage, invalid JSON, rate limit, timeout and stale state must produce a typed guarded fallback without invented facts or a silent mock answer. Pin this in model-gateway and response-guard tests.

---

## Current Findings to Address

The live local Azure run proves transport, persistence and model invocation, but not conversation quality: 25/25 turns completed and the model gateway ran in Azure mode, while several turns answered the wrong topic or repeated the formation gate. The immediate cause is the normal-turn override block in `services/api/src/v2-turn-controller.ts` (`effectiveAnswer`, `effectiveQuestion`, `overrideResponse` around lines 542–720). It rewrites valid model output for facts, status, contact, package availability and pending goal state, and appends a package/CRM gate to unrelated replies. The existing response guard validates schema, persona, citations and question keys, but does not validate that the answer addresses the current knowledge topic. Azure reliability is configured but its exact retry behavior and readiness contract are not acceptance-tested; `AsyncOpenAI(max_retries=3)` must be reconciled with the project’s explicit retry policy.

The existing quote route is intentionally development-only: `services/api/src/business-lifecycle.ts` requires a verified Lead and approved package, `services/api/src/routes/lifecycle.ts` exposes package/quote state, and `services/api/src/app.ts` renders a labelled development PDF behind `ANCFZ_LOCAL_QUOTE_WORKFLOW`. That boundary should be tested and surfaced accurately, not promoted to official pricing or provider completion.

## File Map

**Modify:**

- `services/api/src/v2-turn-controller.ts` — separate state/cursor mutation from ordinary response prose; retain only Node-owned safety/action responses.
- `services/api/src/v2-planning.ts` — validate current-turn topic/intent and stage-compatible next moves without allowing the model to rebind a confirmed goal.
- `services/api/src/v2-tool-policy.ts` — restrict high-specificity read tools, especially package lookup, to the current server-derived turn intent.
- `services/api/src/v2-response-guard.ts` — enforce server-derived evidence/topic membership, one-question continuity and no unrelated appended package/action text.
- `services/api/src/python-model/v2-contracts.ts` — add only an additive server-derived request-context field if the existing envelope cannot carry the current topic/tool boundary; do not add a required response field or bump the schema for this fix.
- `services/model-gateway/gateway/v2_contracts.py` — mirror the versioned response/envelope contract exactly.
- `services/model-gateway/gateway/persona_composer.py` — make immediate-question-first, one-purposeful-follow-up and stage-aware composition explicit for Azure.
- `services/model-gateway/gateway/app.py` — make Azure-only readiness, retry ownership and typed failure reporting observable without exposing secrets.
- `services/model-gateway/gateway/agent.py` and `services/model-gateway/gateway/graph.py` — ensure the bounded tool/model loop returns the final Azure composition and does not fall back to mock or canned test content in Azure mode.
- `services/api/src/business-lifecycle.ts`, `services/api/src/routes/lifecycle.ts`, `services/api/src/app.ts` — tighten and document stages 1–4 quote prerequisites, development labels and download evidence; preserve stage 5+ gates. `app.ts` also owns the existing approved fallback-template set and must be included if action/status prose is moved there.
- Existing published ANCFZ catalog fixtures — inspect first; change a catalog version only if a required topic/signal is genuinely absent, and test publication/version pinning. Do not silently alter the active catalog as part of a conversation-code fix.
- `tools/anc/acceptance/api_25_turns.py`, `tools/anc/acceptance/score_azure_conversation.py`, `scripts/live-quote-conversation.mjs` — record model-generated output, accepted planner decision, citations, pending requirement, action state and quote evidence; never substitute canned assistant answers.
- `docs/current-state.md` — record measured pass/fail/blocked status after execution, including the exact first external/provider blocker.

**Test:**

- `services/api/src/v2-turn-controller.test.ts`
- `services/api/src/v2-planning.test.ts`
- `services/api/src/v2-response-guard.test.ts`
- `services/api/src/v2-knowledge-preflight.test.ts`
- `services/api/src/v2-tool-policy.test.ts`
- `services/api/src/v2-coordinator.test.ts`
- `services/api/src/business-lifecycle.test.ts`, `services/api/src/catalog-v2-runtime.test.ts`, `services/api/src/catalog-v2-seven-stage.test.ts`
- `services/model-gateway/tests/test_agent.py`, `test_graph.py`, `test_persona_composer.py`, `test_reliability.py`, `test_v2_contracts.py`
- Add one focused API acceptance fixture/test for the stage-1-to-stage-4 path and one redacted Azure live artifact under `docs/verification/` or `artifacts/`.

### Task 1: Pin the conversation invariants before changing runtime behavior

**Files:**
- Create: `services/api/src/v2-conversation-quality.test.ts`
- Modify: `services/api/src/v2-turn-controller.test.ts`, `services/api/src/v2-response-guard.test.ts`, `services/api/src/v2-knowledge-preflight.test.ts`
- Test data: `services/api/src/fixtures/ancfz-catalog-v2-scenarios.json` only if a required case is absent.

**Interfaces:**
- Consume the existing `runGPTFirstChatTurn`, `executeV2Turn`, `validateV2PlanningProposal` and `guardV2Response` contracts.
- Produce executable expectations for `turnCategory`, `nextMove`, `nextQuestionKey`, citations, verified fact patches, action count and persisted stage.

- [ ] Write failing tests for these exact cases:
  - greeting/exploration: natural answer or goal clarification, no RAG requirement, no contact collection and zero actions;
  - “What is the licensing process?” while formation is pending: licensing/setup evidence, `knowledge_advisory`, one relevant follow-up, no package appendix;
  - “Am I eligible?” and “How many visas?”: matching topic/evidence, no unrelated package answer;
  - explicit formation request: one goal confirmation prompt, separate from CRM consent;
  - confirmed formation plus business activity: persist the fact and ask only the next catalog requirement;
  - knowledge interruption after a confirmed visa count: answer the interruption and resume at missing activity/entity/timeline, not visa count or goal confirmation;
  - explicit package/quote request: package data is returned only when package intent is active and quote remains behind the documented gates;
  - correction, status, refusal/opt-out and ambiguous “yes”: no arbitrary action or stage jump;
  - Azure-generated valid answer is not replaced by generic Node prose.
- [ ] Run the focused Vitest file and record the expected failures before implementation.

### Task 2: Stop normal-turn Node prose from overriding Azure composition

**Files:**
- Modify: `services/api/src/v2-turn-controller.ts`
- Modify: `services/api/src/v2-coordinator.ts` only if response-repair ownership is currently duplicating controller overrides.
- Modify: `services/api/src/app.ts` only if the existing approved fallback-template set must carry the narrowly Node-owned action/status responses; keep those templates persona-pinned and generic.
- Test: `services/api/src/v2-turn-controller.test.ts`, `services/api/src/v2-conversation-quality.test.ts`

**Interfaces:**
- Keep `runGPTFirstChatTurn` return shape and persisted `UserIntentDocument` contracts unchanged unless a schema version is required.
- Replace the broad `overrideResponse` behavior with a narrow Node-authored response decision that can be set only for: goal confirmation/clarification, explicit consent/action status, provider/unavailable status, privacy/safety refusal, or an approved fallback.

- [ ] Refactor the controller so `result.response.answer`, citations and `result.response.nextQuestion` remain authoritative for ordinary greeting, knowledge, qualification, correction, recap and navigation turns.
- [ ] Preserve deterministic state updates for verified facts, pending goal decision, stage cursor, consent and action proposals without rewriting the customer-facing answer.
- [ ] When Node must own prose, carry the response reason and matching `nextQuestionKey` together; run that text through the existing persona/response-guard path and approved tenant fallback/template source rather than shared hardcoded ANCFZ copy.
- [ ] Remove the unconditional package/CRM sentence appended around the package-options branch. A package response may state that the quote action is gated only when the current turn explicitly requests package/quote execution and the authoritative state shows the gate is unmet.
- [ ] Preserve the action-confirmation and provider-reconciliation truthfulness rules, but keep them out of the normal Azure answer path.
- [ ] Run the focused tests and verify that model-authored licensing/eligibility/setup answers survive, while safety/action branches remain deterministic.

### Task 3: Make current-turn intent and evidence constrain Azure without replacing its dialogue strategy

**Files:**
- Modify: `services/api/src/v2-planning.ts`, `services/api/src/v2-knowledge-preflight.ts`
- Modify: `services/model-gateway/gateway/persona_composer.py`, `services/model-gateway/gateway/v2_contracts.py`
- Modify: `services/api/src/python-model/v2-contracts.ts`
- Modify: `services/model-gateway/gateway/agent.py`, `services/model-gateway/gateway/graph.py` only where the new fields are passed through.
- Test: `services/api/src/v2-planning.test.ts`, `services/api/src/v2-knowledge-preflight.test.ts`, `services/model-gateway/tests/test_persona_composer.py`, `test_v2_contracts.py`, `test_agent.py`.

**Interfaces:**
- Prefer the existing `supportingTopicKeys` planning field and server-side approved evidence/tool allowlist. If the envelope needs extra context, add only optional `requestedTopicKeys: string[]` and `requestedEvidenceCitationIds: string[]` fields derived by Node and mirrored in Python; pass the same server-derived citation IDs into `V2ResponseGuardContext`. Do not add a required `addressedTopicKeys` response field or trust model-reported topic metadata as proof of relevance.
- The server-derived topic/tool boundary is a guard input, not a replacement for the model’s dialogue strategy. Node still owns action eligibility and stage transitions.

- [ ] Write failing contract tests for unknown topics, topic/goal mismatch, missing required evidence for a factual topic, package tool requests during licensing questions, and a knowledge answer followed by one pending-requirement question.
- [ ] Derive bounded requested topics/evidence from the existing catalog and retrieval preflight. Keep the existing customer-text signal validation; do not let a Node keyword match silently become the final turn intent.
- [ ] Update Azure instructions to answer the immediate customer request first, use only evidence for factual claims, use `get_available_packages` only for package/quote intent, preserve the confirmed goal, and ask one purposeful catalog question only after the answer.
- [ ] Make the agent return the final Azure composition after the bounded tool loop; if the model cannot satisfy the contract, return the typed failure so Node uses the approved fallback instead of fabricated content.
- [ ] Extend the response guard to reject or safely fallback when a factual answer has no citation from the server-derived requested evidence set, cites evidence from an unauthorized/unrelated tool result, asks a non-pending question, or contains stacked/duplicate questions. Do not treat a model-reported topic as proof. Reuse the existing one-shot knowledge-repair/recomposition budget for a topic mismatch; if the repaired response still fails, use the approved persona fallback rather than returning a wrong answer.
- [ ] Run TypeScript and Python contract/guard tests before moving to lifecycle changes.

### Task 4: Make the stage-1-to-stage-4 journey and quote boundary explicit

**Files:**
- Modify: `services/api/src/business-lifecycle.ts`, `services/api/src/routes/lifecycle.ts`, relevant quote/action sections of `services/api/src/app.ts`
- Modify: `services/api/src/v2-turn-controller.ts` only for the stage cursor and action-proposal conditions exposed by Task 2.
- Test: `services/api/src/business-lifecycle.test.ts`, `services/api/src/catalog-v2-runtime.test.ts`, `services/api/src/catalog-v2-seven-stage.test.ts`, plus a new focused lifecycle integration test if needed.

**Interfaces:**
- Keep existing public route paths and response shapes.
- Production-like quote readiness must be server-derived: pinned opportunity; verified Lead/provider evidence; qualification requirements satisfied by catalog policy; account gate satisfied according to the current provider policy; eligible approved package; current price provenance; explicit package selection/confirmation; idempotent `package.confirm` action revision.
- Preserve the existing local development shortcut exactly as a labelled development boundary if it is still enabled: it may use the current verified-Lead path, but it must not be described as Account completion, Salesforce completion or official pricing. Do not silently add an Account provider dependency to the local quote script in this focused change.

- [ ] Write failing tests for each prerequisite being absent, stale, cross-opportunity, cross-catalog or unverified, and for successful development quote creation.
- [ ] Confirm the state machine cannot advance from lead generation to qualification/account/package solely from model wording, HTTP 2xx, n8n acceptance, or a local mock result presented as Salesforce evidence.
- [ ] Ensure package and quote requests are surfaced as stage-appropriate `service_execution`/`knowledge_advisory` turns, not forced into contact collection when the customer is only comparing options.
- [ ] Keep the local PDF path explicitly development-only (`mode: MOCK`, development seller label, artifact digest and private download). Do not call it official pricing or a completed external provider transaction. Keep stage 5 document upload out of this acceptance path.
- [ ] Verify the download route checks tenant/session/opportunity/approved quote and artifact integrity, and that replaying the same package action does not create a second quote or selection.
- [ ] Leave document upload, payment/invoice and contract routes fail-closed behind their stage gates; add a regression proving a quote does not implicitly authorize stage 5.
- [ ] Run the focused lifecycle suite and the API typecheck/lint.

### Task 5: Make Azure mode a tested production boundary

**Files:**
- Modify: `services/model-gateway/gateway/app.py`, `services/model-gateway/gateway/reliability.py` if required by the retry audit, and `services/model-gateway/README.md`.
- Test: `services/model-gateway/tests/test_reliability.py`, `test_agent.py`, `test_graph.py`, `test_summary.py`.
- Config/verification: local Compose environment and a redacted readiness/acceptance artifact; do not commit secrets.

**Interfaces:**
- Add a non-secret readiness result containing provider mode (`azure`), endpoint shape (`/openai/v1`), configured deployment name, retry policy, deadline, rate/concurrency budgets and circuit state. Do not return the key or raw endpoint credentials.
- Keep `MODEL_MODE=mock` available only for isolated unit tests; all live conversation acceptance commands must set/use `MODEL_MODE=azure` and fail if mock mode is active.

- [ ] Write failing tests proving Azure mode rejects missing/invalid endpoint, deployment or key; proving mock mode cannot be selected by a live acceptance invocation; and proving retry counts are exactly initial + up to three transient retries.
- [ ] Choose one retry owner. Prefer an explicit bounded application retry policy with `AsyncOpenAI(max_retries=0)`, honoring `Retry-After`/`retry-after-ms`, jitter and the turn deadline; otherwise prove the SDK policy alone meets the same contract and remove duplicate application retries.
- [ ] Keep invalid requests, auth failures, refusals and side-effecting workflows non-retryable; map exhaustion to `MODEL_UNAVAILABLE`/the existing typed gateway failure and approved persona fallback.
- [ ] Verify structured Azure Responses output, tool-call continuation, model request count, grounding-review budget and `store=False` remain bounded.
- [ ] Rebuild only the required local images, check `/health/live` and the model readiness output, then run the Python test suite and API model-contract tests.

### Task 6: Run the real Azure conversation-to-quote acceptance and publish evidence

**Files:**
- Modify: `tools/anc/acceptance/api_25_turns.py`, `tools/anc/acceptance/score_azure_conversation.py`, `scripts/live-quote-conversation.mjs`.
- Create: `docs/verification/azure-intent-quote-readiness-2026-11-09.json` (redacted) and, if successful, a PDF under an ignored `artifacts/` path.
- Modify: `docs/current-state.md` with exact measured results.

**Interfaces:**
- The artifact records synthetic user prompts, redacted Azure-generated assistant answers, accepted turn category/goal/next move, citations/evidence IDs, pending requirement, action IDs as digests, provider status, quote ID/artifact digest and download status. It must never record API keys, raw identity-document bytes, raw PII or fabricated assistant responses.

- [ ] Add a natural script covering: greeting; setup; licensing; eligibility; visa count; timeline; correction; goal confirmation; qualification facts; contact/purpose consent; explicit Lead confirmation; status; package comparison; package selection; quote request; quote download; and a knowledge detour after confirmation. Stop after quote download; do not invoke the existing document-upload loop in this phase.
- [ ] Run through the public local Docker path with Azure mode forced and assert no mock response marker, no canned assistant replacement, no unrelated package append, no duplicate goal confirmation, no action before consent, and exactly one relevant follow-up where appropriate.
- [ ] Assert the stage ledger reaches at most `package_selection`/quote generation, and that the quote is labelled development-only. If the production-like Salesforce/account provider evidence is unavailable, stop at that exact first blocker and report it; the explicitly labelled local development shortcut may proceed only as development evidence and must not be counted as live provider completion.
- [ ] Validate quote download HTTP 200, PDF content type, private content disposition, nonzero bytes and matching artifact SHA-256 when the development quote gate is enabled.
- [ ] Run the standard verification set: `npm run typecheck`, `npm run lint`, `npm run test:unit`, model-gateway `pytest`, Docker build/health, focused Azure acceptance and artifact review.
- [ ] Update `docs/current-state.md` to distinguish: Azure transport readiness, human conversation quality, local development quote evidence, Salesforce/provider evidence, and stages 5–7 status. Do not mark the product production-ready until the documented external/provider and human-quality gates pass.

## Completion Criteria

- Azure is the only model used by live acceptance; no hardcoded test assistant answer is used to make a scenario pass.
- Licensing, eligibility, visa, setup, timeline, package and quote turns follow the current user intent and evidence instead of a generic formation/contact/package script.
- The confirmed business goal and verified facts persist across interruptions and corrections; one relevant next question is selected from the pinned catalog.
- No CRM/action side effect occurs for knowledge-only, ambiguous, declined or unconfirmed turns; each external write still requires Node authorization, purpose consent, explicit confirmation, idempotency and provider evidence.
- The stage-1-to-stage-4 quote slice has a reproducible, truthfully labelled development/sandbox acceptance path through quote generation/download. Any development shortcut that bypasses production Account/provider evidence is reported as a shortcut, not as completion of stages 2–3. Stages 5–7 remain gated and are reported as unverified unless independently evidenced.
- The final report includes exact pass/fail/blocked results, not only a transport score. Human review must score relevance, continuity, naturalness, grounding, consent discipline and stage correctness on the frozen Azure transcript.

## Self-Review

- Spec coverage: the plan maps the seven logical components, intent taxonomy, persona/guard boundary, Azure reliability rules, provider evidence rules and the stage-1-to-stage-4 scope to Tasks 2–6.
- Step scan: each task begins with failing tests, defines the files/contracts it owns, implements the minimum change and ends with a verification command.
- Type consistency: the proposed topic metadata is versioned in Python and TypeScript together; existing route and lifecycle shapes stay stable.
- Review focus: every listed failure mode has a named test in Tasks 1–5.
- Proportion: this is a correction of the current V2 path, not a rewrite of the legacy runtime or implementation of stages 5–7.

## Execution status — 2026-11-09

- Completed: Tasks 1–2 behavioral coverage and controller cleanup; package tool/prose is no longer injected into unrelated turns.
- Completed: the focused Task 3 boundary implemented in `v2-knowledge-preflight.ts` and `v2-tool-policy.ts`: bounded topic-aware retrieval, strict process/eligibility/setup filtering, and status/recap search restriction. The existing planner and guard contracts remain unchanged.
- Completed: Task 4 regression verification through the existing lifecycle/catalog suites; no quote route or stage 5+ behavior was changed.
- Completed: Task 5 Azure readiness probe, model-gateway tests, Docker rebuild and Azure-only live harness verification.
- Verified: Task 6 transport/conversation portion with a redacted 25-turn Docker artifact. Existing development quote lifecycle/download coverage remains green and is recorded in `docs/current-state.md`; no additional external Salesforce write or document upload was triggered by this retest.
- Deferred by boundary: a fresh external Salesforce-to-quote side-effect run, document upload, payment, invoice and contract execution, and the formal human-quality score. These require explicit provider/human-review acceptance and are not claimed here.

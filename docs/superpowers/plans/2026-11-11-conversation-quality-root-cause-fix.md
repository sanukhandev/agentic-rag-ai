# Conversation Quality Root-Cause Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V2 conversations progress from verified model/tool context to one consistent durable journey state, while preventing knowledge turns, refusals, deadline failures, and document-stage mismatches from producing repetitive or unsafe replies.

**Architecture:** Keep the current GPT-first V2 pipeline, but make the deadline contract explicit, use the V2 User Intent Document and pinned opportunity as the authoritative state for document/action gates, and allow deterministic controller overrides only for typed policy failures. The published catalog remains the source of workflow identity and stage policy; no workflow key or stage order is hardcoded in the upload path.

**Tech Stack:** Node.js 22, TypeScript, Express, PostgreSQL/in-memory Store, Vitest, Python FastAPI, Azure OpenAI Responses API, Docker Compose, remote n8n webhooks with synthetic data only.

**Spec:** `docs/conversation-engine-architecture.md`, `docs/conversation-engine-contracts.md`, `docs/conversation-engine-delivery-plan.md`, `docs/conversation-engine-evaluation.md`, `docs/persona-response-contract.md`, `docs/agent-tool-loop.md`, `docs/intent-taxonomy.md`, `docs/conversation-planner.md`, `docs/journey.md`, `docs/n8n-workflows.md`, `docs/migration-plan.md`, `docs/acceptance.md`.

## Global Constraints

- Node remains the sole authority for tenant/session/catalog scope, durable state, consent, action eligibility, idempotency, outbox, and provider verification.
- Python remains inference-only; it may plan, call allowlisted read tools, and compose a response, but it cannot mutate business state or invoke n8n directly.
- The published catalog, not a shared-service constant, defines workflow keys, stages, requirements, document policy, and provider bindings.
- Preserve migrations, historical sessions, published catalog versions, SSL files, configuration structure, PII masking, token vault, and rollback paths.
- Do not mutate or delete historical sessions or leads as part of this fix.
- Use synthetic customers for all local and remote workflow tests; remote n8n routes are `/n8n/webhook/salesforce-lead` and `/n8n/webhook/generate-quotation`.
- Do not claim a Lead, quotation, document verification, or provider completion without independently verified evidence.
- Use one application retry layer for model calls; do not add a second retry loop around an SDK that already retries.
- No production deployment, real Salesforce write, real payment, signature, or credential rotation is part of this plan.

## Review Focus

- A normal 120-second turn deadline must allow an authorized read tool to execute instead of failing with `TOOL_DEADLINE_EXCEEDED`.
- “Hey, how many visas…”, “Which documents…”, and similar factual questions must receive grounded knowledge handling without activating CRM or the sales journey.
- “That sounds good — let us go ahead with the company setup” must confirm only the currently persisted goal prompt.
- “I do not consent to document processing” must persist denial/no consent and must block quotation proposal and execution.
- A document upload must use the pinned V2 goal/opportunity/catalog and return a truthful typed block only when a real stage or provider prerequisite is missing.
- The visible reply, pending requirement, User Intent Document, session journey, and action gate must describe the same turn.

## Scope and decisions

The supplied RCA contains one product-order ambiguity: it describes document upload as preceding quotation creation, while the published seven-stage catalog currently places quotation generation in `package_selection` and document upload in the following stage. This plan preserves the published catalog order and fixes the implementation to match it: request document-processing consent before quotation if the catalog requires it, generate/verify the development quotation, then activate document upload. If the product owner instead requires the binary upload itself before quotation, that is a separate catalog/action-gate change and must be approved before Task 3; it must not be solved by weakening the current upload gate.

No PostgreSQL schema migration is expected. The data change is a new validated/published catalog version only when the current published binding is missing or disabled. Existing versions remain available for rollback, and existing sessions stay pinned.

## File inventory

**Modify:**

- `services/api/src/conversation/tool-gateway.ts` — align accepted tool deadlines with the bounded turn/scope contract and preserve expiry checks.
- `services/model-gateway/gateway/agent.py` — keep tool HTTP timeout below the turn deadline and preserve typed temporary-unavailable results.
- `services/api/src/conversation/turn-controller.ts` — persist prompt state before response overrides, gate document/quotation transitions on confirmed V2 state, make consent polarity explicit, and remove duplicate response ownership for the same action.
- `services/api/src/conversation/intent-evidence.ts` — cover natural initiation variants without turning information questions into initiation.
- `services/api/src/conversation-state.ts` — classify prefixed natural confirmations against an already scoped prompt.
- `services/api/src/conversation/knowledge-preflight.ts` — recognize quantity/comparison/document knowledge questions and reject empty evidence as grounding.
- `services/api/src/app.ts` — make V2 User Intent Document/opportunity/catalog the upload authority and resolve the document route from the published catalog.
- `services/api/src/conversation/workflow-bridge.ts` or the existing catalog route helper — reuse one catalog binding resolver for workflow identity instead of endpoint-specific constants.
- `docs/current-state.md` — record exact fixed paths, measured test results, and any provider-blocked stage.

**Test:**

- `services/api/src/conversation/tool-gateway.unit.test.ts`
- `services/model-gateway/tests/test_agent.py`
- `services/api/src/conversation/turn-controller.test.ts`
- `services/api/src/conversation/intent-evidence.test.ts`
- `services/api/src/conversation-state.test.ts`
- `services/api/src/conversation/knowledge-preflight.test.ts`
- `services/api/src/conversation/conversation-quality.test.ts`
- `services/api/src/conversation/provider-evidence-route.test.ts`
- `services/api/src/conversation/workflow-bridge.test.ts`
- `scripts/deployed-ws-conversation-quality.mjs` only if a metric or fixture is proven to misreport the application result; do not loosen acceptance thresholds to make the run green.

**Data/config verification, not destructive edits:**

- `services/api/src/fixtures/ancfz-catalog-v2-seven-stage.json`
- `scripts/publish-v13-catalog.mjs` / the existing catalog publication path, only if a new validated development catalog version is required.
- Docker model-gateway/API environment values for the bounded tool timeout; never commit secrets.

### Task 1: Lock the catalog and state-order contract

**Files:**
- Read/verify: `services/api/src/fixtures/ancfz-catalog-v2-seven-stage.json`, `services/api/src/conversation/workflow-bridge.ts`, `services/api/src/business-lifecycle.ts`, `services/api/src/conversation/journey-bootstrap.ts`.
- Modify: `docs/current-state.md` after implementation.
- Test: `services/api/src/conversation/workflow-bridge.test.ts`, `services/api/src/conversation/journey-bootstrap.test.ts`.

**Interfaces:**
- Consumes: published `IntentCatalogV2Version`, `UserIntentDocument`, and `IntentProgressEntry`.
- Produces: one documented decision for the package/quote/document order and one catalog-resolved document workflow identity.

- [ ] **Step 1: Add a failing contract test** that loads the seven-stage catalog and asserts the selected package journey order is `package_selection` → `document_upload`, the document policy is `document.identity.review`, and the workflow/tool registry identity is resolved from the catalog rather than a literal `anc.document.ocr.extract` lookup.
- [ ] **Step 2: Run the focused tests** with `npm --workspace services/api exec vitest run src/conversation/workflow-bridge.test.ts src/conversation/journey-bootstrap.test.ts`; expect the binding assertion to expose the current hardcoded mismatch or disabled-provider condition.
- [ ] **Step 3: Implement the smallest catalog resolver change** using the existing `resolveV2WorkflowRoute`/business-lifecycle pattern. Match the document tool by its catalog registry key (`document.sf02.upload`) and accept the workflow only when the published binding is enabled. Do not enable a provider in code.
- [ ] **Step 4: Verify the catalog publication path**. If the local published version lacks the intended development/mock binding, publish a new validated version through the existing importer/admin path; do not edit or delete version 13 in place.
- [ ] **Step 5: Re-run the focused tests** and record whether the document provider is enabled or truthfully blocked by provider evidence.

### Task 2: Repair the Python↔Node deadline contract

**Files:**
- Modify: `services/api/src/conversation/tool-gateway.ts`, `services/model-gateway/gateway/agent.py`.
- Test: `services/api/src/conversation/tool-gateway.unit.test.ts`, `services/model-gateway/tests/test_agent.py`.

**Interfaces:**
- Consumes: `TurnEnvelopeV2.budgets.deadlineAt`, signed tool scope expiry, and `ToolRequestV2.deadlineAt`.
- Produces: a tool request accepted for a normal turn deadline, still rejected when expired or outside the signed scope, with a typed `temporarily_unavailable` result only after a real timeout.

- [ ] **Step 1: Add failing tests** for a request approximately 120 seconds in the future: Node must not return `TOOL_DEADLINE_EXCEEDED`; an expired request and a request beyond the signed scope must still be rejected. In the Python agent test, assert the tool request preserves a valid bounded deadline and that a non-200/timeout remains typed and non-fatal.
- [ ] **Step 2: Run the focused tests** with `npm --workspace services/api exec vitest run src/conversation/tool-gateway.unit.test.ts` and `python -m pytest services/model-gateway/tests/test_agent.py -q`; expect the 120-second Node case to fail before the fix.
- [ ] **Step 3: Change the Node upper bound** so it is no smaller than the configured turn deadline and never exceeds the signed scope lifetime. Keep the existing expiry, scope, tenant, catalog, persona, and state-revision checks.
- [ ] **Step 4: Set the Python HTTP tool timeout** to a bounded value that is longer than normal Node read latency but shorter than the turn deadline, and preserve the single SDK/application retry policy. Do not make the timeout unbounded.
- [ ] **Step 5: Re-run both focused suites** and add a direct local probe of `get_journey_state` using the same envelope path; expected result is `status: ok` for the normal deadline and no `TOOL_DEADLINE_EXCEEDED` audit-free rejection.

### Task 3: Make V2 journey state authoritative for document upload

**Files:**
- Modify: `services/api/src/app.ts`, `services/api/src/conversation/turn-controller.ts`.
- Test: `services/api/src/conversation/provider-evidence-route.test.ts`, `services/api/src/conversation/conversation-quality.test.ts`.

**Interfaces:**
- Consumes: `Store.getUserIntentDocument(tenantId, sessionId)`, published V2 catalog, `document.identity.review`, and the pinned opportunity.
- Produces: upload validation based on `catalogSource === 'v2'`, confirmed goal, matching opportunity, current `document_upload` stage, active requirement, purpose-specific consent, and the catalog-resolved document binding.

- [ ] **Step 1: Add a failing integration test** that creates a V2 session with a confirmed goal, pinned opportunity, `document_upload` stage, pending document requirement, confirmed package selection, current approved development quotation, and the development document provider; upload a synthetic JPEG without `primaryIntentKey` and assert it reaches the document job instead of `DOCUMENT_INTENT_NOT_ACTIVE`.
- [ ] **Step 2: Add a failing negative test** for a V2 session with no opportunity/current document stage; assert the endpoint returns the exact typed prerequisite error and does not create a supporting document or job.
- [ ] **Step 3: Replace the V2 branch’s legacy intent lookup** with the User Intent Document’s `businessGoalKey`, `opportunityId`, `currentStageKey`, `pendingRequirementKey`, `catalogVersionRef`, and verified facts. Keep the legacy path unchanged for legacy sessions.
- [ ] **Step 3a: Add a failing state-consistency regression** proving that `package_choice`, quotation consent, and downstream commercial facts are not promoted into authoritative verified facts while `goalConfirmed` is false. Facts may be retained as bounded observed-turn evidence, but must not create an opportunity or satisfy an action gate.
- [ ] **Step 4: Remove the hardcoded document workflow lookup** and resolve the enabled document tool/workflow from the pinned published catalog. Keep provider-disabled behavior as `DOCUMENT_WORKFLOW_NOT_AVAILABLE`, not as a misleading intent error.
- [ ] **Step 5: Align the controller’s document prompt with durable state**. Apply `effectivePendingRequirement`, `currentStageKey`, and `approvedResponse.pendingRequirementKey` to the same `nextDoc` revision before persistence; do not expose a document prompt whose V2 document says the requirement is null.
- [ ] **Step 6: Re-run the provider-evidence route suite** and verify that accepted upload creates the existing processing job, worker completion advances the same opportunity, and no historical session is rewritten.

### Task 4: Make goal confirmation durable and natural

**Files:**
- Modify: `services/api/src/conversation/turn-controller.ts`, `services/api/src/conversation/intent-evidence.ts`, `services/api/src/conversation-state.ts`.
- Test: `services/api/src/conversation/turn-controller.test.ts`, `services/api/src/conversation/intent-evidence.test.ts`, `services/api/src/conversation-state.test.ts`.

**Interfaces:**
- Consumes: a scoped `GoalConfirmationRecord` and bounded current customer message.
- Produces: `confirmed`, `rejected`, `corrected`, `interruption`, or `ambiguous` only for the persisted current prompt; no generic affirmative may confirm an unprompted goal.

- [ ] **Step 1: Add failing tests** for `That sounds good — let us go ahead with the company setup`, `Go ahead with the company setup`, and `Confirmed. Start the enquiry.`. Assert they confirm only when a matching pending prompt exists.
- [ ] **Step 2: Add a failing regression** where contact details arrive before confirmation and the controller asks for confirmation; assert the persisted User Intent Document contains `goalConfirmation.status === 'pending'` and the next affirmative turn confirms it.
- [ ] **Step 3: Expand the initiation grammar** with bounded phrase variants, preserving exclusion clauses and the distinction between information requests and explicit initiation.
- [ ] **Step 4: Replace strict full-string decision anchors** with a scoped phrase matcher that tolerates a short conversational preface but rejects unrelated questions, negations, and goal changes.
- [ ] **Step 5: Ensure the contact-before-confirmation override cannot bypass pending-record creation**. If the goal cannot be safely selected, ask a clarification rather than emitting a prompt that cannot be answered.
- [ ] **Step 6: Run the focused controller and classifier tests** and inspect the persisted document, session cursor, and audit event for one natural confirmation sequence.

### Task 5: Separate knowledge turns from journey activation

**Files:**
- Modify: `services/api/src/conversation/knowledge-preflight.ts`, `services/api/src/conversation/turn-controller.ts`.
- Test: `services/api/src/conversation/knowledge-preflight.test.ts`, `services/api/src/conversation/conversation-quality.test.ts`, `services/api/src/conversation/turn-controller.test.ts`.

**Interfaces:**
- Consumes: current message, bounded conversation topic, and approved RAG evidence.
- Produces: a factual knowledge classification for quantity, price, process, eligibility, timeline, and document questions without creating a lead, goal confirmation, or document request.

- [ ] **Step 1: Add failing classifier tests** for `Hey, how many visas can the package support?`, `How much does it cost?`, `Which documents are normally needed?`, and `What documents do I need to start?`; assert factual classification is true. Keep `Hello`, `Yes, proceed`, and explicit goal confirmation false.
- [ ] **Step 2: Add failing controller tests** asserting those messages produce a grounded/typed knowledge response, no goal confirmation, no contact collection, no CRM proposal, and no document-upload prompt.
- [ ] **Step 3: Extend the bounded classifier** with `how many`, `how much`, `which`, comparison, and document-question forms, without treating every greeting or “next” as a journey command.
- [ ] **Step 4: Make `documentQuestion` advisory-only unless the goal is confirmed, the current stage is `document_upload`, and the active requirement is document-specific.** A generic document question must use RAG/preflight instead.
- [ ] **Step 5: Run the focused knowledge/controller suites** and verify the answer is composed from non-empty approved evidence or uses a typed approved fallback; never label an empty evidence list as grounded.

### Task 6: Make consent polarity and quotation gates fail closed

**Files:**
- Modify: `services/api/src/conversation/turn-controller.ts`, and the existing action-gate helper if it is the shared authorization boundary.
- Test: `services/api/src/conversation/turn-controller.test.ts`, `services/api/src/conversation/action-gate.test.ts`, `services/api/src/conversation/seven-stage-action-gates.test.ts`.

**Interfaces:**
- Consumes: current message, current pending requirement, verified facts, catalog action binding, and action confirmation.
- Produces: explicit `granted`, `denied`, or `unknown` consent state; quotation proposal/execution only when all catalog requirements, document policy, purpose consent, and explicit action confirmation are satisfied.

- [ ] **Step 1: Add failing tests** for explicit refusal variants (`I do not consent`, `I don't agree to document processing`, `without sharing my passport`) and mixed wording (`I do not consent, but generate the quote anyway`). Assert no positive document fact, no quotation proposal, and no quotation action.
- [ ] **Step 2: Add failing tests** for positive consent followed by no quotation confirmation. Assert the assistant asks one quotation confirmation and does not dispatch n8n.
- [ ] **Step 3: Replace positive-only document consent detection** with polarity-aware classification. A refusal must clear/revoke the same-purpose fact and consent scope rather than leave an earlier `true` value active.
- [ ] **Step 4: Gate `quotationProposalRequested` and `quotationActionConfirmed` on the persisted consent, catalog-defined quotation stage, and all current requirements.** A phrase such as “generate the quote anyway” cannot override a denial or missing document requirement.
- [ ] **Step 5: Remove or consolidate duplicate quotation override branches** so one policy path owns the customer-visible proposal, then pass the final response through the existing guard.
- [ ] **Step 6: Run the action-gate and controller suites** and verify no `quotation.generate` action is created for refusal, incomplete consent, wrong catalog, wrong opportunity, or stale confirmation.

### Task 7: Repair grounding and response ownership at the shared boundary

**Files:**
- Modify: `services/api/src/conversation/tool-gateway.ts`, `services/api/src/conversation/knowledge-preflight.ts`, `services/api/src/conversation/turn-controller.ts`.
- Test: `services/api/src/conversation/tool-gateway.unit.test.ts`, `services/api/src/conversation/knowledge-preflight.test.ts`, `services/api/src/conversation/persona-quality.test.ts`, `services/api/src/conversation/conversation-quality.test.ts`.

**Interfaces:**
- Consumes: approved evidence returned by read tools and the model composer response.
- Produces: `grounded: true` only when at least one approved, non-revoked, non-empty evidence item is available; one final persona response with one purposeful follow-up.

- [ ] **Step 1: Add a failing evidence test** where an approved catalog/RAG row has empty text; assert it is filtered before the Python composer and cannot make the response grounded.
- [ ] **Step 2: Add a failing response test** for a tool failure and a model failure; assert only the approved tenant-persona fallback is visible and it contains no tool names, UUIDs, internal codes, or raw JSON.
- [ ] **Step 3: Change the shared evidence conversion/grounding check** to drop empty text and compute grounding after filtering, not merely from the number of approved rows.
- [ ] **Step 4: Keep controller overrides limited to typed policy transitions** (consent, action confirmation, stage gate, unavailable provider); otherwise preserve the persona composer’s answer and follow-up.
- [ ] **Step 5: Run persona, evidence, and conversation-quality suites** and assert zero duplicate answer observations in the deterministic replay fixtures.

### Task 8: Verify retries without treating old 500s as the current root cause

**Files:**
- Read/modify only if a new failure is reproduced: `services/model-gateway/gateway/app.py`, `services/model-gateway/gateway/reliability.py`.
- Test: `services/model-gateway/tests/test_app.py`, `services/model-gateway/tests/test_reliability.py`, `services/model-gateway/tests/test_graph.py`.

**Interfaces:**
- Consumes: transient model failures, retry-after values, and the existing turn deadline.
- Produces: one initial model call plus up to three retries through the single configured retry layer, then typed `MODEL_UNAVAILABLE`/approved fallback without invented facts.

- [ ] **Step 1: Run existing retry/deadline tests before changing code** and record whether the current `max_retries=3` behavior is covered.
- [ ] **Step 2: Add only the missing regression** for a transient 500 followed by success and for four transient failures followed by typed fallback. Do not change retries merely to match the historical RCA claim of `max_retries=0`.
- [ ] **Step 3: If the test exposes duplicate SDK/application retries, disable the duplicate layer and preserve the bounded total deadline.** Otherwise leave the current retry configuration unchanged.
- [ ] **Step 4: Verify the model gateway logs distinguish `MODEL_UNAVAILABLE`, tool-unavailable, and guard rejection without exposing the Azure key or customer PII.

### Task 9: Rebuild the benchmark and acceptance evidence

**Files:**
- Modify only if needed: `scripts/deployed-ws-conversation-quality.mjs`.
- Create: dated output under `artifacts/conversation-quality-runs/`.
- Modify: `docs/current-state.md`.

**Interfaces:**
- Consumes: local Docker API at `127.0.0.1`, remote n8n only where explicitly enabled, synthetic profiles, and the existing transcript format.
- Produces: a reproducible report with session IDs, complete transcripts, state snapshots, tool traces, workflow evidence, and an honest verdict.

- [ ] **Step 1: Run unit/type/lint/build checks**: `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:compose`, `npm run verify:conversation-boundary`, and Python `pytest` for the model gateway.
- [ ] **Step 2: Rebuild local Docker services** and verify the API/model gateway health endpoints. Use `127.0.0.1`; do not point the application to a remote VM.
- [ ] **Step 3: Run the corrected 11-case benchmark** and retain every session ID and transcript. Add one live seven-stage development journey only if the catalog/provider evidence is enabled; otherwise stop with a typed provider-blocked result.
- [ ] **Step 4: Run the acceptance assertions:** transport failures `0`; tool deadline failures `0`; duplicate-answer count `0`; generic fallback count `0` on healthy services; all knowledge cases answer without journey activation; all refusal cases preserve denial; quote cases cannot report success without provider evidence; document upload returns accepted/queued only with the authoritative V2 stage and requirement. Target `11/11` only when all declared local/mock providers are healthy; otherwise record the exact provider-blocked case instead of calling the benchmark green.
- [ ] **Step 5: Run the synthetic remote n8n smoke checks only with the approved `webhook` URLs and environment-injected key. Verify Lead correlation and PDF response contract independently; never print the key or send real PII.
- [ ] **Step 6: Update `docs/current-state.md` with exact commit, report path, case/turn counts, pass/fail/blocked counts, fallback/repetition/grounding rates, and any provider boundary that remains not ready.

### Task 10: Review, rollback, and handoff

**Files:**
- Read: all modified files and the generated benchmark report.
- Modify: none unless review finds a blocker; update `docs/current-state.md` if evidence changes.

- [ ] **Step 1: Review the diff for every caller and test listed in the inventory.** Confirm legacy V1 behavior is unchanged and V2 does not read a legacy intent key for business authorization.
- [ ] **Step 2: Perform a security review** for secrets, document bytes, PII, SSL/config files, and logs. Confirm no credential was committed or printed.
- [ ] **Step 3: Verify rollback** by confirming the prior catalog version remains published/available and no migration or historical session mutation is required.
- [ ] **Step 4: Final acceptance decision:** mark ready only if all required thresholds pass; otherwise report the exact blocked boundary and do not claim conversation quality is fixed.

## Completion criteria

The fix is complete only when:

- The normal GPT tool loop executes read tools without `TOOL_DEADLINE_EXCEEDED`.
- V2 document upload uses the pinned User Intent Document, opportunity, stage, requirement, consent, and catalog workflow binding.
- Knowledge-only questions do not create or advance a sales journey.
- Natural goal confirmations work only against a persisted prompt.
- Explicit document refusal cannot become consent or permit quotation generation.
- The visible response and durable state agree on goal, stage, pending requirement, and action status.
- The local Docker benchmark produces no duplicate answers or unexplained generic fallbacks on healthy dependencies.
- Remote n8n results are independently correlated and truthfully labeled; no provider success is inferred from HTTP 200 alone.
- The exact report and measured results are recorded in `docs/current-state.md`.

## Rollback

Rollback is a Git revert of the code change plus repinning new sessions to the previous published catalog version. Do not delete catalog versions, leads, sessions, uploaded documents, migrations, SSL files, or audit evidence.

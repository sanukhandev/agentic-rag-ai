# Conversation Gap Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the ANCFZ conversation answer the customer’s actual questions, preserve separate goal/consent/action confirmations, expose provider limitations truthfully, and produce a valid human-review export for the quote journey.

**Architecture:** Keep Python/model planning inference-only and keep Node responsible for evidence selection, conversation state, consent, provider readiness, action authorization, and workflow state. Improve the V2 response path and deterministic fallbacks without bypassing the existing Salesforce verification or document/package gates. Keep the local development quote executor isolated to synthetic integration tests; a live ANCFZ quote is successful only after verified Lead evidence.

**Tech Stack:** TypeScript, Express, Vitest, Next.js, PostgreSQL-backed Store, Redis-backed cache, n8n workflow callbacks, local mock PDF service, Node `fetch` API harness.

**Spec:** `AGENTS.md`, `docs/persona-response-contract.md`, `docs/agent-tool-loop.md`, `docs/intent-taxonomy.md`, `docs/conversation-planner.md`, `docs/journey.md`, `docs/n8n-workflows.md`, `docs/acceptance.md`, and `docs/verification/quote-conversation-review-2026-11-08.json`.

## Global Constraints

- Node remains the sole authority for tenant/session scope, catalog membership, consent, action eligibility, provider evidence, and persisted workflow state.
- Typed consent must not silently authorize a side effect; the existing purpose-specific consent postback remains the authorization signal.
- A Lead action must not be advertised as executable when its provider adapter or workflow callback is unavailable.
- Every factual business answer must use approved tenant-scoped evidence or an approved persona fallback; never invent a timeline or document requirement.
- Do not collect contact data during knowledge-only turns or use raw document bytes in model prompts, logs, tests, or exports.
- A quote is complete only when the approved package workflow returns a verified development artifact; `reconcile_required`, HTTP success, or PDF existence alone is not completion.
- Preserve existing legacy compatibility paths, migrations, customer records, and rollback behavior.
- Use the current checkout and branch; do not create a worktree.

## Review Focus

- A multi-part question about setup steps, timeline, and office must answer all verified parts and ask at most one purposeful follow-up.
- A documents question while goal confirmation is pending must receive a useful, privacy-safe answer without collecting PII or creating a Lead action.
- A typed `Yes` at the consent prompt must produce a clear instruction, not a generic safety refusal; only the consent postback grants purpose-specific consent.
- A missing Salesforce adapter or unregistered callback must stop before Lead action creation or make the pending state explicit; it must never look like a successful Lead.
- The live harness must stop at the first unmet prerequisite and must not attempt document upload before verified Lead, package confirmation, and approved quote.

---

### Task 1: Add regression tests for the observed conversation failures

**Files:**
- Modify: `services/api/src/v2-coordinator.test.ts`
- Modify: `services/api/src/v2-turn-controller.test.ts`
- Modify: `services/api/src/v2-provider-evidence-route.test.ts`
- Test data: existing ANCFZ V2 fixtures and current synthetic package/provider helpers

**Interfaces:**
- Consumes: existing V2 coordinator, turn-controller, catalog, persona, evidence, and action-gateway fixtures.
- Produces: failing tests that define answer completeness, interruption behavior, consent behavior, provider gating, and truthful reconciliation state for later implementation tasks.

- [ ] **Step 1: Add the multi-part knowledge test**

  In `v2-coordinator.test.ts`, add a case for a customer asking for setup steps, expected timeline, and shared-office suitability. Supply separate approved evidence items for process, timeline, and office. Assert that the answer contains one grounded sentence for each available facet, contains all corresponding citation IDs exactly once, and has no more than one final follow-up question.

- [ ] **Step 2: Add the pending-goal document interruption test**

  In `v2-turn-controller.test.ts`, create a session with a pending company-formation goal confirmation and send `What documents would you need from me?`. Assert that the result answers the document timing/requirement question from approved evidence, leaves the goal decision pending, does not create a Lead action, and keeps one goal-confirmation follow-up.

- [ ] **Step 3: Add consent and action-confirmation tests**

  Assert that a typed `Yes` while `lead_crm_consent` is pending returns a clear consent-button instruction, does not set `contactConsent` to `granted`, and does not create an action. Assert that `postbackValue: 'v2:contact-consent:grant'` grants consent and creates only the separate `lead_action_confirmation` proposal.

- [ ] **Step 4: Add provider-readiness tests**

  Add one test with an enabled `crm.lead.create` binding but no Salesforce adapter. Assert that no executable action is created and the response says Lead submission is unavailable/pending provider setup. Add a provider-ready case that preserves the current action proposal and confirmation behavior.

- [ ] **Step 5: Run the new tests and confirm they fail for the current reasons**

  Run:

  ```powershell
  npm --workspace services/api exec -- vitest run src/v2-coordinator.test.ts src/v2-turn-controller.test.ts src/v2-provider-evidence-route.test.ts
  ```

  Expected: the new tests fail before implementation, specifically on missing multi-part answers, the generic consent refusal, or premature action creation. Do not modify production code in this task.

- [ ] **Step 6: Commit the test contract**

  ```powershell
  git add services/api/src/v2-coordinator.test.ts services/api/src/v2-turn-controller.test.ts services/api/src/v2-provider-evidence-route.test.ts
  git commit -m "test: pin conversation and provider gating gaps"
  ```

### Task 2: Make factual answers cover all requested facets

**Files:**
- Modify: `services/api/src/v2-coordinator.ts`
- Modify if needed: `services/api/src/v2-knowledge-preflight.ts`
- Test: `services/api/src/v2-coordinator.test.ts`

**Interfaces:**
- Consumes: `V2ApprovedEvidence[]`, the customer query, persona language/tone, and existing citation validation.
- Produces: one persona-composed answer containing the distinct approved evidence facets and one validated follow-up question.

- [ ] **Step 1: Identify the current single-evidence selection branch**

  Start from the `selected`/`candidates` logic in `v2-coordinator.ts`. Preserve the existing package-specific behavior and citation guard. The change applies to factual knowledge answers that contain multiple requested facets, not to greetings, consent, or side-effect proposals.

- [ ] **Step 2: Add a private facet selector**

  Add a small helper in `v2-coordinator.ts` with this contract:

  ```ts
  selectKnowledgeEvidenceForFacets(
    query: string,
    evidence: V2ApprovedEvidence[],
  ): V2ApprovedEvidence[]
  ```

  It must choose at most one best approved evidence item per requested facet, retain source order for readability, remove duplicates, and never create a sentence when a facet has no approved evidence.

- [ ] **Step 3: Compose the answer with truthful gaps**

  Use the selected evidence to answer process, timeline, office, document, or package sub-questions together. If a requested facet has no evidence, state that the approved information is unavailable for that detail and continue with the verified parts. Keep exactly one follow-up question after the answer.

- [ ] **Step 4: Run the focused coordinator tests**

  ```powershell
  npm --workspace services/api exec -- vitest run src/v2-coordinator.test.ts
  ```

  Expected: all coordinator tests pass, including citation uniqueness, no unsupported timeline claims, package response behavior, and the new multi-facet case.

- [ ] **Step 5: Commit the response-composition fix**

  ```powershell
  git add services/api/src/v2-coordinator.ts services/api/src/v2-knowledge-preflight.ts services/api/src/v2-coordinator.test.ts
  git commit -m "fix: answer multi-part knowledge questions"
  ```

### Task 3: Preserve knowledge interruptions and improve document answers

**Files:**
- Modify: `services/api/src/v2-turn-controller.ts`
- Modify: `services/api/src/v2-knowledge-preflight.ts` only if document facet extraction needs a shared helper
- Test: `services/api/src/v2-turn-controller.test.ts`
- Test: `services/api/src/v2-coordinator.test.ts`

**Interfaces:**
- Consumes: pending goal decision, `isV2FactualKnowledgeQuestion`, approved evidence, current intent document, and existing `pendingPrompt` state.
- Produces: an answer-first interruption path that leaves the original goal confirmation durable and asks one goal question after the answer.

- [ ] **Step 1: Move knowledge-interruption classification before generic goal overrides**

  In `runGPTFirstChatTurn`, classify `isV2FactualKnowledgeQuestion(maskedMessage)` before the `pendingDecision` fallback that currently emits the generic company-formation prompt. A question about documents, process, timeline, or requirements must not be treated as a goal confirmation answer.

- [ ] **Step 2: Add a safe document-information fallback**

  When no approved document evidence is available, answer that exact document requirements depend on the selected approved package and that document collection starts only after package confirmation/quote. Do not list package-specific document names unless the pinned catalog supplies them. Preserve `pendingDecision` and set the follow-up to the existing goal-confirmation question.

- [ ] **Step 3: Preserve state invariants**

  Assert that the interruption does not set `goalConfirmed`, `contactConsent`, `workflowStatus`, or an action proposal. The next turn must still be able to confirm the original business goal without losing the question context.

- [ ] **Step 4: Run focused turn-controller tests**

  ```powershell
  npm --workspace services/api exec -- vitest run src/v2-turn-controller.test.ts src/v2-coordinator.test.ts
  ```

  Expected: document questions are answered, goal confirmation remains pending, and no duplicate or premature Lead action appears.

- [ ] **Step 5: Commit the interruption fix**

  ```powershell
  git add services/api/src/v2-turn-controller.ts services/api/src/v2-knowledge-preflight.ts services/api/src/v2-turn-controller.test.ts services/api/src/v2-coordinator.test.ts
  git commit -m "fix: preserve knowledge interruptions during goal confirmation"
  ```

### Task 4: Make consent and Lead submission confirmation explicit

**Files:**
- Modify: `services/api/src/v2-turn-controller.ts`
- Modify only if copy/state metadata requires it: `apps/web/app/page.tsx`
- Test: `services/api/src/v2-turn-controller.test.ts`
- Test: existing chat action route coverage in `services/api/src/app` tests or the closest current route test

**Interfaces:**
- Consumes: `postbackValue`, `contactRequirementAfterDecision`, `explicitLeadActionConfirmation`, and existing `consentProposal`/`actionProposal` payloads.
- Produces: a clear consent prompt for typed acknowledgements, a separate Lead submission confirmation, and no implicit side effect.

- [ ] **Step 1: Replace the generic typed-consent refusal**

  Keep `v2:contact-consent:grant` as the only typed input that changes `contactConsent` to `granted`. For a plain `Yes` or similar acknowledgement while consent is pending, return a tenant-persona-safe instruction to use the consent control; keep `pendingRequirementKey` at `lead_crm_consent` and return no action proposal.

- [ ] **Step 2: Keep consent and Lead submission separate**

  After the consent postback, return the existing `lead_action_confirmation` requirement and action proposal with `consentRequired: false`. Do not call the action confirmation endpoint from the chat-turn code; the UI/API confirmation remains the separate explicit side-effect authorization.

- [ ] **Step 3: Add a typed confirmation compatibility path**

  If the customer types an explicit phrase matching `explicitLeadActionConfirmation`, allow the existing confirmation path only when the action is current, the goal is confirmed, consent is granted, and provider readiness is true. A plain `Yes` must not submit a Lead unless it is tied to the rendered confirmation action.

- [ ] **Step 4: Verify the web card behavior**

  Confirm `apps/web/app/page.tsx` continues to render “Consent & Continue” for `consentProposal` and “Confirm & Submit” for the Lead action proposal. Change copy only if the API response requires a distinct label; do not add a second consent mechanism.

- [ ] **Step 5: Run the consent/action tests**

  ```powershell
  npm --workspace services/api exec -- vitest run src/v2-turn-controller.test.ts
  npm --workspace services/api exec -- eslint src/v2-turn-controller.ts src/v2-turn-controller.test.ts --max-warnings 0
  ```

  Expected: typed consent is clear but non-authorizing, postback consent is granted, Lead submission remains a separate confirmation, and changed-file lint passes.

- [ ] **Step 6: Commit the consent fix**

  ```powershell
  git add services/api/src/v2-turn-controller.ts services/api/src/v2-turn-controller.test.ts apps/web/app/page.tsx
  git commit -m "fix: separate consent from lead submission"
  ```

### Task 5: Gate Lead proposals on provider readiness

**Files:**
- Modify: `services/api/src/v2-turn-controller.ts`
- Modify: `services/api/src/app.ts`
- Test: `services/api/src/v2-turn-controller.test.ts`
- Test: `services/api/src/v2-provider-evidence-route.test.ts`
- Update: `docs/current-state.md`

**Interfaces:**
- Consumes: a Node-owned provider readiness value derived from the configured Salesforce Lead adapter and the active catalog binding.
- Produces: a `leadProviderReady` input to `runGPTFirstChatTurn`; unavailable providers produce a truthful pending response and no executable action.

- [ ] **Step 1: Add provider readiness to the GPT-first turn input**

  Extend `GPTFirstTurnInput` with:

  ```ts
  leadProviderReady: boolean
  ```

  Pass `Boolean(salesforceLeadProvider)` from `app.ts`. Do not send provider secrets or adapter details to Python/model context.

- [ ] **Step 2: Apply the readiness gate before action creation**

  In `v2-turn-controller.ts`, treat an enabled `lead.create` binding with `leadProviderReady === false` as unavailable. Return a clear persona response saying the Lead cannot be submitted yet and preserve the current journey state. Do not call `actionGateway.propose`.

- [ ] **Step 3: Preserve provider evidence validation**

  Keep `/api/v2/internal/provider-evidence/verify` unchanged as the authoritative completion path when the adapter is ready. `reconcile_required` remains valid for an already-dispatched action or an external provider failure; it must not be the normal first response when readiness is known to be absent.

- [ ] **Step 4: Add tests for both states**

  Assert unavailable provider: no action row, no Lead confirmation card, explicit response, and no contact data write. Assert ready provider: existing action proposal and confirmation flow remain unchanged. Assert provider evidence still transitions the action only with matching correlation and verified evidence.

- [ ] **Step 5: Update the runtime status documentation**

  Record the exact readiness rule and current local status in `docs/current-state.md`. Keep the local development quote executor marked mock-only and do not enable a production/provider binding through a test.

- [ ] **Step 6: Run focused provider tests**

  ```powershell
  npm --workspace services/api exec -- vitest run src/v2-turn-controller.test.ts src/v2-provider-evidence-route.test.ts
  npm --workspace services/api exec -- eslint src/app.ts src/v2-turn-controller.ts src/v2-turn-controller.test.ts --max-warnings 0
  ```

  Expected: provider-unavailable tests pass, provider-ready tests pass, and no action is proposed when Salesforce is not configured.

- [ ] **Step 7: Commit the provider gate**

  ```powershell
  git add services/api/src/app.ts services/api/src/v2-turn-controller.ts services/api/src/v2-turn-controller.test.ts services/api/src/v2-provider-evidence-route.test.ts docs/current-state.md
  git commit -m "fix: gate lead proposals on provider readiness"
  ```

### Task 6: Correct the live API harness and human-review export

**Files:**
- Modify: `scripts/live-quote-conversation.mjs`
- Test/run output: `docs/verification/quote-conversation-review-2026-11-08.json`
- Generated local-only artifact: `artifacts/ancfz-sandbox-YYYY-MM-DD/ancfz-development-quote-live-review.pdf`
- Update: `docs/current-state.md`

**Interfaces:**
- Consumes: public chat API, consent postback, action confirmation endpoint, action status endpoint, package API, document configuration, document upload API, and quote download API.
- Produces: a redacted transcript with explicit milestone states and a truthful `blockedAt` or `quoteGenerated` result.

- [ ] **Step 1: Make the script represent user actions accurately**

  Record separate events for `goalConfirmation`, `contactConsent`, `leadSubmissionConfirmation`, `providerEvidence`, `packageSelection`, `quoteExecution`, `quoteDownload`, and `documentUploads`. Do not confirm a Lead action immediately after consent unless the harness has recorded the explicit Lead confirmation action.

- [ ] **Step 2: Stop at unmet prerequisites**

  If Lead action status is not `completed` with verified provider evidence, record the customer-facing reconciliation response and stop before package selection, quote execution, or document upload. This prevents false `DOCUMENT_REQUIREMENT_NOT_ACTIVE` results caused by testing documents too early.

- [ ] **Step 3: Use catalog requirement keys correctly**

  When the quote path is reached, read `documents/config.requirements` and map the selected package’s required document type to the active `requirementKey`. Never assume `package.requiredDocuments` values are directly valid upload requirement keys.

- [ ] **Step 4: Preserve privacy**

  Keep document bytes out of the JSON report. Store only filename, MIME type, status, size, and digests. Redact emails, phones, UUIDs, access tokens, and raw action identifiers from the export.

- [ ] **Step 5: Add harness assertions**

  Assert that no document upload occurs before verified Lead/package/quote prerequisites. Assert that a successful quote includes `verified: true`, a mock/development label, artifact metadata, and a downloaded PDF whose SHA-256 matches the API response. Assert that a blocked run reports the exact blocked stage and reason.

- [ ] **Step 6: Run the live API test**

  ```powershell
  node --env-file=.env scripts/live-quote-conversation.mjs
  ```

  Expected with the current local environment: the conversation answers, consent postback, and provider-blocked follow-up are recorded; no package/quote/document calls occur after the provider gate. Expected with a configured sandbox provider: the full Lead → package → mock quote → download path completes and the PDF remains outside Git.

- [ ] **Step 7: Commit the harness/export update**

  ```powershell
  git add scripts/live-quote-conversation.mjs docs/verification/quote-conversation-review-2026-11-08.json docs/current-state.md
  git commit -m "test: make live quote journey export truthful"
  ```

### Task 7: Full verification and handoff

**Files:**
- Verify: all changed files and generated review export
- Update if needed: `docs/current-state.md`

**Interfaces:**
- Consumes: completed Tasks 1–6 and the current Docker Compose environment.
- Produces: repeatable verification evidence and a clear acceptance status.

- [ ] **Step 1: Run the full unit suite**

  ```powershell
  npm test
  ```

  Expected: all existing and new workspace tests pass.

- [ ] **Step 2: Run typecheck, build, focused lint, n8n, and PDF tests**

  ```powershell
  npm run typecheck
  npm --workspace services/api run build
  npm --workspace services/api exec -- eslint src/app.ts src/v2-coordinator.ts src/v2-turn-controller.ts src/routes/lifecycle.ts src/v2-provider-evidence-route.test.ts --max-warnings 0
  node --test infra/n8n/workflows/ancfz-v2-templates.test.mjs
  python -m pytest tools/anc/pdf_service/test_render.py -q
  git diff --check
  ```

  Expected: all commands pass. If full API lint still reports the known `runtime-security.test.ts` `no-explicit-any` baseline errors, record them without mixing them into the changed-file result.

- [ ] **Step 3: Rebuild and check the local stack**

  ```powershell
  docker compose build
  docker compose up -d
  Invoke-WebRequest -UseBasicParsing http://127.0.0.1/api/v1/health/ready
  docker compose ps
  ```

  Expected: API, PostgreSQL, Redis, model gateway, PDF service, and n8n are healthy enough for the selected test path.

- [ ] **Step 4: Review the export manually**

  Confirm the transcript has no raw document data, no unrecorded action confirmation, no package/quote claims after a blocked Lead, and one clear next step after reconciliation.

- [ ] **Step 5: Update acceptance status**

  In `docs/current-state.md`, distinguish:

  - conversation-quality path: passed;
  - provider-backed Lead path: passed only when Salesforce adapter and callback are configured;
  - local mock quote/PDF path: passed by synthetic integration test;
  - document upload path: passed only after active catalog requirements and SF-02 binding are enabled.

- [ ] **Step 6: Final review before integration**

  ```powershell
  git status --short --branch
  git log -1 --oneline
  ```

  Do not push or claim quote completion if the live report says `providerGate`, `quoteGenerated: false`, or `quoteDownloadable: false`.

## Self-Review

- The plan covers every observed gap in the exported conversation: incomplete answers, unanswered documents question, typed consent refusal, provider reconciliation, missing explicit Lead confirmation, premature document upload, and vague recovery copy.
- No task authorizes bypassing Salesforce provider evidence or changing the published ANCFZ catalog merely to make the live test green.
- The plan keeps the existing UI consent/action cards and changes only the API/controller behavior needed to make their states truthful.
- The live harness and export are treated as test evidence, not as a second business workflow.
- No raw identity-document bytes or customer PII are added to Git.

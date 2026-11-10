# Quote Conversation Acceptance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quote journey conversationally valid and make live evidence fail whenever the assistant breaks, even if direct workflow endpoints succeed.

**Architecture:** Keep GPT responsible for turn interpretation and natural responses. Keep Node responsible for catalog state, requirement validation, consent, action authorization, idempotency, and provider evidence. The live acceptance script must drive the journey through chat turns and use direct APIs only for readback and artifact verification.

**Tech Stack:** Next.js/React WebSocket client, Node/TypeScript API, Python Azure GPT gateway, PostgreSQL, Redis Streams, n8n quote workflow, local development providers.

**Spec:** `AGENTS.md`, `docs/conversation-planner.md`, `docs/agent-tool-loop.md`, `docs/persona-response-contract.md`, `docs/journey.md`, `docs/n8n-workflows.md`.

## Global Constraints

- Use the configured Azure model deployment for live conversation; do not add hardcoded assistant test responses.
- Do not let model output authorize Salesforce, quote, document, payment, or contract side effects.
- Preserve tenant/session isolation, consent, idempotency, provider verification, and truthful mock/development labels.
- Keep the seven-stage lifecycle ordered; this acceptance slice ends at quote generation and document handoff.
- Do not treat HTTP 200/202, a local action row, PDF existence, or `mock=true` as conversational success.
- No unit-test-only acceptance; verification is live API/WebSocket execution with persisted audit, action, provider, and PDF readback.

## Review Focus

- A knowledge/document question must be answered in the active company-formation context instead of restarting goal confirmation.
- A short `Yes` must resolve only the currently pending consent or confirmation state and must not fall into a generic grounding fallback.
- A response-guard rejection must produce a useful, state-specific recovery message and must not repeat the same fallback across turns.
- Quote and document success must be impossible to report unless the chat transcript itself reached the required action states.
- Reconnect, duplicate sends, and session reset must not attach a new quote action to an old WebSocket/session.

---

## Verified Failure Baseline

The evidence file `docs/verification/quote-conversation-live-review.json` is a failed conversational acceptance run:

- Turn 1 incorrectly emits a process-knowledge abstention for a greeting/goal exploration.
- Turn 2 produces a grounded two-hour claim, but the evidence report does not include citations or guard proof.
- Turn 3 answers a document question with another goal-confirmation prompt.
- Turn 7 rejects a valid consent response with the generic safety fallback.
- Turn 9 rejects the document handoff with the same fallback.
- The script then reports success because it confirms the lead, selects a package, creates a quote, downloads a PDF, and uploads a document through direct endpoints.

The script therefore proves provider/API plumbing only; it does not prove a successful conversation.

## Context-First Conversation Contract

For every substantive turn, the controller must follow this order:

1. Load the authoritative session by `sessionId` and verify tenant/session access.
2. Read the pinned catalog, persona, active opportunity, journey stage, pending requirement, verified facts, action state, document state, and latest bounded history.
3. Give GPT the bounded summary and recent turns already available in the envelope.
4. Let GPT request `get_conversation_context` or `get_conversation_history_summary` when the current envelope is insufficient, especially for short replies, corrections, anaphora, interruptions, and “what did I say?” questions.
5. Let GPT request the matching read-only catalog, requirements, document, package, knowledge, or action-status tool when the answer needs system data.
6. If the required system data is unavailable, ask the customer for the missing fact or explain the temporary limitation; never fill the gap with a guessed fact.
7. Node validates the plan, evidence, pending requirement, consent, and action eligibility, then persists state before publishing the response.

The current code has two competing read-tool paths. The legacy `services/api/src/agent-tools.ts` path still constructs a lexical `deterministicPlan` and merges it with model calls, while the V2 path exposes the proper `get_conversation_context` and `get_conversation_history_summary` tools. This can cause unnecessary or incorrect retrieval before GPT has interpreted the turn. The fix must converge the active runtime on one context-aware model tool loop.

## Root-Cause Fix Tasks

### Task 0: Establish one context-first turn pipeline

**Files:**
- Modify: `services/api/src/app.ts`
- Modify or retire after migration: `services/api/src/agent-tools.ts`
- Modify: `services/api/src/conversation/tool-gateway.ts`
- Modify: `services/api/src/conversation/tool-policy.ts`
- Modify: `services/api/src/conversation/turn-controller.ts`
- Modify: `services/model-gateway/gateway/tool_definitions.py`
- Modify: `services/model-gateway/gateway/agent.py`

**Interfaces:**
- The active GPT turn receives an authorized context envelope and can call bounded read-only tools.
- Node remains the sole owner of session access, tenant scope, catalog version, state revision, and side effects.

- [ ] Inventory every caller of `runAgentTools`, legacy `model.plan`, `planV2`, and `executeV2Turn`; identify which path is customer-facing in Docker.
- [ ] Make the customer-facing path use the V2 context-aware tool loop as the single planner/composer path. Do not run a lexical tool preflight before GPT.
- [ ] Implement/standardize `get_conversation_context` to return a bounded, sanitized snapshot containing: session ID scope, catalog/persona revision, active goal, confirmation status, current stage, pending requirement, verified facts with provenance, recent customer/assistant turns, rolling summary, open actions, document statuses, and last tool/provider statuses.
- [ ] Implement/standardize `get_conversation_history_summary` to return a server-generated bounded summary plus the minimum recent turns needed to resolve the current message. Return an explicit `context_unavailable` status if Redis is unavailable and PostgreSQL cannot provide the requested data.
- [ ] Require the model to call the context/history tool when the envelope lacks enough information to resolve a short answer, correction, reference, or pending workflow response. Do not silently proceed with stale or empty context.
- [ ] Keep tool calls bounded, tenant-scoped, read-only, and pinned to the session catalog revision. A failed context tool must produce a truthful “I need one clarification” response, not a factual answer.
- [ ] Verify with a live conversation that “Yes”, “that one”, “what did I tell you?”, and “what do I need next?” use the active session context and do not restart the goal.

### Task 1: Make the live acceptance report fail on conversational breaks

**Files:**
- Modify: `scripts/live-quote-conversation.mjs`
- Modify: `docs/verification/quote-conversation-live-review.json` by regeneration only

**Interfaces:**
- Produces a report with per-turn acceptance results, guard evidence, action provenance, provider evidence, and a final `conversationAccepted` boolean.

- [ ] Replace the current “send fixed turns, then direct-confirm” flow with a stateful conversation driver. After each response, assert the expected semantic state: active goal, pending requirement, consent state, action proposal, and whether the user has explicitly confirmed the next side effect.
- [ ] Add transcript gates for: document answer, contact fact acknowledgement, consent acceptance, explicit lead confirmation, package presentation, package selection, quote readiness, quote completion, and document handoff.
- [ ] Remove direct `actions/:id/confirm`, `packages/select`, and `packages/quotes` calls from the conversational path. Use chat/postback messages for those actions; retain read-only action/status, quote download, document config, and provider readback checks.
- [ ] Record request IDs, response citations, response grounding, guard reason, tool statuses, and action IDs in redacted form so a green report is explainable.
- [ ] Make the process exit non-zero for any fallback, invalid question, unsupported claim, missing citation, missing explicit confirmation, action without transcript authorization, or missing provider evidence.
- [ ] Verify live with the existing local Docker stack and Azure model. Expected result: the current scenario fails before any code fix, reproducing the report’s false-green behavior.

### Task 2: Fix active-context document and knowledge turns

**Files:**
- Modify: `services/api/src/conversation/turn-controller.ts`
- Modify: `services/api/src/conversation/coordinator.ts`
- Modify: `services/model-gateway/gateway/persona_composer.py`
- Modify: `services/model-gateway/gateway/agent.py` only if the tool-loop contract needs a bounded repair

**Interfaces:**
- The turn envelope must expose the active goal, stage, pending requirement, verified facts, required documents, and authorized read tools.
- The final response remains a persona-composed response guarded by Node.

- [ ] For “What documents do you need?” while `anc.company_formation` is active, authorize `get_document_requirements`, return the current requirement evidence, and compose a direct answer. Do not run goal confirmation again.
- [ ] For “What do I need to provide next?” after quote completion, use the document stage requirement as the primary context and compose the upload request from the authorized document policy.
- [ ] Separate greeting/general conversation, knowledge answer, requirement collection, and workflow confirmation in the model turn contract so a goal mention does not force a workflow prompt.
- [ ] Remove or narrow hardcoded customer-facing phrases in `turn-controller.ts` such as “I’ll first register your enquiry…”; Node may set state, but the final customer wording must come from the persona response path.
- [ ] Add a bounded recovery path for guard rejection: first retry with the exact pending requirement and approved tool evidence; if still rejected, return a state-specific fallback such as the pending requirement request, not the generic “cannot verify” text.
- [ ] Ensure repeated guard rejection is logged with a request ID and does not mutate the pending requirement or advance the stage.
- [ ] Verify live with greeting, document question, correction, and post-quote document question before running the full workflow.

### Task 2A: Prevent false claims when context or evidence is missing

**Files:**
- Modify: `services/api/src/conversation/coordinator.ts`
- Modify: `services/api/src/conversation/response-guard.ts`
- Modify: `services/model-gateway/gateway/persona_composer.py`
- Modify: `services/api/src/conversation/fallbacks.ts`

- [ ] Distinguish three cases in the response contract: context missing, authoritative evidence missing, and model answer rejected. Each case gets a useful persona-consistent response.
- [ ] If context is missing, ask a focused clarification that names only the missing customer-visible detail; do not claim a process, price, requirement, or action state.
- [ ] If evidence is missing, say the specific fact is not currently verified and ask whether the customer wants to provide the missing detail or continue with another part of the journey.
- [ ] If a model answer is rejected, run one bounded repair using the exact pending requirement and tool evidence. If repair fails, preserve the state and ask the pending requirement directly.
- [ ] Add a repetition guard so the same fallback cannot be emitted for two consecutive substantive turns without either a new clarification question or a terminal handoff.
- [ ] Verify live with unavailable knowledge, unavailable context, failed tool, and unsupported model claim scenarios.

### Task 2B: Make transient failures recoverable without duplicating turns

**Files:**
- Modify: `services/model-gateway/gateway/reliability.py`
- Modify: `services/model-gateway/gateway/agent.py`
- Modify: `services/api/src/conversation/coordinator.ts`
- Modify: `services/api/src/chat-stream.ts`
- Modify: `services/api/src/chat-turn-queue.ts`
- Modify: `services/api/src/app.ts`

- [ ] Apply one retry policy to Azure/model inference and read-only tool calls: one initial attempt plus at most three retries, exponential backoff starting at three seconds, jitter, and respect for `Retry-After` headers. Do not stack SDK and application retries.
- [ ] Enforce one total turn deadline across context retrieval, tool calls, model calls, guard repair, and response publication. A retry must not consume the entire user-visible turn without progress.
- [ ] Classify failures as retryable (timeout, connection reset, 408, 409, 429, 5xx), non-retryable (auth, invalid request, policy rejection), or state conflict. Never retry side-effecting actions as model calls.
- [ ] Publish progress events such as `turn.accepted`, `context.loading`, `model.retrying`, `workflow.pending`, and terminal `turn.completed` or `turn.failed` over Redis/WebSocket.
- [ ] On terminal overload or timeout, show a clear customer message that the conversation is busy and ask them to try again; do not return an ungrounded answer.
- [ ] Make every turn idempotent by `sessionId + clientMessageId`; replaying a WebSocket event or reconnecting must not invoke GPT or a business action twice.
- [ ] On Redis loss, reload verified session state and summary from PostgreSQL. Redis may delay the turn but must not cause the system to answer from an empty context.
- [ ] Reclaim abandoned Redis jobs after restart, preserve event IDs for reconnect replay, and publish exactly one terminal event per client message.
- [ ] Verify live with forced model timeout, tool timeout, Redis restart, WebSocket reconnect, duplicate client message, and queue overload scenarios.

### Task 3: Resolve pending consent and action confirmations from state

**Files:**
- Modify: `services/api/src/conversation/turn-controller.ts`
- Modify: `services/api/src/conversation/conversation-decision.ts` and/or the existing intent decision helper, only where the pending-state contract belongs
- Modify: `services/api/src/app.ts` only if action confirmation provenance needs to be persisted at the chat boundary

**Interfaces:**
- A pending requirement remains authoritative until a validated customer response satisfies it.
- Side-effect actions are created and confirmed only through the trusted action gateway.

- [ ] When `lead_crm_consent` is pending, interpret an affirmative short response in the context of that pending consent request and produce a consent-approved state; do not require a second paraphrased consent sentence.
- [ ] When `lead_action_confirmation` is pending, require a separate explicit customer confirmation to submit the lead. Do not infer it from contact consent or from the existence of an action proposal.
- [ ] Persist confirmation provenance: source turn ID, normalized decision, purpose, and catalog revision.
- [ ] Reject stale, contradictory, or unrelated confirmations without losing the active goal or already verified facts.
- [ ] Verify live that `Yes` resolves consent, the next assistant turn asks for lead submission confirmation, and only a later explicit confirmation creates/completes the Lead.

### Task 4: Make quote selection and generation genuinely conversational

**Files:**
- Modify: `apps/web/app/page.tsx`
- Modify: `services/api/src/conversation/turn-controller.ts`
- Modify: quote/action routes in `services/api/src/app.ts` only for missing event/provenance fields
- Modify: `scripts/live-quote-conversation.mjs`

**Interfaces:**
- Package options come from the authorized package tool/catalog.
- Package selection and quote generation are action proposals with idempotency and verified n8n/provider results.

- [ ] Have the assistant present approved packages after lead completion and let the user select one through the chat response/postback path.
- [ ] Require explicit package confirmation before dispatching the n8n quote workflow.
- [ ] Publish and consume quote action progress/completion events so the WebSocket client can show pending, completed, blocked, or failed states truthfully.
- [ ] Validate quote readback against session, opportunity, package, customer identity, amount, currency, artifact hash, and provider evidence.
- [ ] Ensure the UI creates the downloadable attachment only from the verified completed quote action, never from a local optimistic message.
- [ ] Verify that the quote PDF contains customer name, email, phone, selected package, amount/currency, and development/mock evidence status.

### Task 5: Remove misleading fixture and evidence gaps

**Files:**
- Modify the canonical local catalog/package fixture that currently exposes `ANCFZ Growth (sample)` if it is not an approved display name
- Modify: `scripts/live-quote-conversation.mjs`
- Modify: `docs/current-state.md`

- [ ] Replace sample-facing package labels with approved human-readable development labels, or explicitly mark every package as development-only in the UI and report.
- [ ] Fix report mapping of quote amount: read `amountMinor` and `currency`, then derive the displayed AED amount instead of reading nonexistent `totalAed`.
- [ ] Distinguish `n8nDispatched`, `providerVerified`, `quoteApproved`, `pdfIntegrityVerified`, and `downloadable`; do not derive provider dispatch from an action state alone.
- [ ] Record OCR/document status beyond upload acceptance: queued, processing, completed, failed, or human review.
- [ ] Update current-state documentation with the failed baseline and the final live acceptance result.

### Task 6: Include WebSocket/session lifecycle in the acceptance path

**Files:**
- Modify: `apps/web/app/chat-stream-client.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `scripts/live-quote-conversation.mjs` or a companion live WebSocket script

- [ ] On New Session, close and clear the current stream/token and remove both session local-storage keys.
- [ ] Recreate or re-authenticate the stream when the requested session differs from the authenticated session.
- [ ] Decide and implement one UX contract: either create the new session immediately and display its ID, or display “Not started” until the first message; the report must verify the chosen behavior.
- [ ] Verify reconnect replay, duplicate client message IDs, and quote completion events do not duplicate CRM or quote actions.

## Final Live Acceptance

- [ ] Rebuild local Docker with Azure model mode and no hardcoded test response path.
- [ ] Run the revised conversation using synthetic contact data and a synthetic identity document.
- [ ] Run the scenario through chat only: greeting → goal → knowledge/document question → confirmation → contact details → consent → explicit Lead confirmation → package presentation → package selection → quote generation → PDF download → document request → upload/OCR status.
- [ ] Run interruption/correction cases: unrelated knowledge question, corrected visa count, repeated “yes”, reconnect, duplicate send, and tool/provider failure.
- [ ] Verify PostgreSQL audit, action idempotency, Redis event replay, n8n callback/provider evidence, Salesforce/mock CRM fields, quote PDF fields, and document status.
- [ ] Regenerate `docs/verification/quote-conversation-live-review.json` only if every conversational and provider gate passes.
- [ ] Do not mark the quote workflow complete if any assistant response is a generic fallback, any direct API bypass is required, or any external completion lacks authoritative evidence.

## Acceptance Threshold

The corrected run is accepted only when:

- every substantive turn receives a contextually valid response;
- no repeated generic fallback occurs;
- the user’s `Yes` consent is processed in context;
- the Lead is created only after explicit lead confirmation;
- package selection and quote generation are driven through chat;
- quote PDF and document upload are verified;
- no duplicate action is created after reconnect/replay;
- the report’s `conversationAccepted`, `workflowAccepted`, and `providerEvidenceVerified` fields are all `true`.

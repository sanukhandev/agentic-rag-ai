# Continuous lead conversations: implementation plan

Status: in progress on `feat/generic-lead-conversation-continuity`.

## Verified baseline

The local `anc-test` tenant has a published intent catalog and active, tenant-scoped RAG sources. The existing flow already persists masked conversation state, catalog slots, consent, actions, workflow status, document policies and a rolling summary. The CRM action is asynchronous and the post-capture path is intended to keep the session open.

The latest local reproduction was:

1. `hello` — greeting succeeded.
2. `I would like to set up a Fashion Boutique` — the published catalog did not contain a matching business-activity signal, so the response abstained.
3. `start a company` — the company setup intent and grounded sources were selected.
4. `what all are the requirements?` — the response abstained even though the tenant corpus contains requirements material.
5. `yes 2 weeks` — the response abstained instead of treating the message as an answer to the active journey.

The repository contains bounded lead, summary and OCR n8n workflows. The failure occurs before workflow orchestration: Node's catalog continuity and grounded-response gates are losing the active journey. No new n8n chain is required for this fix.

## Gap analysis

| Area | Finding | Change |
| --- | --- | --- |
| Intent catalog | A visitor's business activity can be a valid company-formation requirement without matching a signal such as `fashion boutique` or `start a business`. The normalizer is vocabulary assistance, not an intent classifier; its output still has to match a published signal. | Keep classification catalog-driven, use the configured model normalizer as vocabulary assistance, and publish reviewed canonical paraphrases through the catalog. Tenant catalog signals remain data, not code constants. |
| Conversation state | A completed/queued action can be treated as a new lead request when the next turn contains a strong intent. | Treat approved, processing, completed, human-review and reconciliation actions as an existing opportunity. Store a detected follow-up intent as candidate/secondary context without resetting consent, primary intent or creating another lead. |
| Retrieval query | Follow-up retrieval concatenated too much raw history and full-text ranking was diluted by summary terms. | Keep the full bounded masked context for vector ranking, but build PostgreSQL full-text candidates from the current normalized question and generic catalog hints only. Use OR-fused text candidates with tenant/source filters. |
| Grounding gate | A short answer such as `yes 2 weeks` is routed through the factual model path. When it has no citations, the final gate replaces the natural response with an abstention. | Recognize short contextual replies only when there is an active post-capture journey and no new catalog intent. Allow a model-generated, no-fact continuation response under a strict deterministic safety check; factual answers still require evidence. |
| Follow-up context | The model receives only `leadCaptured`, primary intent and document status. | Pass workflow phase/status, masked structured slots, masked rolling summary, detected secondary intent and document policy context. Never pass raw PII. |
| RAG content | The current source corpus is active and searchable, but answer quality depends on exact normalized query terms and current embeddings. | Reuse the existing hybrid PostgreSQL/pgvector search. Re-ingestion is a data operation after the catalog/content review; it is not a substitute for state continuity. |
| n8n | Existing workflows are bounded and action-gated. | Keep them unchanged for this fix; verify that one logical lead remains linked to the session and callbacks update the existing state. |

## Plan amendment — catalog-guided intent journeys

This amendment turns the published intent catalog into a bounded conversation strategy without moving orchestration authority into the LLM or n8n. The catalog decides which visitor-supplied requirements, documents and consent gates are needed; Node validates and persists progress; the model only writes the natural-language response from that approved decision.

### Required semantics

The following terms are deliberately separate:

- **Detected intent** — a scored proposal from the current message and masked conversation context.
- **Active intent** — the one intent currently being completed. Only this intent owns the next requirement question.
- **Paused intent** — an intent detected and retained for later continuation, but not currently collecting requirements.
- **Fulfilled intent** — all catalog-required conversational requirements, documents and consent gates for that intent have passed validation.
- **External completion** — a separate provider result such as Salesforce or OCR completion. It is never assumed from intent fulfillment or workflow acceptance.
- **Farewell** — the only normal transition that closes the session.

An intent with no required requirements is fulfilled only after its catalog-defined confidence and authorization gates pass. A provider workflow reaching `completed` may enrich the journey but must not close it.

### Catalog contract to add

Add a typed, backward-compatible requirement and journey section to the catalog. Do not encode tenant names, business terms or question text in TypeScript. Existing catalogs without this section must continue to use the current slot-only behavior.

The contract must validate, at minimum:

- `intentKey` references an active catalog intent.
- Each requirement has a unique key within its intent.
- Requirement kind is one of `slot`, `document`, `consent` or `confirmation`.
- Collection order is a non-negative bounded integer.
- Slot requirements reference a catalog slot; document requirements reference an allowed document type/policy.
- Prompt keys are semantic catalog keys, not visitor-facing text.
- Required and optional requirements are explicit.
- Fulfillment mode is `conversation_ready` or `external_confirmation_required`.
- Follow-up references point to known intents and have a bounded depth.

The catalog must also define whether a completed intent automatically activates a related intent or offers it to the visitor. The safe default is `offer`; automatic activation requires an explicit catalog setting and cycle protection.

Do not reuse the current primitive-only `documentRequirements` extension rows for nested journey rules. Either introduce typed rows or reject unsupported shapes during catalog validation rather than silently dropping them.

### Conversation state contract

Keep the existing `chat_sessions.conversation_state` JSON and optimistic state-version update. Do not add a new table unless measured state growth requires it. Add a bounded, versioned `intentProgress` structure containing:

- pinned catalog version;
- active intent key;
- paused and fulfilled intent keys;
- per-intent completed requirement keys;
- current requirement key;
- requirement provenance and validation status;
- visited intent keys and transition reason;
- per-intent consent purpose/status;
- journey revision.

`activeFollowUpIntentKey` and `candidateIntentKeys` remain readable for backward compatibility, but new logic must not treat them as a fulfillment queue. Old state is migrated in memory with empty progress and written back through the existing compare-and-swap path.

Use a bounded maximum for active, paused and fulfilled intent entries and requirement keys. Reject or defer catalog journeys that exceed the bound so prompts, summaries and database rows cannot grow without limit.

### Deterministic journey reducer

Implement the journey decisions as a small pure policy module called by `app.ts`. It must handle:

1. current-message intent evidence;
2. pending requirement answers and corrections;
3. factual knowledge questions that temporarily suspend collection;
4. explicit intent switches;
5. related-intent detection and pause/resume;
6. requirement fulfillment;
7. next-intent offer or activation;
8. farewell and session closure.

The reducer returns a typed decision such as `answer`, `collect_requirement`, `retrieve_knowledge`, `offer_next_intent`, `confirm_consent`, `queue_action`, `await_external_completion` or `close_session`. It never calls the model, n8n, Salesforce or the database.

The reducer must reject cycles, repeated answered requirements, stale catalog versions and transitions from a denied or revoked consent state. It must ask at most one question or present one document action per turn.

### Document and OCR rules

Document requirements must be tied to a specific active intent and requirement key. `PendingPrompt` and the upload request must identify the requirement being satisfied; `primaryIntentKey` alone is not sufficient when one intent requires multiple documents. Upload authorization may use the existing document endpoint, but the request must identify the requirement being satisfied. An upload is not fulfillment: the requirement becomes complete only after the authenticated OCR result passes document type, confidence, authorization and idempotency checks.

OCR failure, timeout, missing input and low confidence leave the requirement pending and produce a safe retry/review state. A late callback cannot mark a newer corrected document as complete. Existing private storage, document policies and workflow bindings remain authoritative.

### Consent and side-effect rules

Consent is scoped to the exact purpose, intent, catalog version and action class. Consent for initial CRM lead creation must not authorize a later document transfer, CRM enrichment or unrelated intent. A new side-effect purpose requires a new explicit consent decision even when the visitor's email or phone is already known.

Node remains the only authority for action authorization. Intent fulfillment may prepare an action, but it cannot create or approve one without the existing validation, consent, idempotency and workflow-binding gates.

### RAG and model boundary

For each turn, build retrieval context from the current masked message, active intent, current requirement, validated masked slots, bounded summary and limited recent turns. Apply tenant, audience, publication and source-status filters before vector or full-text retrieval.

The backend provides the model with a typed response envelope containing the approved mode, active intent, next requirement, masked context, verified action state and authorized evidence. The model returns wording and citation IDs only. It cannot select the next intent, mark a requirement complete, grant consent, select a workflow or claim provider success.

Existing safe hardcoded responses remain allowed only for security, unavailable dependency, unsupported-content, consent-denial and session-closure boundaries. Normal visitor replies must be model-composed from the approved decision and evidence.

### Implementation order and validation gates

1. Define and validate the catalog contract with backward-compatible defaults.
2. Add the bounded `intentProgress` state and merge/CAS rules.
3. Implement and unit-test the pure journey reducer.
4. Connect slot, document, consent, OCR and action gates to the reducer.
5. Update model context modes without allowing model authority over state.
6. Add admin read visibility for active intent, pending requirement and fulfillment status.
7. Run API, persistence, privacy, tenant-isolation, RAG, document, workflow and browser tests.
8. Review the complete diff, catalog fixtures and migration compatibility before committing.

No n8n workflow is created for conversation strategy. Existing CRM/OCR workflows remain bounded side-effect adapters and receive only backend-authorized events.

### Blind-spot checklist

Before implementation is marked complete, explicitly verify:

- catalog publish during an active session does not change the pinned journey;
- a summary or model suggestion cannot promote an intent or requirement to fulfilled;
- a multi-intent message creates one active journey plus bounded paused candidates, not multiple leads;
- a relation graph cannot cause an activation loop;
- a visitor can correct a slot or replace a document without stale data winning;
- consent denial, revocation and purpose changes win over concurrent or delayed writes;
- knowledge questions preserve the exact pending requirement and resume it afterward;
- OCR/provider callbacks are tenant-scoped, action-scoped, replay-safe and version-aware;
- Redis, n8n, Azure, OCR and embedding outages leave durable observable states;
- no raw PII enters model context, retrieval telemetry, Redis events, n8n payloads or summaries;
- old sessions and catalogs remain readable;
- admin views do not expose another tenant's journey, document or CRM reference;
- journey state and prompts have bounded size and latency;
- farewell is not inferred from silence, provider completion or intent fulfillment;
- tests prove both the positive journey and safe abstention/deferral paths.

## Implementation phases

### Phase 0 — baseline and safety — complete

- [x] Create a feature branch from the current working tree without discarding the user's local Docker/ingestion changes.
- [x] Verify published catalog, active sources, local service health and the failing conversation.
- [x] Confirm no live tenant or preserved local data is reset by this work.

### Phase 1 — state continuity — complete

- [x] Make post-capture detection action-aware rather than dependent only on one workflow status.
- [x] Preserve the primary intent and purpose-bound consent after a lead is registered.
- [x] Record follow-up intents as candidates/secondary context and block duplicate lead actions.
- [x] Add regression tests for a second related intent and repeated contact requests.

### Phase 2 — natural contextual turns — complete

- [x] Detect short answers to the last journey question without treating them as factual questions.
- [x] Allow only a constrained, model-generated continuation with no unsupported business claim or citation; use a safe no-fact fallback if model output is invalid.
- [x] Keep farewell/closed-session behavior and explicit consent rules unchanged.
- [x] Add tests for `yes 2 weeks`, a short office preference, an actual requirements question and an unsupported claim.

### Phase 3 — intent-aware retrieval and model context — complete locally

- [x] Build a bounded retrieval query from current masked text and structured state, with separate focused full-text terms.
- [x] Supply masked slots, summary, active/follow-up intent and document status to the model.
- [x] Match natural catalog phrase variants, including one spelling error or omitted neutral stop word, without tenant-specific keywords.
- [x] Verify knowledge questions answer from approved evidence and resume the next journey step.

### Phase 4 — catalog/content verification

- [ ] Add and validate the typed catalog journey/requirement contract with backward-compatible defaults.
- [ ] Review the published tenant catalog's company-formation, visa, workspace and document policies.
- [ ] Publish reviewed business-activity and company-formation paraphrases (including `start a business`, FZC/partner wording and spelling variants) through the catalog editor/import path, not source-code keywords. A local validation-only catalog version added the fashion-boutique examples; it is not treated as a deployable catalog migration.
- [ ] Verify content catalog sources are active, public-for-chat and re-ingested with the configured production embedding deployment.
- [ ] Pin the catalog version for each active journey and preserve old sessions when a newer catalog is published.
- [ ] Add bounded per-intent progress, pause/resume, completion and cycle protection using the existing session CAS path.
- [ ] Link document requirements to pending prompts and mark them complete only after verified OCR completion.
- [ ] Scope consent by intent, catalog version and side-effect purpose.
- [ ] Verify existing lead-capture, summary-sync and OCR workflow bindings; do not create duplicate workflows.

### Phase 5 — acceptance and rollout

- [x] Run API/unit tests for intent continuity, PII masking, tenant isolation, consent, duplicate actions and grounded abstention: 21 files passed, 154 tests passed; 2 integration files with 8 environment-gated tests skipped.
- [x] Run a local browser conversation from greeting through typo-tolerant commercial intent and follow-up knowledge questions; requirements and visa-package answers returned approved-source citations while the pending journey remained active.
- [ ] Test one active intent to fulfillment, a paused related intent, explicit intent switching, resume, cycle protection and farewell.
- [ ] Test slot correction, document replacement, OCR failure/retry, consent denial/revocation and catalog republish during a session.
- [ ] Test concurrent messages and delayed callbacks against journey revision and pinned catalog version.
- [ ] Inspect the same session in Admin CRM, including the single lead, summary, workflow status and transcript.
- [ ] Record unavailable live provider checks separately; do not claim Salesforce/n8n success from mocks.

Latest local validation (2026-10-25): the rebuilt Docker stack passed `/api/v1/health/live` and `/api/v1/health/ready`. A fresh `anc-test` API session completed greeting, catalog-guided company setup, multi-field requirements, masked contact capture, explicit consent confirmation and a same-session follow-up. A supported document-requirements question returned active tenant citations; an unsupported visa-package question abstained without closing the session. No Salesforce or n8n provider completion was claimed.

## Target conversation contract

The visitor can ask a factual question or supply a requirement at any point. Node first updates validated masked state and resolves the current catalog context. It then either asks the next catalog question, retrieves approved evidence, or gives a constrained conversational acknowledgement. After lead registration, the same session remains active:

```text
greeting → business need → lead slots → explicit consent → async registration
        → packages / steps / timeline questions (grounded)
        → related intent or document requirement (catalog-guided)
        → one next question or one document action at a time
```

Only the initial CRM action can create the logical lead. Later intent detection enriches the same state and CRM record; it cannot silently create a second action or inherit consent for an unrelated purpose.

## Natural response policy

Normal visitor-facing replies and follow-up questions should be composed by the configured AI model from the latest masked message, structured state, masked summary, persona and authorized RAG evidence. The backend supplies the missing slot or approved next action as constraints; the model supplies the natural wording. It must acknowledge the visitor's latest contribution, preserve known context, ask at most one next question, and avoid exposing internal terms such as routing, catalog resolution, workflow, prompt or policy.

The backend remains authoritative. Model output cannot select a workflow, grant consent, invent a fact, create a citation, or claim an asynchronous action completed. Citation IDs, action state, consent state and tenant access are validated after generation. n8n completion events return to Node, which asks the model to compose the next user-facing update from the verified result.

Hardcoded visitor text is limited to safety and degraded-mode boundaries: unavailable model, blocked/unsupported content, explicit consent denial, session closure and security errors. These messages are not the normal conversation path and must not contain tenant-specific business claims. The assistant should feel warm and continuous without claiming to be a human.

## Reworked delivery logic

The implementation must keep four responsibilities separate. This prevents a fluent model response from silently changing business state:

1. **Context assembler** — loads the current masked message, pending prompt, structured state, masked rolling summary, recent turns and active catalog version.
2. **Decision engine** — resolves pending slots, proposes and scores intents, detects intent switches/resumption, validates slot corrections and determines whether RAG or an authorized action is permitted. This is backend policy, not free-form model authority.
3. **Evidence builder** — creates a bounded retrieval query from the current message plus relevant confirmed context, retrieves tenant-authorized chunks and validates the citation set.
4. **Response composer** — receives the validated decision, masked context, persona and evidence, then writes the natural answer and one next question. It cannot create an intent, citation, consent or side effect that the backend did not approve.

The turn contract is:

```text
load state → mask message → resolve pending prompt → classify/score intent
→ merge validated slots → retrieve authorized evidence when needed
→ validate action gates → compose natural response
→ persist message/state/summary/outbox atomically
```

The current message is always authoritative for a correction or new fact. The structured state is authoritative for validated slots, consent and lifecycle. The summary is compressed context only. Recent turns provide conversational phrasing only. No layer may promote a summary statement into a business fact without current authorized evidence.

The response composer receives a typed response envelope rather than internal instructions:

```json
{
  "mode": "knowledge | slot_collection | consent | queued | follow_up | farewell | abstain",
  "activeIntent": "catalog intent or null",
  "nextSlot": "catalog slot or null",
  "knownContext": "masked structured context",
  "evidence": "authorized citation chunks",
  "verifiedActionState": "none | awaiting_confirmation | queued | processing | completed | failed"
}
```

The model returns only wording and exact citation IDs. Node validates the output, strips invalid citations, rejects unsupported claims and persists the response. If the model fails, the system uses a minimal safe boundary response; it never fabricates a human-like answer or reports an unverified workflow result.

Conversation completion is separate from workflow completion. A CRM/OCR action reaching `completed` does not close the chat. The conversation remains in a post-action follow-up phase until the visitor says farewell, explicitly ends the interaction, or the session expires. A knowledge question temporarily interrupts slot collection and resumes the same next slot afterward.

Summary generation is not allowed to block every response. The previous summary plus the current turn is enough for the immediate response; a deterministic state-derived summary is persisted in the same transaction, and optional AI compaction runs asynchronously with revision checks. A stale or failed compaction can never overwrite a newer state revision.

## Fool-proofing and acceptance rules

No software plan is literally fool-proof, so the design relies on explicit rejection paths rather than optimistic AI behavior. The following must be true before implementation is considered complete:

- No normal visitor reply is selected from a hardcoded business script.
- No factual claim is sent without an authorized citation, unless it is directly supplied by the visitor and only acknowledged as such.
- No known slot is requested again unless it was corrected, invalidated or required for a new purpose.
- No intent from the summary alone can trigger a workflow.
- No consent is inherited across unrelated intents or sessions.
- No n8n/Salesforce/OCR success is shown before a verified completion callback.
- Every state and outbox write uses tenant scope, action/session identity and optimistic revision checks.
- Every AI-generated answer is checked for citation validity, unsupported numbers, PII leakage and prompt-injection instructions.
- Every failed AI, RAG, Redis or workflow dependency has a safe, observable fallback state.
- Farewell is the only normal conversational transition that closes the visitor session.

The acceptance suite must include natural paraphrases, misspellings, multi-intent turns, knowledge questions during lead collection, corrections, consent changes, delayed callbacks, provider failures, prompt injection, concurrent messages, cross-tenant identifiers and post-registration follow-up until farewell.

## Acceptance gates

- No factual response without an authorized, active tenant source and valid citation.
- No raw PII in model follow-up context, retrieval telemetry, Redis events or n8n payloads.
- No duplicate lead action for related post-capture turns.
- A contextual answer does not become a false business claim merely because it has no citation.
- Normal replies and follow-up wording are AI-composed from masked, authorized context; deterministic backend gates still control every side effect.
- A new tenant can use the same code path with a different catalog, persona, sources and workflow bindings.
- Existing lead, document, callback, action idempotency and tenant-isolation tests remain green.

## Known external dependency

The local API has Azure chat credentials but no configured Azure embedding deployment in the current container. It therefore uses the deterministic local embedding fallback for the current local corpus. A production-quality semantic re-ingestion/retrieval check requires the tenant's approved embedding deployment and a deliberate re-index; this plan does not invent or commit that secret.

Catalog query normalization is now enabled locally and its Azure request timeout was increased from 800 ms to 3 seconds after a live timeout reproduced the fallback. The remaining company-formation miss is catalog data coverage: the published version does not contain the normalized `start a business` signal.

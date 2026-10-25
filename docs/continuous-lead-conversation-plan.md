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

- [ ] Review the published tenant catalog's company-formation, visa, workspace and document policies.
- [ ] Publish reviewed business-activity and company-formation paraphrases (including `start a business`, FZC/partner wording and spelling variants) through the catalog editor/import path, not source-code keywords. A local validation-only catalog version added the fashion-boutique examples; it is not treated as a deployable catalog migration.
- [ ] Verify content catalog sources are active, public-for-chat and re-ingested with the configured production embedding deployment.
- [ ] Verify existing lead-capture, summary-sync and OCR workflow bindings; do not create duplicate workflows.

### Phase 5 — acceptance and rollout

- [x] Run API/unit tests for intent continuity, PII masking, tenant isolation, consent, duplicate actions and grounded abstention: 21 files passed, 154 tests passed; 2 integration files with 8 environment-gated tests skipped.
- [x] Run a local browser conversation from greeting through typo-tolerant commercial intent and follow-up knowledge questions; requirements and visa-package answers returned approved-source citations while the pending journey remained active.
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

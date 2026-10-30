# Durable User Intent Document — one active opportunity per customer journey

**Status: TARGET.** The repository currently has `conversation_state.intentProgress`, `journey_instances`, `journey_facts` and messages. Add a purpose-built **versioned User Intent Document** rather than duplicating or replacing these business records blindly.

## Purpose

For each authenticated `(tenantId, sessionId, opportunityId)` maintain one authoritative **current projection** and a durable append-only history of **every evaluated user turn**. The projection stores a **durable primary business goal** independently from transient knowledge, clarification, requirement, status, navigation or execution turn intents. The goal is the customer's desired outcome, **not** a CRM Lead record. Store a durable record before returning a customer response; if processing fails, record an error/retry decision without applying half-validated facts. Do not use Redis, a Python process, an LLM response ID or Foundry conversation as the truth.

### Suggested logical projection

```json
{
  "schemaVersion": 1,
  "tenantId": "server-derived",
  "sessionId": "authorized-session",
  "opportunityId": "active-opportunity",
  "catalogVersionId": "published-version-pinned-at-journey-start",
  "personaVersionId": "session-pinned-published-version",
  "personaFallbackTemplateVersion": "approved-template-version",
  "revision": 12,
  "state": "awaiting_requirement",
  "primaryBusinessGoalKey": "catalog-goal-key-or-null",
  "primaryBusinessGoalStatus": "candidate-or-confirmed-or-fulfilled-or-blocked",
  "currentTurnIntentCategory": "knowledge_advisory",
  "currentTurnIntentKey": "catalog-turn-intent-key-or-null",
  "intentConfirmedBy": "customer-turn-id-or-null",
  "intentConfirmedAt": null,
  "candidateIntentKeys": [],
  "llmSuggestedSignalWeights": {},
  "acceptedScoringPolicyVersion": "published-version",
  "goalConfidenceBand": "medium",
  "requirementCoverage": {},
  "actionEligibility": {"ready": false, "reason": "requirements_pending"},
  "facts": {},
  "pendingRequirementKey": "catalog-defined-key-or-null",
  "lastQuestionKey": "catalog-defined-key-or-null",
  "lastGroundedAnswerRefs": [],
  "currentStageKey": "catalog-stage-key-or-null",
  "completedStageKeys": [],
  "consentRefs": [],
  "actionRefs": [],
  "providerCorrelationRefs": [],
  "conversationSummary": {
    "customerGoal": "bounded verified objective",
    "knownFacts": {},
    "answeredQuestions": [],
    "openQuestions": [],
    "recentCorrections": [],
    "customerPreferences": [],
    "lastModelPlanReason": "bounded"
  },
  "plannerNextMove": "collect_requirement",
  "goalCompletionEvidenceRefs": [],
  "lastEvaluatedTurnId": "turn-id",
  "lastNormalizedQueryDigest": "sha256",
  "updatedAt": "timestamp"
}
```

Do not store raw PII unnecessarily in this projection. Facts use schema-validated values/provenance and secure references; sensitive values remain protected in the existing Node/DB boundary.

### Every-turn assessment (append-only)

Include `(tenant, session, opportunity, messageId, clientMessageId, catalogVersionId, documentRevisionBefore, documentRevisionAfter, messageHash)`; original and normalized query hashes; sanitized retrieval tokens; **turn category, primary goal and secondary sub-intents**, candidate keys/signal IDs, **LLM suggested weights, Node accepted weights, score/confidence/ambiguity and rationale**, model/task/schema/response provenance, **personaVersionId, response language, fallback template version and final Response Guard verdict**; **conversation summary revisions and planner chosen next move**, selected decision and goal confirmation; slots proposed/validated/rejected, corrections; knowledge interruption flag; pending/current question; response/citation IDs; tool/action proposal ID; model/cache hit or fallback; error code; timestamps. Record provenance for **every substantive intent-identification turn**, including no match/low-confidence, without blindly appending an unbounded plaintext transcript.

### Storage/transaction design

- Proposed additive Postgres entities: `user_intent_documents` (unique active scope + CAS revision) and `intent_turn_assessments` (immutable, unique `(tenant,session,clientMessageId,assessmentVersion)` with FK to document and message).
- Use existing opportunity identity and published catalog IDs; do not invent duplicate conflicting `opportunityId` meanings. On new opportunity, create a **new document** rather than reusing prior consent, action or documents.
- CAS/transaction: session and intent document revision are checked atomically with fact writes/pending requirement and response persistence. Define fixed lock order (session first) matching existing action/legacy locks; conflict returns retryable `409` or controlled replay without side effects.
- Outbox and action confirmation must read the same pinned document revision and verify no stale facts/consents.
- Backfill safely from existing journey records only where identity and catalog version are unambiguous. Mark uncertain legacy state for review; do not fabricate confirmations.
- Keep bounded snapshots and secure retention of append-only assessments; deletion/retention must cascade by authorized tenant/session policy.

## Versioned persona and final response continuity

The authorized session binds the tenant's **published personaVersionId**, assistant identity, permitted language/style and **approved fallback template version**. Persist these references with the intent projection and every assistant response/turn assessment, including fallback replies. Never write unbounded persona prompts, full model private reasoning, raw tool results or customer OTPs into a summary.

A mid-session persona change is not silently applied; either continue the pinned version or perform an explicit audited migration. Duplicate message replay must return the originally validated customer reply with the same persona version **without another GPT call**. On API restart, Redis eviction or model outage, a fallback must remain within the pinned persona and accurately report known state. Unknown/wrong-tenant persona must fail closed; never default another tenant to Zara.

The Python agent receives this pinned context **before** tool calls and final composition. Node audits the final composed answer's persona/grounding verdict separately from internal model decision metadata.

## Conversation Engine v2 persistence contract

The session/conversation manager is **logical component 5** of the target architecture, owned by Node + PostgreSQL. Include authenticated tenant/session identity, optional discovery (pre-opportunity) state, pinned published persona and catalog versions, exact clientMessageId/messageHash, scope/consent, current stage, last valid question, bounded verified summary and pending provider actions. Store a **per-turn append-only assessment** and accepted customer-facing reply with schema and guard verdict. Duplicate delivery replays the same reply with **zero model or n8n effects**.

Commit accepted model proposals under CAS with session-first locking. Stale planning, concurrent correction and delayed callback cannot silently replace the current opportunity or stage. Redis caches normalization/interpretation and carries events but must not be the durable primary goal record. Stage-specific requirements and facts retain evidence provenance, and action confirmation is never inferred from a model summary. Full typed transition design: [conversation-engine-contracts.md](conversation-engine-contracts.md).

## Cache design

**Every evaluated turn must be recorded, even on a cache hit.**

- Durable response idempotency is keyed by tenant/session/clientMessageId + original message hash; same key + different message is a conflict.
- Normalization cache: `(tenant, session, opportunity, catalogVersionId, taskVersion, textHash, confirmedFactsDigest, pendingRequirementKey, contextRevision)`.
- Interpretation cache: add `candidateSignalsDigest`, scoring policy version and model/prompt/schema version.
- Generated answer cache: only safe exact replay of the **same turn+state**, not semantic reuse for another customer's question.
- Redis TTL may accelerate; authoritative assessment/projection persists to PostgreSQL. Treat absence/eviction as cache miss, not a reset. Optional in-process singleflight prevents duplicate concurrent model calls.
- Invalidate on new customer turn changing context, fact correction, intent confirmation/switch, catalog version (for new journey), persona change where applicable, provider callback/stage revision, source publication/revocation and consent change.
- Never share cached customer-specific results across tenants, sessions or opportunities.

## Continuity policy

A knowledge question temporarily suspends the requirement but never changes `primaryBusinessGoalKey`, `opportunityId` or pending question. A contact/CRM action is not the primary intent. The LLM can suggest updating weights or next steps each turn, but confirmed goal and validated facts are not silently replaced by its summary. A fact correction records a new provenance entry, revisits relevant gates, cancels stale proposals and increments revision. Explicit new intent is confirmed and creates/transitions an opportunity under catalog rules; historical journey remains auditable.

## Recovery and verification

Replay assessments to reconstruct the current projection and compare persisted revision; test restarts, duplicate delivery, race, stale model callback, delayed n8n callback, tenant spoofing, catalog republish, data deletion and interrupted transaction. Verify deterministic identical outcome on replay without an additional GPT call or duplicate n8n write.

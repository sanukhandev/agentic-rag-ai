# Conversation Engine v2 — interface contracts and invariants

**Status: P0 CONTRACT FROZEN by issue #85 on 2026-10-30.** The private v2 boundary schemas are implemented in `services/api/src/python-model/v2-contracts.ts` and `services/model-gateway/gateway/v2_contracts.py`, with strict negative tests. These contracts do not replace the public Node chat API, do not grant Python write access and do not claim the full runtime/tool loop is implemented; those are later issues.

## A. Envelope, revision and identity

Node always owns tenant/session resolution, ACL, published versions and idempotency. Use private `POST /internal/v2/conversation/turn` from Node to Python. Preserve the public Node chat endpoints until they pass compatibility checks.

| Field | Type | Source and validation |
| --- | --- | --- |
| `schemaVersion` | `2` | Strictly validated, reject unknown incompatible versions |
| `requestId`, `clientMessageId` | strings | Server-generated correlation and client idempotency, bounded |
| `scopeRef` | opaque signed short-lived context reference | Issued by Node; never accept customer-specified tenant IDs in Python tool calls |
| `sessionRevision`, `intentRevision` | nonnegative integers | Node read with CAS; stale model results must not commit |
| `catalogVersionId`, `personaVersionId` | IDs | Published and pinned by Node; cannot be overwritten by GPT output |
| `customerMessageMasked`, `latestTurns` | bounded content | PII-masked, sanitized; existing privacy rules preserved |
| `persona`, `catalogDigest`, `intentProjection` | structured | From Node only; compact, published, source-versioned |
| `toolAllowlist`, `deadlineAt`, `budgets` | structured | Node-defined capabilities and bounded execution budget |

**Precondition:** request authentication, session ownership, source ACL, persona published, catalog pinned; same idempotency key with different body hash is a 409 conflict.

## B. Python model planner output

```json
{
  "schemaVersion": 2,
  "turnCategory": "knowledge_advisory",
  "goalProposal": {
    "businessGoalKey": "published.goal.company_formation",
    "statusProposal": "retain_confirmed",
    "confidenceBand": "high",
    "candidateEvidence": [
      {
        "catalogSignalId": "approved-signal",
        "sourceTurnId": "turn-ref",
        "suggestedWeightMultiplier": 1.0
      }
    ]
  },
  "factProposals": [
    {
      "requirementKey": "visa_count",
      "value": 3,
      "evidenceTurnRef": "current-turn",
      "provenance": "explicit_customer_statement"
    }
  ],
  "knowledgePlan": {
    "needsRetrieval": true,
    "topics": ["approved-topic-key"],
    "query": "options for software company with three visas"
  },
  "nextMove": {
    "kind": "answer_knowledge",
    "requirementKey": "business_activity",
    "toolKey": null
  },
  "responsePlan": {
    "oneQuestionKey": "business_activity",
    "reasonNoQuestion": null
  },
  "summaryPatch": {
    "statedGoal": "New company formation",
    "knownRequirementKeys": ["visa_count"],
    "unresolvedRequirementKeys": ["business_activity"]
  }
}
```

Each `goalProposal` key/weight/turn reference, required key and tool key is **untrusted** and must be validated by Node against a pinned published catalog and verified turn data. A model "high" confidence band is not a calibrated probability. A saved model summary is not confirmation or proof of CRM state.

## C. Node tool protocol

- Node advertises capabilities derived from published catalog and current stage: `get_conversation_context`, `get_persona`, `get_intent_catalog`, `get_journey_state`, `get_missing_requirements`, `search_knowledge`, `get_available_packages`, `get_document_requirements`, `get_action_status`.
- Python model may request tool calls. Each request must contain `toolCallId`, one listed `toolName`, typed `arguments`, `scopeRef`, expected `stateRevision` and deadline; Node validates names/arguments and authenticates service-level access independently.
- Results return the exact `toolCallId`, `status` (`ok` / `temporarily_unavailable` / `not_authorized` / `invalid_args` / `stale_state`), bounded `result`, trusted `evidenceRefs`, `sourceVersion` and `stateRevision`.
- Python feeds model function-call results correlated with the correct call ID. It cannot invent Node tool results, select arbitrary webhook URLs, use unrestricted Python execution or directly access CRM/DB.
- Reads may batch/concurrently execute only where no consistency dependency exists. Stop on stale revision, policy conflict, deadline or budgets. Model-generated requests are not authorization.
- Business write is **not** a read tool: `propose_catalog_action` may request a pending server-side proposal; customer confirms the exact action later. `ActionRequest` + outbox is committed atomically by Node after all gates.

## D. Final persona-composed response and guard

```json
{
  "schemaVersion": 2,
  "personaVersionId": "session-pinned-version",
  "language": "en",
  "answer": "I can help you compare the verified options for the three visas you mentioned.",
  "citationIds": ["approved-rag-evidence-ref"],
  "nextQuestion": "What business activity are you planning?",
  "nextQuestionKey": "business_activity",
  "reasonNoQuestion": null,
  "decisionRef": "internal-plan-ref"
}
```

**Customer receives only** the validated `answer` combined with the approved `nextQuestion` (in a single cohesive persona reply) and the existing public response fields. The internal structured object is not exposed.

Node must check: tenant/persona pins, supported language, source ACL and current source revocation, evidence-reference validity, factual/status constraints, explicit action-confirmation wording, question count and requirement appropriateness, forbidden internal identifiers and API contract. The question is **at most one**; for a normal active journey with an eligible pending requirement it should be exactly one. Farewell, opt-out, incident, closed session, human handoff and legitimate action-pending states can use no question.

**Limit:** citation existence by itself does not prove source entailment. Use claim-aware structured evidence where possible; block unsupported consequential claims and make uncertainty explicit. Any guard failure returns a typed failure, not untrusted raw text.

## E. Session & User Intent Document

Use PostgreSQL authoritative projection + append-only per-turn assessment; Redis is cache and event transport only. Suggested projection identity: `(tenantId, sessionId, opportunityId)` plus `schemaVersion`, `revision`, pinned `catalogVersionId` and `personaVersionId`, current `businessGoalKey` and confirmation, `turnCategory`, verified facts with source refs, `currentStageKey`, `pendingRequirementKey`, last asked question and answer refs, `actionRefs`, provider status and `fallbackTemplateVersion`.

| Operation | Consistency requirement |
| --- | --- |
| New message | Deduplicate `(tenant,session,clientMessageId)` with hash; conflicting hash rejected |
| Accepted model decision | CAS on session/intent revision; persist accepted plan, answer and state atomically |
| Stale model response | Discard/replan boundedly; never apply stale fact corrections or stage changes |
| Fact correction | Verified provenance update; invalidate stage-relevant cached decisions/proposals |
| Provider callback | Authenticated, idempotent exact opportunity/action/stage/correlation match |
| Redis outage | DB remains authoritative; degrade/fail safely without lost confirmations |
| Catalog/persona republish | Existing session remains on approved pinned version until controlled migration |
| Deletion/retention | Follow tenant policy, existing PII-vault and audit constraints |

## F. Stage and workflow gating

The stage state machine is a **catalog-defined ordered dependency graph**. For ANCFZ the seven nodes remain ordered; knowledge interruptions never advance a stage. Every transition needs requirements completed and evidence verified at the *current stage*, never requirements from later stages.

Example server-only action lifecycle: `not_eligible → eligible → awaiting_action_confirmation → approved → queued → processing → completed_verified` or `failed / reconciliation / human_review`. These are logical states; map them to existing persisted `ActionState` values rather than introduce incompatible enums without a migration.

**Evidence tiers:** user assertion, Node validated fact, provider transport acknowledgment, n8n execution result, authenticated provider record verification. Only the designated tier in a published stage policy may count as success. `HTTP 200`, payment PDF generation and `mock_paid` must not be silently interpreted as production completion.

**Locked P0 catalog decision:** the new executable engine's importer/API/Admin/runtime is **v2-only** and rejects legacy v1/unversioned workbooks. Older v1 published catalog history is isolated for safe read/rollback and an explicit candidate conversion, not an alternate v2 import contract. See [catalog-v2-contract.md](catalog-v2-contract.md) and issue #84. **Legal company registration** is independently tracked after the Stage-7 contract journey, and **mock provider evidence** is separately labeled from real sandbox verification.

## G. Catalog v2 import/publish contract

Existing parser `tools/ingestion/ingestion/intent_catalog.py` version 1.4.0 imports legacy v1 sheets only. **It must not be reused as the v2 importer.** The new v2-only contract requires a strict version-2 manifest, dedicated parser, shared schema/validator, Admin preview/import/export/publish, immutable version pinning and runtime migration. V1 workbooks are rejected by v2 and old records remain isolated/readable until audited migration/rollback.

**Proposed source tables** (exact schema to be frozen in P0): `BusinessGoals`, `IntentCategories`, `TurnIntents`, `Signals`, `ScoringPolicies`, `RequirementPolicies`, `BusinessStages`, `ToolBindings`, `FollowUpPolicies`, `KnowledgeTopics`, `PersonaPolicies`, `WorkflowBindings`, `DocumentPolicies` plus migration-compatible existing sheets. Include stable keys, stage scope and requirement dependencies, supported languages, source-of-truth rules, confirmation/consent, allowed argument schemas, verification evidence and safe fallbacks.

Prevent: orphan keys, duplicate stage order, impossible dependencies, knowledge-only intents requiring CRM, unpublished tools, implicit cross-stage requirements, out-of-range weight proposals, unverified workflow IDs and tenant mismatches. Inactive bindings remain inactive by default after import.

## H. Errors, latency and replay

- Python task errors: `MODEL_UNAVAILABLE`, `INVALID_MODEL_OUTPUT`, `TOOL_UNAVAILABLE`, `TOOL_FORBIDDEN`, `STALE_CONTEXT`, `TURN_BUDGET_EXCEEDED`; Node maps these to safe persona templates or a pre-session generic transport error.
- One initial model request plus **up to three SDK retries on transient failures per call**, no nested Node retries. Define a shared turn budget across plan/tool/compose; retryable CRM writes follow independent, idempotency-aware policies, never simple blind repetitions.
- Multiple model calls may be needed to plan, use tools and compose. Set configurable safe defaults during P0 load tests; do not promise a single model call or a fixed SLA before measuring.
- Duplicate request replays committed accepted response with **zero new GPT calls and zero new n8n writes**.
- Record redacted model version, catalog/persona versions, tool call count, rate/latency/budget, guard verdict, provider references and failure reason. Never store raw chain-of-thought/OTP/private documents.

## I. Versioned contract tests and acceptance

Define fixture families for schema rejection, cross-tenant scope, prompt-injection through RAG/tool output, persona pin, PII masking, source revocation, numeric facts, context correction, stale CAS, duplicate replay, model timeout/429, tool exhaustion, action confirmation and provider callback replay. See [evaluation matrix](conversation-engine-evaluation.md).

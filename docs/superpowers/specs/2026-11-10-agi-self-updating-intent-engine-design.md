# AGI Self-Updating Intent and Natural Conversation Engine Design

**Date:** 2026-11-10  
**Branch:** `feat/agi-self-updating-data-set`  
**Status:** Design proposal pending review  
**Base:** Latest verified `origin/main` commit recorded by Task 1 before implementation

## Intent

Replace the current mixed conversation runtime with one neutral, GPT-first conversation engine. The engine must understand the full relevant conversation, choose authorized read tools when useful, answer in the pinned tenant persona, collect catalog requirements naturally, and propose authorized CRM/quote/PDF actions when the conversation is ready.

The only self-updating data is the tenant-scoped intent vocabulary. Approved RAG sources, document policies, prices, packages, workflow bindings, legal rules, and seven-stage completion evidence remain protected authoritative data.

## Goals

- One active conversation controller and one final persona composition path.
- Redis-backed active context and summary cache with PostgreSQL reconstruction on cache miss.
- WebSocket delivery for active turns and workflow events, with resumable Redis Stream delivery.
- Every customer message reaches the model controller when the model runtime is enabled; no keyword gate decides whether the model is consulted.
- GPT can request conversation context/history summaries, catalog, knowledge, requirements, packages, documents, journey state, action status, or persona context through typed read-only tools.
- A clear canonical intent catalog describes the company-formation goal, seven stages, requirements, documents, packages, actions, and completion conditions without tenant-specific code branches.
- Semantic intent recognition works for unseen expressions, ambiguity, corrections, interruptions, short acknowledgements, and goal changes.
- Vocabulary candidates follow `Observe → Propose → Validate → Evaluate → Promote → Monitor → Rollback`.
- CRM Lead and quote/PDF actions remain Node-authorized, consent-bound, idempotent, and provider-verified.
- Existing public chat/Admin APIs, database records, security controls, and seven-stage provider boundaries remain compatible.
- Generated scratch artifacts and obsolete duplicate runtime documentation are removed only after reference and CI checks prove they are unnecessary.

## Non-goals and anti-goals

- No new V3/V4 runtime and no permanently parallel planner.
- No autonomous changes to RAG content, embeddings, document policy, packages, prices, workflow authorization, or legal policy.
- No direct model access to PostgreSQL, Salesforce, n8n, payment systems, identity-document bytes, or arbitrary URLs.
- No implicit CRM or quote execution from a model score or an apparently complete message.
- No hardcoded tenant slug, assistant name, stage list, phrase, package, or workflow in shared runtime code.
- No exact-answer or fixed-question tests as the primary quality measure.
- No production promotion, real charge, signature, or credential rotation.
- Redis is not the source of truth for verified facts, consent, actions, workflow stages, or provider evidence.
- No silent compatibility routing through the old v1/v2 conversation runtime after cutover.

## Selected approach: full neutral-module rewrite

The existing implementation has useful trust boundaries but spreads conversation ownership across versioned controllers, preflight classifiers, legacy planner helpers, and response guards. A compatibility patch would leave the same collision risk. This design therefore creates one neutral `conversation/` boundary in Node and one neutral model-gateway path, migrates all callers in one controlled cutover, and removes obsolete runtime code only after the replacement passes the full acceptance matrix.

The rewrite is additive at the file boundary during development but single-runtime at execution. Existing migrations, persisted records, public routes, Admin routes, and provider adapters are preserved. Legacy catalog data is converted once into the canonical catalog model; legacy planners are not called by the new chat route.

## Target runtime shape

```text
HTTP session bootstrap + WebSocket chat stream
        |
        v
conversation/controller.ts  -- one public turn owner
  |-- state.ts               -- session snapshot, facts, opportunity, CAS
  |-- context.ts             -- Redis active context/summary and reconstruction
  |-- intent.ts              -- model proposal validation and goal continuity
  |-- catalog.ts             -- canonical catalog snapshot and requirements
  |-- learning.ts            -- vocabulary candidates/evaluation/promotion
  |-- knowledge.ts           -- read-only evidence adapter
  |-- tools.ts               -- typed read-tool authorization/execution
  |-- actions.ts             -- validated CRM/quote/PDF proposals and gates
  |-- response-guard.ts      -- persona, evidence, status and privacy guard
        |
        v
Private model gateway
  agent.py / graph.py / tools.py / contracts.py / persona.py
  one bounded model -> read tools -> model -> final persona response loop
        |
        v
PostgreSQL source of truth -> outbox/Redis Streams/n8n -> verified providers
```

### Redis context and event delivery

Redis is the short-lived coordination layer, not business truth. Node stores the bounded active context, conversation summary, pinned catalog/persona/vocabulary revision identifiers, recent-turn window, last committed sequence, and frequently reused immutable instruction fragments in Redis. Keys are tenant/session/opportunity scoped, have configurable idle and absolute TTLs, and are rebuilt from PostgreSQL when absent or stale. Identity-document bytes, payment data, credentials, and unredacted sensitive payloads are never placed in Redis.

Initial development defaults are a 24-hour idle/7-day absolute context TTL, a 1-hour instruction-fragment TTL, and 24-hour or 100,000-event stream retention, whichever limit is reached first. These are configuration values, not conversation logic. Redis key names use opaque IDs only: `chat:ctx:{tenantId}:{sessionId}:{opportunityId}`, `chat:instr:{tenantId}:{personaRevision}:{catalogRevision}:{digest}`, `chat:turns`, and `chat:events:{sessionId}`. Redis ACLs restrict the conversation process to its own prefixes and stream groups.

The context record carries a revision and source digest. A turn may update Redis only after the corresponding durable turn ledger/state commit succeeds. If Redis is unavailable, the controller reconstructs from PostgreSQL and publishes a typed degraded-mode event; it must not invent context or lose verified state. Instruction fragments are keyed by tenant/persona/catalog revision and content digest, invalidated on publication, and never contain customer-specific facts.

The neutral chat transport uses HTTP only for authenticated session bootstrap/resume and a WebSocket at `/api/chat/stream` for customer turns and server events. Each client message has a `clientMessageId`, `sessionId`, and last received stream sequence. Server events are ordered and resumable: `turn.accepted`, `assistant.message` (a natural string), `tool.status`, `action.status`, `turn.completed`, and `turn.failed`. Redis Streams use consumer groups, acknowledgements after durable commit, pending-entry recovery, bounded delivery attempts, and a dead-letter stream. Reconnect replays events after the supplied sequence; it never re-executes an already committed action.

The HTTP bootstrap returns a short-lived WebSocket token bound to the authenticated tenant, user, session, and opportunity. The WebSocket validates token expiry, origin, session scope, heartbeat, and message size; the client cannot choose its tenant or opportunity. The connection sends heartbeats and resumes from the last acknowledged sequence after reconnect. The final assistant text is emitted as one `assistant.message` event after model/tool work, while progress and provider status are streamed separately; this avoids exposing partial or unguarded model output.

The turn worker consumes `chat:turns` with consumer group `chat-turn-workers`. It appends per-session events to `chat:events:{sessionId}` and acknowledges the turn only after the durable turn/state commit. Pending entries are reclaimed with the same idempotency key, and exhausted deliveries go to `chat:dead-letter`. Redis restart or eviction is recoverable: terminal turn state and final messages are reconstructed from PostgreSQL and missing stream events are rehydrated before replay.

Transient model, read-tool, Redis, and transport operations use one initial attempt plus at most three retries with exponential delays of 3 seconds, 6 seconds, and 12 seconds, subject to the shared turn deadline. Validation, authentication, authorization, prompt-policy failures, and non-idempotent side effects are not retried. Stream redelivery uses the same action/turn idempotency key and is separately capped so worker recovery cannot duplicate Salesforce, quote, payment, or contract work.

### Conversation turn contract

Node sends a bounded envelope containing the pinned tenant/persona/catalog/vocabulary revisions, the Redis context revision and digest, relevant recent turns, a summary reference, verified customer facts, active opportunity/stage, pending requirements, action readiness, and the available read-tool definitions. History is available through an authorized tool when the bounded envelope is insufficient; the model decides whether to call it. The final customer-facing result is a natural string; structured metadata remains internal and is emitted separately as trusted events.

The model returns a strict structured proposal containing:

- turn category and candidate registered business goals;
- goal status proposal, correction/ambiguity signal, and customer-stated fact proposals;
- optional vocabulary candidate proposals sourced only from the current customer turn;
- tool calls with typed arguments;
- one final persona response with evidence references and an optional purposeful follow-up;
- optional action proposals with catalog keys only.

Node independently validates all keys, facts, citations, requirements, persona fields, action prerequisites, consent, confirmation, idempotency, and current revisions. The model never mutates state directly.

### Tool loop

The model receives these tools when the pinned catalog and stage policy authorize them:

1. `get_conversation_context`
2. `get_conversation_history_summary`
3. `get_intent_catalog`
4. `search_knowledge`
5. `get_missing_requirements`
6. `get_available_packages`
7. `get_document_requirements`
8. `get_journey_state`
9. `get_action_status`
10. `get_persona`

Node signs the scope, validates tool name/arguments/revision/tenant, bounds calls and result sizes, and returns source/evidence references. No lexical preflight decides whether a tool must be called. Greeting/farewell/general conversation may complete without retrieval when the model determines no external information is needed.

### Workflow readiness

The model may propose CRM Lead and quote/PDF actions in the same turn only when the catalog says both are eligible. Node creates separate idempotent action records with separate purpose-specific consent and confirmation scopes, ordered by dependency (Lead before quote where required). A model response, HTTP 200, PDF existence, mock status, or n8n acknowledgment is not completion. Only verified provider evidence advances a stage.

## Canonical neutral catalog

The runtime consumes one normalized catalog snapshot with human-editable intent text:

- stable `intentKey`, name, description, keywords, customer expressions, exclusions;
- requirements with type, source of truth, validation, dependencies and order;
- document policy references, not copied document rules;
- ordered seven-stage journey definitions and completion evidence policy keys;
- package/product/tool references, not copied current prices or legal facts;
- workflow bindings, consent/confirmation policy, idempotency policy and fallback policy.

The canonical company-formation content is tenant data/fixture data, not shared source logic. Existing workbook import/export remains a compatibility adapter that produces this normalized model. No runtime module may import a tenant-specific fixture or branch on a tenant slug.

## Vocabulary learning model

Vocabulary records live in separate PostgreSQL tables from catalog and RAG data. A candidate stores tenant, registered intent, masked customer phrase, normalized phrase digest, source session/turn references, provenance, status, evaluation outcomes, revision and timestamps. Raw PII is rejected or masked before persistence.

Lifecycle:

1. Observe an eligible customer turn.
2. Ask GPT for a candidate only when the phrase is a meaningful expression of an existing registered goal.
3. Node validates exact current-turn provenance, negation/hypothetical/quote exclusion, PII safety, tenant scope, duplicate equivalence, and catalog membership.
4. Independently evaluate semantic fit and ambiguity using separate examples/conversations; never use the candidate answer as its own evidence.
5. Promote only after the configured independent-support threshold and quality gates, or explicit admin approval.
6. Publish a new immutable vocabulary revision for new sessions; existing sessions retain their pinned snapshot.
7. Monitor recognition outcomes and rollback by publishing a prior revision or disabling the phrase; audit every transition.

Automatic promotion is enabled for this development cutover, but remains conservative: it requires at least two independent eligible sessions, a passing independent evaluation, no ambiguity conflict, no PII/security violation, and no negative evidence. Admins receive a read-only audit view and can reject or roll back a phrase; they do not need to approve a qualifying candidate before promotion. Production can require approval through configuration later without changing the data model.

## Compatibility and cleanup

- The development cutover may remove old `/api/v1/chat/*` and versioned internal planner contracts after all callers are migrated. The supported surface becomes neutral HTTP session bootstrap/resume plus `/api/chat/stream`; Admin, callback, action, and provider contracts are migrated explicitly and tested before deletion.
- Database migration identifiers and historical verification evidence remain intact.
- Old v1/v2 controllers, planners, response contracts, lexical preflights, and duplicate guards are removed—not aliased—after `rg` reference checks, typecheck, tests, Docker build, WebSocket replay tests, and live Azure acceptance prove no consumer remains. Historical migrations and verification evidence are retained.
- Obsolete generated scratch files and superseded planning artifacts are removed only after CI/reference inventory approval; dated verification evidence required for audit is retained.
- `AGENTS.md`, `docs/current-state.md`, architecture/contracts/evaluation/acceptance docs are updated to describe the neutral runtime and exact remaining limitations.

## Safety and failure policy

- A model/tool failure returns an approved tenant-persona fallback and records a typed audit reason.
- Repeated failures with the same root cause are not patched in a loop. After three consecutive attempts with unchanged failure evidence, stop that workstream, record the diagnosis, and ask the user for the decision that changes scope or authority.
- Any failed security, RAG immutability, tenant isolation, action idempotency, callback authenticity, or provider-evidence gate blocks commit/PR readiness.
- Real Azure executions use configured environment secrets only; tests use synthetic customers and truthfully labeled sandbox/development evidence.

## Acceptance definition

The rewrite is merge-ready only when the full test matrix covers direct and indirect intent, unseen expressions, ambiguity, corrections, interruptions, knowledge-only turns, tools, failures, consent, CRM/quote readiness, seven-stage gates, cross-tenant isolation, prompt injection, vocabulary lifecycle, RAG immutability, replay, restart, and provider verification. Independent model evaluation must meet the repository target of at least 90% semantic success and intent correctness, with zero unauthorized actions and zero protected-RAG mutations.

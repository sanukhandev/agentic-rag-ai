# Conversation core — P2 durable state and session-security integration

**Status:** Candidate runtime, **not connected** to `/api/v1/chat/messages`.

## Included

- `turn-engine.ts`: a single conversational-response owner with validation and a request-content-bound idempotency key.
- `adapters/postgres-repository.ts`: tenant-scoped PostgreSQL adapter using the existing tables and transactional `state_version` CAS; atomically writes customer/assistant messages, versioned response, pinned catalog/persona and verified fact patches.
- `adapters/context-builder.ts`: deterministic projection of published persona and catalog, `user_intent_documents` facts, durable summaries, recent messages and conservative provider status.
- `adapters/session-authorizer.ts`: authenticated customer-session tokens via the existing Store's `verifySessionAccessToken`; fail-closed for arbitrary administrator roles in P2.
- `adapters/privacy-adapter.ts`: requires a **durable encrypted session-scoped vault implementation** for mask/assert operations; it deliberately has no permissive default.
- `adapters/proposal-validator.ts`: forbids model-created facts and all action proposals until P5 installs authoritative validators.
- `tests/`: native Vitest tests for context, authentication, masking and P2 refusal behavior.

## Persistence compatibility

Uses the existing migrations and the columns on `chat_sessions`, `chat_messages`, `persona_versions`, `intent_catalog_v2_versions`, `user_intent_documents`, `action_requests` and `tenants`. Adds only a namespaced `conversationCore` JSON object inside existing `chat_sessions.conversation_state` when a candidate turn is committed. No schema migration and no RAG or n8n changes.

The new adapter is restricted to **authenticated customer sessions**. The server must create `TrustedActor` from the authenticated bearer token; `principalId` must not come from a request body. The adapter rechecks the existing session-token record and the tenant/session/closed status on each operation. Platform administrator access will require a separately reviewed capability in P6.

`requestDigest` is SHA-256 of the original customer request and is checked on duplicate client message IDs before response reuse. The original masked message, typed result and a versioned response envelope persist atomically. A changed-content replay is rejected.

A `completed` value in the legacy action table **cannot** be represented as verified completion in P2. The status stays `reconciliation_required` until P5 can consult authoritative provider evidence.

## What P2 does NOT claim

- It does not hook into current production API, Python/LangGraph, Azure, n8n, or the real PII vault. P3-P6 provide those integrations.
- It does not autonomously generate a new semantic summary: `updateDurableSummary` persists a **validated, already-masked** update; model-driven summary generation is part of P4.
- It does not automatically persist model-proposed customer facts; P5 must verify source, consent and data type before enabling that capability.
- The local SQL test harness is deterministic and simulates transaction rollback. It does **not** substitute for a real PostgreSQL integration test against a disposable, migrated database.

**Do not delete the active `conversation/` V2 controller.** The candidate must pass real database/tenant security, provider and quality gates before P6/P7 cutover.

## P3 — Authorized read tools (isolated candidate)

- `adapters/rag-read-tool.ts` reuses the existing hybrid/semantic retrieval, strictly uses server-derived tenant + public audience and rechecks source status, tenant, source version and chunk ownership before exposing evidence. Returns bounded, redacted, **untrusted source data** with stable chunk citation IDs.
- `adapters/read-tool-scope.ts` implements `ReadToolCatalog` using HMAC-SHA256-signed, 120-second capabilities bound to tenant, session-token hash, pinned catalog, session revision and an explicit tool allowlist. Requires an independently configured secret of at least 32 bytes.
- Four reviewed read operations are registered: `search_knowledge` (only with an enabled published/pinned read-only catalog binding), `get_conversation_summary`, `get_verified_customer_facts`, `list_supported_goals`. No arbitrary SQL, URLs or external writes.
- Tools and the signed-scope executor independently reauthenticate the session. Unknown tools, changed session revision, stale/invalid tokens, cross-tenant results and disabled catalog bindings fail closed.

**Still isolated:** P3 does not publish a new external or internal HTTP endpoint, connect the new Python gateway, or replace the production chat controller. P4 must add a private authenticated gateway integration and claim-level entailment/evidence verification. A tool's successful retrieval does not prove a consequential claim or completed CRM action. P2's real encrypted privacy-vault connection remains a production cutover prerequisite. No migrations or source/embedding mutations are part of P3.

## P4 — Candidate GPT/LangGraph integration (not active in public chat)

- `adapters/p4-model-gateway.ts` sends only P2-masked model context to the private Python `/internal/p4/conversation/turn` endpoint with a bounded cancellation/deadline and validates returned call counts.
- `gateway/p4_contracts.py` and `gateway/p4_graph.py` define a distinct GPT-first LangGraph loop using catalog-permitted model-selected read tools. The model never receives session scopes, signing keys, evidence receipts or action-write tools.
- `adapters/p4-read-route.ts` exposes an internal-only server callback at `/internal/p4/tools/execute`, guarded by the independently configured service key and P3 HMAC session scope, only when `P4_INTERNAL_READS_ENABLED=true`.
- `adapters/evidence-receipt.ts` signs each actual retrieved excerpt with source/version/chunk, scope digest, tenant and expiration; Python may return receipts but cannot mint or edit them.
- `adapters/p4-evidence-verifier.ts` checks receipts, revalidates current active/public source/chunk and independently asks the existing grounding model whether declared consequential claims are entailed. Unsupported claims fail closed; **word overlap is not a rejection gate**.
- `adapters/p4-candidate-factory.ts` constructs the isolated turn engine. P2's privacy boundary is mandatory; the production encrypted scoped vault is not yet connected, so there is **no P4 public chat route**.
- The normal V2 API and n8n workflows remain unchanged; no RAG or SQL migrations were introduced. Both new feature flags default to false.

### Remaining gates

- Run API TypeScript/lint/Vitest and Python tests in the developer checkout; Docker/CI and real Azure UAT are not yet verified.
- Confirm an independent claim-coverage audit on held-out natural-language cases. Model-declared claims alone do not establish that every factual assertion was exhaustively extracted.
- Integrate durable encrypted PII vault before any end-to-end customer turn/persistence enablement (P6), plus latency and quality baselines.

## P5 — Tenant-defined goals, verified fact collection and action-proposal gating (isolated candidate)

- `p5-catalog.ts`: re-reads the **tenant-pinned published** Catalog V2, validates the catalog checksum/reference and active-goal set, then projects bounded plain-text goal names, descriptions, keywords, examples, requirements, documents, steps and enabled action keys for GPT. No model-provided catalog identity or tenant scope.
- `p5-proposal-validator.ts`: accepts verified customer fact patches only for a **single unambiguous active goal** when the value appears verbatim in the current *masked* customer utterance, the supporting turn ID matches and the key is an authorized customer-source fact requirement. Does not infer facts from model or knowledge text.
- `P5ActionStateReader` must be supplied by the future P6 server-side adapter. It must return tenant/session/catalog-bound persisted lifecycle state, verified requirements, exact customer authorization and purpose-scoped consent. Without it, model action suggestions **cannot** become persisted action proposals.
- `p5-candidate-factory.ts`: composes P5-only catalog enrichment and proposal checking around the existing P4 verifier/LLM. `createP4CandidateEngine` still uses `ReadOnlyP2ProposalValidator`.
- Python P5 mode is available only when `P4_GATEWAY_ENABLED=true` and `P5_CANDIDATE_ENABLED=true` on the **private** gateway; a P5 catalog field selects a strict candidate schema, while default P4 mode continues to require empty fact/action proposals.
- Even accepted P5 action proposals are only persisted as `pendingActionProposal` in a conversation response. They do not dispatch to n8n, Salesforce, CRM, payments or the outbox. A separate Node action gate is required to execute authorized actions.

**Not complete:** P5 is not connected to public chat, no trusted `P5ActionStateReader` implementation has been wired, catalog admin JSON/YAML authoring additions are not part of this change, and production vault + Azure quality/tenant UAT remain release blockers. No knowledge source, embedding, ingestion record, catalog version or database schema was mutated.

### P5 provisional goal continuity

The P2 namespaced `conversationCore` JSON now retains bounded `provisionalGoalKeys` as *unconfirmed model hypotheses* after an authorized turn commit. The next P5 model context can use them alongside the durable summary and recent turns; they are never permission, customer authorization or goal confirmation. Invalid/unpublished keys are filtered at projection time. Published goal descriptions/examples and requirements are redacted before model access. The persisted customer facts remain subject to the existing encrypted privacy boundary.

## P6 — Private canary API, durable privacy and action-state reader

- `p6-session-vault.ts` integrates the existing encrypted AES-GCM `TokenVault` with the already deployed `session_tokens` ciphertext table, always under a locked authorized `chat_sessions` row. Token assignment is durable across worker restarts and does **not** increment the P2 conversation revision. Raw customer values never enter `chat_messages` or model input.
- `p6-trusted-action-state.ts` reuses authenticated V2 goal/journey/catalog-stage authority, persisted purpose-scoped consent and independently approved actions; it never converts a proposed goal, consent prompt or model suggestion to customer authorization. Existing approved action is required for any further action proposal; this deliberately keeps new external writes disabled.
- `p6-candidate-route.ts` adds `POST /api/v1/chat/candidate/turn` only under `P6_CANDIDATE_ENABLED=true` and `P6_CANARY_TENANT_IDS`, with origin, tenant, token, expiry and legacy-session isolation. It returns a compatible `answer`, `citations`, `grounded` response, without exposing unapproved action proposals.
- `services/api/src/index.ts` wires the candidate behind **all** prerequisites: private P3 tool gateway, P4/P5 opt-in flags, mandatory independent P6 claim verification and a durable PII vault key. All flags default to false. The existing V2 `/api/v1/chat/messages` route and WebSocket handler remain unchanged.
- Private P4 tool callbacks remain independently authenticated. P6 model responses still pass verified evidence, privacy and action gates before the P2 repository commits them.

Remaining before release: code and integration CI, expired-token/revocation tests, real Azure UAT and grounded false-rejection audit, external stage/consent workflow confirmation, and controlled API/UI canary end-to-end benchmarks. No migration, RAG data mutation, external CRM write or main-branch merge was made by P6.

### P6 indexed citation lookup

The preview route resolves candidate citation IDs with a single indexable PostgreSQL join across current active/public source versions and tenant-owned chunks. It rejects missing/revoked citations instead of returning an answer with stale or invented source metadata. No whole-tenant source loading is used.

### Session-engine isolation and action authority

P6 candidate sessions must be fresh. The canary endpoint rejects any session already containing a V2-format customer turn; the standard V2 endpoint rejects a recent P6-format customer turn when the candidate feature is enabled. This avoids two independent persistence controllers advancing one conversation. Canary browser storage is namespaced separately.

The new conversation-core `verifiedFactPatches` and `goalCandidateKeys` do **not** create an authoritative V2 `user_intent_documents` goal confirmation or lifecycle record. Therefore the P6 action-state reader normally returns no authority for fresh candidate sessions. The user-facing preview supports safe informational dialogue and fact collection, **not** seven-stage dispatch, CRM writes, payment initiation or contract execution. Those require an explicit audited lifecycle integration, purpose-specific consent UI and authoritative action gate before cutover.

### Independent P6 grounding

P6 always constructs its own `HttpV2GroundingVerifier` for claim-level entailment; enabling P6 does NOT switch `V2_GROUNDING_ENTAILMENT_MODE` for the established production V2 coordinator. Failed/absent grounding service fails the P6 turn closed. This isolates the canary rollout from the V2 quality path.

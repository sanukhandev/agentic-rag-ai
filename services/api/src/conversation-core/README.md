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

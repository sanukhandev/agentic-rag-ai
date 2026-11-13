# AGENTS.md — Agentic RAG AI engineering authority

**Status:** target agent-centric architecture, not current implementation. Read `readme.md` and `docs/README.md` first. This document and numbered docs define the intended design; actual code and exact-head tests describe what is running.

## Product model
The **Agent** is the single application ownership/security partition. Do not implement a Tenant entity in the new domain. Every Agent independently owns a versioned Foundry agent reference, persona, approved Foundry IQ knowledge, intent catalog, requirements, offerings/prices, tool allowlist, workflow bindings, customer accounts and support tickets. ANCFZ is sample agent configuration, never platform logic. Shared infrastructure still requires strict `agent_id` isolation.

## Runtime responsibilities
- **Microsoft Foundry Agent Service:** natural dialogue, intent reasoning, function selection and user-facing responses; proposes facts and operations but has no direct business write privilege.
- **Python FastAPI Model Gateway:** retained as the single private Foundry invocation and application function-call mediator. Replace/remove LangGraph after equivalent Foundry integration is tested; do not run two dialogue loops.
- **Node API:** server-derived Agent/session identity, secure OTP/accounts, ticket lifecycle, durable context and events, tool authorization, independent grounding, consent, preflight and business action gate.
- **Foundry IQ / Azure AI Search:** agent-scoped approved knowledge indexed separately from transactional PostgreSQL. Use gateway-mediated `search_knowledge`; no alternate uncontrolled native agent tools, Bing/web browsing, arbitrary fetch or unrestricted SQL.
- **PostgreSQL:** authoritative tickets, messages, context facts, account identity, versioned configs, documents metadata, audit, operations, outbox/inbox and provider evidence. **Redis:** TTL caches, OTP challenge state, coordination and event transport; never sole durable truth.
- **OCR/document processing:** customer documents are private ticket attachments; extraction returns source-linked structured fields, not shared RAG content.
- **Workers / n8n:** execute only independently authorized, idempotent operations; verified provider evidence updates ticket state. No direct model-to-provider actions.
- **SSE:** server-to-browser notifications with authorization and durable replay. Client commands use authenticated HTTP. SSE is NOT authentication.

## Non-negotiable engineering rules
1. Server derives `agent_id`; never accept agent scope or tool/provider URLs from model-generated content as authority. Enforce agent scope for records, searches, cache keys, callbacks and credentials.
2. One customer journey: accepted message → durable ticket event → context → Foundry → gateway-mediated tools → Node claim/response validation → durable message/summary → SSE. Business actions use a separate Node permission gate + transactional outbox + n8n + verified result.
3. Persist inbound messages **before acknowledgment**. Async transcript views and AI summaries may follow; Redis restart cannot lose accepted messages. Protect against concurrent turns and duplicate requests.
4. Generic model-visible functions: `find_intents`, `get_intent_requirements`, `search_knowledge`, `get_offerings`, `get_ticket_context`, `get_document_data`, `preflight_operation`, `propose_operation`, `get_operation_status`. Publish an allowlist for each Agent; read/preflight and proposals are not execution.
5. Intents are determined semantically, not by mandatory keywords or a fixed business stage flow. No ANCFZ-specific document requirements tool or compulsory goal confirmation. Price and formal quote inputs use approved structured catalogs, not raw RAG summaries.
6. User-provided email does not authenticate or automatically create an account. Node handles OTP through secure UI/API; never prompt for or expose OTP, passwords, API keys or tokens to the model. Account creation requires verified opt-in.
7. Every consequential action needs current prerequisites, purpose-specific consent and explicit customer authorization when required. Tool success or webhook 200 is not provider completion. Ticket closure requires explicit customer confirmation; pending operations must reconcile safely.
8. Ground material business claims with agent-approved source revisions, authoritative offering records or verified provider state; greetings and clarification may be uncited. Do not reject supported paraphrases based on lexical overlap.
9. Keep PII protection: encryption, least privilege, structured contact capture, contextual detection for names, safe logs and retention controls. Azure processing does not exempt privacy duties.
10. Immutable published versions and ticket pins for agent, persona, knowledge, intents, offerings and workflows. Catalog and document text is untrusted data, not executable instructions.
11. Clean POC rebuild permits deleting unused code, obsolete APIs, legacy scripts and staging migrations **once replaced and tested**. Prefer complete module replacement over cumulative adapters/compatibility shims.
12. Migration to ordinary PostgreSQL requires removal of ALL pgvector schema types/functions/indexes and application embedding calls, plus fresh-database tests. Do not replace the image before migration contracts are ready.
13. Historical user records, RAG source documents, credentials and provider evidence must never be silently discarded. For a disposable POC database, archive legacy DDL, establish a new baseline and document intentional resets; secrets never enter Git.
14. CI must cover Node/Python contracts, agent isolation, RAG source approval/revocation, OTP, ticket events/SSE replay, workflow idempotency, OCR, Docker boot and real Foundry/n8n UAT. Never label mocks production certification.

## Change procedure
Plan ownership and interfaces first. Use isolated worktrees for independent tracks, merge at explicit integration boundaries and delete retired paths only when nothing imports them. Documentation updates are not runtime completion. Current task is inventory + docs/plan; do not claim a cutover, migration, production deployment or removal of dependencies until those changes are actually committed and validated.

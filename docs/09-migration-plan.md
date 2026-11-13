# 09 — Clean POC agent-centric rebuild and parallel implementation plan

**Plan status:** repository audit/target documentation; the running application is not refactored by this page. Baseline audited: `refactor/clean-architecture-rebuild` at `b22c8f1` (526 tracked files). POC changes may break old APIs/data schemas intentionally; do not claim an in-place production upgrade.

## Audit summary
- `services/api/src/index.ts` currently composes `conversation-core/**`, tenant-scoped PostgresStore, embedding/RAG tools, grounding and WebSocket `chat-stream`. `public-app.ts` exposes tenant-slug chat endpoints and tenant administration. No canonical ticket/SSE/OTP-account customer path is implemented.
- `services/model-gateway/gateway/app.py` invokes `p4_graph.py` LangGraph with `p4_contracts.py`, old provider/OpenAI configuration and two grounding adapters. `requirements.txt` pins `langgraph`. Rewrite as one Foundry Agent Service/Responses binding plus mediated Node function calls.
- `services/api/src/store-postgres.ts` (~161 KB), `store-memory.ts` (~87 KB), `types.ts` (~42 KB) and `intent-catalog.ts` (~49 KB) couple tenant/CRM/RAG/lifecycle concerns. Replace with bounded repositories and typed agent/ticket/catalog/action contracts; no wrapper over obsolete store.
- `apps/web/app/page.tsx` (~78 KB) and `chat-stream-client.ts` use tenant chat and WebSockets. Rebuild into agent-scoped ticket UI with HTTP message commands, SSE reconnect/replay, OTP, upload and action statuses.
- Angular admin is tenant- and CRM-oriented (tenant service, org table, CRM dashboard, old intent editor, knowledge manager). Keep Angular design primitives, replace domain services/screens with Agent, Persona, Knowledge, Intents/Requirements, Offerings, Tools/Workflows and Tickets.
- `tools/ingestion/ingestion/pipeline.py` chunks knowledge for pgvector; `worker.py` mixes knowledge indexing, catalog parsing and OCR; `document_ocr.py` has reusable PDF/image extraction and Tesseract. Split Foundry IQ ingestion from private ticket OCR; optionally use Azure Document Intelligence.
- `services/api/src/event-bus.ts` and event relay/worker contain reusable durable-outbox concepts but tenant/CRM route contracts. Rewrite generic `agent_id` / ticket action event contracts; reuse idempotency and reconciliation design, not retired paths.
- `infra/n8n/workflows/**` includes old ANCFZ seven-stage, CRM polling and mock-finance workflows. Retain reviewed lead/quote logic as examples; replace with two generic Agent-workflow templates and independently verified callbacks; archive or delete dead workflow imports.
- `docker-compose.yml` uses `pgvector/pgvector:pg16`; `docker-compose.local.yml` also uses pgvector for P2 test. `001-schema.sql` creates vector extension/column and `042` adds 1536-vector HNSW. Do **not** merely swap Docker image.
- `infra/postgres` has numbered schema 001–077 and an excluded duplicate `072-publish-v13-catalog.sql`; these include legacy tenants, embeddings, CRM lifecycle, V2 versions and old callback contracts. Start a concise checked new POC baseline on disposable DB; archive original history outside active migration directory after documenting data retention.
- `package.json` contains scripts pointing to missing `scripts/verify-n8n-salesforce-lead-runtime.mjs`, `scripts/verify-secrets.mjs`, `scripts/verify-local.mjs` and others. Prune or replace scripts and CI references after verifying required callsites.

## Clean replacement rule
For each file or module: **KEEP unchanged** if behavior/contracts fit, **REWRITE complete module** when concept changes, **DELETE** only after confirming it is no longer imported/referenced. No old API aliases, dual active model paths, tenant-to-agent compatibility layer or second RAG search. Keep secrets, historical data/evidence and uploaded files out of automatic cleanup.

## Recommended foundation order
**P0: Freeze cross-service contracts** — agent IDs/version pins, ticket/message/event sequence, function envelopes, intent/offerings/action schemas, OCR extraction, auth and provider callback signature. Land docs plus contract fixtures first.

**P1: New database baseline** — ordinary PostgreSQL 16. Candidate ordered migrations: 001_agents_identity, 002_agent_configs_catalogs, 003_accounts_otp, 004_tickets_messages_events, 005_knowledge_documents, 006_actions_integrations_outbox, 007_rls_indexes. Use agent-scoped composite keys/FKs/RLS, partial operational indexes and immutable published JSON catalog snapshots. Run clean install twice, static constraints and real database tests. Existing RAG/legacy data not rewritten in place.

**P2: Node app core** — replace monolithic Store, tenant routes, chat composition and conversation-core adapters with one `AgentResolver`, `TicketService`, `ContextService`, `ToolRegistry`, `ActionAuthority` and typed repositories. Durable message intake and ticket number before invoking Foundry.

**P3: Python Foundry gateway** — one `FoundryAgentClient`, `FunctionDispatcher`, `GatewayContracts`, bounded tool-call lifecycle and independent grounding service; remove `p4_graph`, `p4_contracts`, LangGraph dependencies and obsolete mock adapters once tests pass.

**P4: Foundry IQ + OCR** — new `KnowledgePublisher` handles approved per-agent indexing/revisions, `KnowledgeRetriever` returns extractive citations, independent `TicketDocumentProcessor` handles private OCR/extraction, source-linked structured fields and AI summaries. Remove embedding/chunk search from Node and old ingestion pipeline.

**P5: Generic catalogs and execution** — implement semantic `find_intents`, `get_intent_requirements`, `get_offerings`, proposal/preflight and policy authorization. One transactional action + outbox → worker → n8n → callback route for lead and quote; every transition updates ticket event.

**P6: Auth/events/UI** — agent-scoped customer accounts, secure OTP and opt-in registration, SSE replay and ticket header, customer UI, admin Agent/Catalog/Knowledge/Tickets screens. Use shared contract fixtures from P0 and DB schema from P1.

**P7: Docker/scripts/cleanup** — switch Postgres images, simplify environment and runtime services, rebuild OCR worker, consolidate worker roles only if operationally safe, remove obsolete mock payment/PDF profiles, unused migrations/scripts/test artifacts and legacy endpoints after import graph goes green.

**P8: Integration/certification** — exact-head typecheck/lint/unit/build, SQL fresh migration/DB tests, Node↔Python contracts, real Foundry IQ agent/RAG, OCR, OTP, SSE replay, duplicate webhook/n8n lead/quote and browser E2E. No dual-run cutover; a fully fresh POC deployment is acceptable after evidence.

## Parallel workstreams after P0
| Stream | Owns | Depends on |
| --- | --- | --- |
| A — PostgreSQL/domain repositories | `infra/postgres/**`, new typed repositories, migration runner tests | P0 contracts |
| B — Foundry gateway | `services/model-gateway/**`, Foundry SDK and tool-call contracts | P0 contracts + mocked Node executor |
| C — Knowledge/OCR | `tools/ingestion/**` replacement, Foundry IQ adapter, private OCR | P0 contracts; DB storage integration later |
| D — Customer UI | `apps/web/**`, HTTP/SSE/OTP/ticket components | P0 API mocks |
| E — Angular Admin | `apps/admin/**`, Agent management and catalogs | P0 API mocks |
| F — n8n workflows | `infra/n8n/workflows/**`, generic lead/quote callback fixtures | P0 action contracts |
| Integrator — Node application | `services/api/src/**`, single composition root, auth, tools, events and integration | A–F contracts, merge sequentially |
| Finalizer — Docker/CI/deletions | Compose/Dockerfile/`.env.example`/scripts/tests/docs | P1–P6 imported successfully |

Use isolated branches/worktrees and **exclusive file ownership**. Avoid running parallel workers against the same monolithic store or Compose. Integrate A+B+C first into one backend, then F, then D+E; use targeted contract suites per merge.

## Minimal Compose target
Long-running: `postgres` (ordinary Postgres), `redis`, `n8n`, `model-gateway`, `api`, `worker`, `ocr-worker` (if independent), `web`, `admin`, `nginx`. One-shot: `schema-migrate`, optional `admin-bootstrap`. Retire `event-relay` only when its outbox responsibilities have a tested owner in `worker`; retire quote-pdf and mock-payments only after n8n quote path no longer depends on them. Do not install vector extension or ship embedding credentials. Preserve OCR functionality, not necessarily old OCR container layout.

## Validation and POC data handling
Fresh disposable POC PostgreSQL volume is permitted after explicit archive/backup decision. Old schema files are not applied in the new baseline, and no historical ledger checksum is falsified. Keep existing RAG DOCX files outside the new SQL chain for re-ingestion into Foundry IQ after approval. Test rollback by recreating a clean volume and restoring any intentionally retained POC data. Make no "production-ready" claims without real Foundry/n8n and fault-injection evidence.

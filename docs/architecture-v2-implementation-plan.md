# Architecture V2 implementation plan

## Verified baseline

- Base: `origin/main` at `cf07f0320d07c8c321a444eb25e2384cb4e1fcd9` (`chore(deploy): harden Docker VM deployment`).
- Branch: `feat/rag-v2-reliability-conversation-intelligence`.
- Existing architecture is API-led: Express/TypeScript owns conversation state, privacy, intent policy and action authorization; PostgreSQL is authoritative; Redis Streams relay events; workers bridge allowlisted n8n workflows; Angular and Next.js consume the API.
- Existing migrations through `031-catalog-normalization-rollout.sql` are additive and already contain an outbox, a basic inbox, action execution records, catalog bindings, conversation state, CRM records and document jobs.
- Baseline verification: API 129 passed / 2 skipped, web 13 passed, admin 22 passed, chat-utils 3 passed, contracts 3 passed; workspace typecheck, lint, Compose security and secret scans passed.

## Audit findings

| Area | Finding | Classification | Change |
| --- | --- | --- | --- |
| Redis groups | New groups use `$`, so backlog events can be skipped. | Defective | Create new groups at `0-0`; preserve existing groups and offsets. |
| Inbox | A boolean insert happens after dispatch, so duplicate delivery can repeat a side effect and there is no lease/recovery state. | Incomplete | Add durable pending/processing/completed/retry/reconcile/dead-letter lifecycle with leases. |
| Worker errors | Only ambiguous errors are persisted; ordinary failures remain pending without bounded retry or observable policy. | Incomplete | Classify failures, schedule bounded retry, then persist dead-letter/reconciliation state before ACK. |
| n8n routing | 404/405 is audited and returned as success; event dispatch did not resolve the catalog workflow identity. | Defective | Treat unverified routes as unauthorized/reconciliation-required, resolve active binding IDs and contracts, and never ACK as success. |
| Event routing | CRM and notification streams can silently no-op through the generic bridge. | Incomplete | Add an explicit routing registry and observable intentional no-op policy. |
| Privacy | Session token assignment is already one-pass and collision-safe, but production vault placeholder fail-closed and purpose authorization need explicit tests/guards. | Incomplete | Harden startup validation and purpose-bound server-side rehydration. |
| Conversation | Structured state, continuity, slot correction and CAS already exist. | Implemented but incomplete | Add regression coverage for knowledge interleaving, stale callbacks, corrections and state-derived summary. |
| CRM/RAG/UI | Existing lead, OCR, citation and admin primitives exist; hybrid retrieval and correlated execution visibility are partial. | Incomplete | Add deterministic full-text + vector fusion, safe status projections and focused admin/visitor status coverage where APIs already support it. |

## Implementation order and gates

1. **Reliability:** migration-backed inbox lifecycle, Redis group initialization, classified retry/DLQ/reconciliation, explicit event routing and correlation metadata.
2. **Privacy:** production vault fail-closed, key-version compatibility, collision/rehydration regression tests and redaction checks.
3. **Conversation:** typed state-derived summary and continuity/slot/concurrency regression tests without increasing model calls by default.
4. **CRM:** separate contact completeness from qualification, preserve default contact policy, and make remote completion/reconciliation idempotent.
5. **RAG:** tenant-safe PostgreSQL full-text search and deterministic rank fusion with citation validation preserved.
6. **Workflow/UI:** validate binding/callback state transitions and expose safe lifecycle status through existing APIs and UI components.
7. **Verification:** unit, integration, security, build, Compose, browser and real local chat checks; document unavailable external Salesforce/n8n checks.

## Compatibility and rollout

- Migrations are additive. Deploy the schema before the worker code; old rows remain readable.
- Existing Redis consumer groups are never reset. New groups start at `0-0` so historical events are recoverable.
- Existing public chat, catalog, CRM and OCR contracts remain unchanged unless a new optional status field is added.
- No live data, tenant, catalog, document, workflow or n8n volume is reset by this work.
- Rollback is code rollback after retaining additive schema. Inbox rows and event states remain auditable and can be replayed by an authorized operator.

## Progress

- [x] Milestone 1 — reliability (durable inbox lifecycle, backlog-safe groups, bounded relay/worker retry, DLQ and reconciliation paths)
- [x] Milestone 2 — privacy (collision-safe Unicode masking, production vault guard, purpose-bound rehydration regression coverage)
- [x] Milestone 3 — conversation (state-derived masked summary, provenance-aware slot merge, continuity and stale-write coverage)
- [x] Milestone 4 — CRM (separate contact completeness score and backward-compatible workflow/lead status handling)
- [x] Milestone 5 — RAG (tenant-filtered PostgreSQL vector/full-text rank fusion; no-evidence and citation behavior retained)
- [x] Milestone 6 — workflows (explicit event routing policy, accepted-versus-completed audit distinction, callback-safe failure states)
- [x] Milestone 7 — UI (visitor status compatibility retained and admin workflow timeline added)
- [x] Milestone 8 — final verification (automated suite, container rebuild, additive migrations, API health, browser chat/admin shell, internal CRM idempotency, secret/diff review)

Implementation gates are complete locally. Container rebuild, additive migration check, API tests, local chat/browser flow, internal CRM dedupe check, and the workflow-identity regression check have passed. Live Salesforce, live external n8n runtime state, and production Redis outage recovery remain external verification items.

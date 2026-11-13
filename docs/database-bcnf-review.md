# Database normalization, keys and service-integration performance review

## Scope and model decision

**BCNF** (Boyce–Codd Normal Form) is used where relational functional dependencies are meaningful. It is not a meaningful instruction to flatten every JSON document: published catalog snapshots, immutable model-evidence receipts, and event envelope payloads are document boundaries, not relational master data. An unconditional BCNF rewrite would duplicate mutable truth and break the new GPT-first conversation model. No RAG source, pgvector embedding, source version or customer document content is rewritten in this review.

## Reviewed schema domains

| Domain | Storage and functional dependency | Decision |
|---|---|---|
| Tenants and authentication | Tenant ID and canonical login email are keys; each user belongs to at most one tenant | Retain separate tenant/user tables; add case-insensitive email uniqueness and seed one `platform_admin` |
| Conversations | A message is identified by UUID and a stable session/client-message identity | Retain atomic rows, enforce tenant/session ownership, index history order |
| Published catalogs | A tenant-scoped version reference determines one immutable JSON catalog snapshot | Keep JSONB as a versioned immutable aggregate; don't split text and requirements into duplicate mutable tables |
| Business lifecycle | Quote, selection, invoice and contract rows reference specific parents | Add composite tenant/ID keys and same-tenant FKs so foreign UUIDs cannot silently cross tenancy |
| Package offerings | Catalog-versioned entity/activity/document lists are JSONB | Not fully 1NF/BCNF internally; preserve snapshot semantics until an authoritative typed product/pricebook writer replaces them |
| CRM leads/accounts | A lead UUID and tenant determine lifecycle details; remote IDs are provider identity attributes | Preserve independently verified remote IDs; add same-tenant parent references and scoped remote uniqueness |
| Workflow outbox/inbox | Event identity and consumer/event idempotency are natural keys | Preserve transactional inbox/outbox and JSON payloads; add partial ready/retry indexes |
| Integration connections (076) | `(tenant,provider,connection_key) → connection` | Normalized connection entity with credential *reference* only and mandatory tenant RLS |
| Integration remote objects (076) | `(connection,resource_type,external_id) → remote-object mapping` | Normalized unique key; reference to originating action is constrained to the tenant |
| Dispatch attempts (076) | `(tenant,action,connection,attempt_no) → status, timestamps, request ID` | BCNF attempt facts; a retry has a distinct sequence but retains its provider idempotency key |
| Webhook deliveries (076) | `(connection,external_event_id) → event digest, verified/processed state` | Normalized inbound deduplication; never persist raw body or secrets here |

## Material changes

- 075 renamed the legacy catalog and OTP tables/columns in place; no rows are dropped.
- 076 defines normalized integration keys, `FORCE ROW LEVEL SECURITY`, cross-tenant FKs, canonical email uniqueness and selective operational indexes.
- 077 adds same-tenant FKs for CRM accounts/lead associations, package/quote/selection relationships, invoice/contract relationships and unique provider remote IDs. It drops one provably redundant CRM account opportunity index.
- The privileged PostgreSQL initialization owner is confined to schema migrations. The running Node API, event workers and admin bootstrap use the non-superuser `agentic_app` role. No RLS guarantee applies if these services are mistakenly given the cluster-owner credentials.
- Exactly one admin login can be bootstrapped. No password, password hash, provider credential or KMS secret is committed.

## Query/index decisions

| Access path | Index | Reason |
|---|---|---|
| Chat history | `chat_messages_session_history_idx` | Tenant/session equality, deterministic reverse creation order |
| Action history | `action_requests_session_recent_idx` | Session timeline and pagination |
| Provider execution readback | `action_executions_action_recent_idx` | Latest execution by action and tenant |
| OCR processing queue | `document_processing_jobs_ready_idx` | Partial index for queued/processing work, ordered claim |
| Event outbox claim | `event_outbox_ready_idx` | Partial ready set and ordered event IDs |
| Inbox retry | `event_inbox_retry_idx` | Avoid scanning completed inbox rows |
| Authentication cleanup | `auth_sessions_unrevoked_idx` | Active user sessions, expiring first |
| Invoice/account reconciliation | `invoices_opportunity_status_idx`, `crm_accounts_lead_status_idx` | Tenant-aware stage/status lookup |
| Consent/action grants | `conversation_action_grants_live_action_idx` | Authorized action lookup by tenant/session/revision |
| External object/callback | Unique provider+external ID indexes | Stop duplicate remote identities and callback replays |

## Migration semantics and operational caveats

- Migration IDs are unique and checksummed; `072-publish-v13-catalog.sql` is intentionally **excluded** because it is an optional content publication and duplicates migration number 072. Never make schema startup run tenant-specific catalog publication.
- Initial migration scripts with explicit `BEGIN/COMMIT` are executed inside the runner's own transaction; migration ledger entries are written only after the DDL succeeds.
- Applied migration files must not be rewritten. A database without a verifiable ledger requires an audited manual baseline, not a destructive reset.
- Composite FKs on historical business rows are initially `NOT VALID`. They constrain all new writes; a separate cross-tenant audit and `VALIDATE CONSTRAINT` maintenance pass is required for old data.
- Creating B-tree indexes or renaming large tables can acquire locks; schedule a maintenance window for databases with significant data. New production indexes should be checked using actual `EXPLAIN (ANALYZE, BUFFERS)`, index usage, p95/p99 and write amplification before additional tuning.
- The new normalized integration tables are schema contracts. They do not make legacy Salesforce/n8n callbacks production-ready or constitute an implemented provider gateway.
- Service accounts should eventually be split by bounded context (conversation, ingestion, workflow provider) with column/table-specific grants; the current `agentic_app` CRUD role is a safer baseline than the migration owner, not final least privilege.

## Acceptance evidence

The exact-head GitHub CI runs TypeScript/lint/unit/build, Python gateway and ingestion tests, static Docker Compose checks, a complete fresh PostgreSQL migration chain and idempotent re-run, admin bootstrap, canonical key/unique index checks, composite FKs, non-superuser RLS read denial, same-tenant FK enforcement, retry identity and webhook dedupe checks. A green result is necessary but does not replace live Azure, Salesforce or high-cardinality query-plan/performance certification.

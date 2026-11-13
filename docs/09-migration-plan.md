# Clean architecture migration and rollout

The customer-facing conversation implementation is the single Node `services/api/src/index.ts` composition root and `services/api/src/conversation-core/**`. It delegates bounded GPT/LangGraph read-only tool turns to the private Python `/internal/conversation/turn`. A separate model judgment and independent Node receipt/revocation checks enforce evidence-backed claims. Node owns tenant/session identity, private RAG access, verified facts, explicit action authorization and authoritative persistence.

## Completed code retirement

- Deleted the old Express `app.ts` coordinator, deterministic conversation planner, V2 turn controller, workflow-bridge entrypoints, duplicate provider controllers and stale model contracts.
- Removed the Python V2 agent/graph/contract stack and its obsolete endpoints. No alternate V2 conversation engine remains registered.
- Rewired shared catalog, workflow-routing, provider-correlation, memory and PostgreSQL store contracts into the canonical core.
- Removed the P6 preview transport, V2 feature flags, abandoned V2 n8n draft templates and obsolete canary test scripts.
- Renamed the ingestion catalog workbook parser to a generic published-business-catalog parser.

## Required database transition

Migrations `infra/postgres/075-business-catalog-storage.sql` and `076-normalized-integrations-and-indexes.sql` renames retained business catalog/OTP tables and catalog-reference columns in place, updates persisted catalog-source values and rewrites only unpublished outbox stream names. It does not drop or truncate records. Run the forward-only migration once using the repository's verified migration runner before launching the new build; verify schema and outbox consistency separately. Retain historical migrations 001–074 for reproducible upgrades and audit history. This does not authorize resetting RAG embeddings, vectors, source versions, existing tenant data, or other customer records.

## Release gates not yet certified

- Exercise a real PostgreSQL upgrade and clean install, then verify all table/constraint names and query contracts under multi-tenant isolation.
- Validate the private Node/Python request path in Docker Compose with real Azure/OpenAI model and embeddings, including negative security tests and multi-turn natural language quality.
- Wire and independently verify customer-approved business actions, notifications, lead/account/document/payment/contract provider callbacks and idempotent outbox reconciliation; a model suggestion must never be equated with completed execution.
- Replace remaining legacy administrative / event execution infrastructure with approved new-core action interfaces. Do not enable unsupported old workflow endpoints or misrepresent successful business actions.
- Confirm CI on the exact commit and perform a deployment smoke test. Unit-only CI is not production/UAT acceptance.

## Rollback and data policy

Use a branch/deployment rollback for application code only. Because the storage migration is forward-only, a pre-migration database backup and tested restoration procedure are required before any environment-level rollback. Do not perform automatic destructive migration or modify protected RAG knowledge.

## Clean build schema lifecycle and admin-only bootstrap

`schema-migrate` executes the transaction-locked, SHA-256 checked, forward-only SQL runner before the API starts. PostgreSQL no longer automatically executes all historical SQL files through `/docker-entrypoint-initdb.d`. Migration 072's historical catalog **content publication** is excluded from schema migrations because it duplicates a schema version and is optional product data, not DDL. Historical migrations 001–075 remain retained. The runner refuses to operate on an existing populated schema without a verified ledger: use a backed-up, audited manual baseline instead of guessing.

`076` adds normalized provider connections, remote identities, dispatch attempts and webhook inbox records. These contain only bounded references; provider credentials and raw webhook bodies must remain in the secret manager and authorized private storage. Foreign keys constrain tenant ownership; `FORCE ROW LEVEL SECURITY` requires every future integration adapter to use `SET LOCAL app.tenant_id = '<validated tenant UUID>'` inside its transaction. New cross-tenant constraints on older business rows are `NOT VALID` pending a clean data audit, but reject inconsistent new writes.

Only the explicitly configured administrator is bootstrapped: `admin@techcarrot.ae`, role `platform_admin`, no tenant. No migration provisions another user, and no password or hash is checked into Git. After setting `ADMIN_BOOTSTRAP_PASSWORD` in your shell/secret store (not committed .env), run:

```sh
docker compose --profile bootstrap run --rm admin-bootstrap
```

The bootstrap is idempotent and refuses an unexpected existing role. Password changes are opt-in with `node scripts/bootstrap-admin.mjs --rotate` in a private shell or disposable migration container. Active authentication sessions are revoked on rotation. Do not deploy the shared initial password unchanged to public production; rotate after first access and enable MFA when available.

The migration/schema CI job validates fresh DDL, identity keys, scoped foreign keys, unique indexes, RLS, bootstrap idempotency, and retry identity. It does not prove production data conformity or provider throughput; run `EXPLAIN (ANALYZE, BUFFERS)` against representative tenant cardinalities before tuning work_mem or index count.

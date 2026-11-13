# Clean architecture migration and rollout

The customer-facing conversation implementation is the single Node `services/api/src/index.ts` composition root and `services/api/src/conversation-core/**`. It delegates bounded GPT/LangGraph read-only tool turns to the private Python `/internal/conversation/turn`. A separate model judgment and independent Node receipt/revocation checks enforce evidence-backed claims. Node owns tenant/session identity, private RAG access, verified facts, explicit action authorization and authoritative persistence.

## Completed code retirement

- Deleted the old Express `app.ts` coordinator, deterministic conversation planner, V2 turn controller, workflow-bridge entrypoints, duplicate provider controllers and stale model contracts.
- Removed the Python V2 agent/graph/contract stack and its obsolete endpoints. No alternate V2 conversation engine remains registered.
- Rewired shared catalog, workflow-routing, provider-correlation, memory and PostgreSQL store contracts into the canonical core.
- Removed the P6 preview transport, V2 feature flags, abandoned V2 n8n draft templates and obsolete canary test scripts.
- Renamed the ingestion catalog workbook parser to a generic published-business-catalog parser.

## Required database transition

Migration `infra/postgres/075-business-catalog-storage.sql` renames retained business catalog/OTP tables and catalog-reference columns in place, updates persisted catalog-source values and rewrites only unpublished outbox stream names. It does not drop or truncate records. Run the forward-only migration once using the repository's verified migration runner before launching the new build; verify schema and outbox consistency separately. Retain historical migrations 001–074 for reproducible upgrades and audit history. This does not authorize resetting RAG embeddings, vectors, source versions, existing tenant data, or other customer records.

## Release gates not yet certified

- Exercise a real PostgreSQL upgrade and clean install, then verify all table/constraint names and query contracts under multi-tenant isolation.
- Validate the private Node/Python request path in Docker Compose with real Azure/OpenAI model and embeddings, including negative security tests and multi-turn natural language quality.
- Wire and independently verify customer-approved business actions, notifications, lead/account/document/payment/contract provider callbacks and idempotent outbox reconciliation; a model suggestion must never be equated with completed execution.
- Replace remaining legacy administrative / event execution infrastructure with approved new-core action interfaces. Do not enable unsupported old workflow endpoints or misrepresent successful business actions.
- Confirm CI on the exact commit and perform a deployment smoke test. Unit-only CI is not production/UAT acceptance.

## Rollback and data policy

Use a branch/deployment rollback for application code only. Because the storage migration is forward-only, a pre-migration database backup and tested restoration procedure are required before any environment-level rollback. Do not perform automatic destructive migration or modify protected RAG knowledge.

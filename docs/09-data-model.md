# Conceptual data model and database boundaries

**Not a ready-to-run migration.** This is a design reference. Final schema, constraints and types are selected during implementation with approved threat model and embedding model dimensions.

## Logical schema partition
| Domain | Suggested tables | Sensitive? |
| --- | --- | --- |
| Identity/configuration | tenants, channels, principals, memberships, permissions, settings | identifiers, roles |
| Conversation | chat_sessions, chat_turns, masked_context | masked text; no plain identities |
| Customer vault | customer_records, pii_token_mappings, key_versions, consent_records | **restricted encrypted PII** |
| Knowledge | knowledge_sources, source_versions, source_acl, source_chunks, embeddings, ingestion_jobs | approved material; classifications |
| Automation | action_registry, action_requests, workflow_runs, action_events | opaque refs, redacted payloads |
| Observability | audit_events, retrieval_traces, feedback_events | no plaintext PII |

## Row-level invariants
- Every tenant-scoped record has tenant_id and a tested DB/query isolation boundary. Prevent references across tenants with composite constraints and guarded joins.
- Knowledge source/version has status, published_at, valid_from/to, checksum, owner, visibility and ACL. Only **active** permitted versions are searchable.
- Chunk has immutable source version, locator, ordinal, normalized checksum, parser/chunker version, embedding model ID/dimension and vector.
- Conversation turns must be masked prior to write to general chat/analytics; raw content belongs only in a specifically authorized vault if business-required.
- Token map contains random token ID, encrypted value, tenant/session/principal scope, purpose, authorized recipient, expiry and key ID. Never embed or index token map as search content.
- Action requests contain idempotency key, tenant, workflow key/version, confirmation/consent reference, state, timestamps, correlation IDs and audit provenance.
- Audit events log actor, action, request ID, result and bounded metadata, **not** plaintext PII or prompt transcripts.

## Retrieval indexes
pgvector extension operates inside PostgreSQL. Use an index type verified for actual vector dimensions/query patterns (HNSW/IVFFlat where appropriate), a tenant/source status index and full-text GIN index if hybrid retrieval is implemented. Define distance metric consistent with chosen embedding model and test filtered recall/latency. Do not hardcode vector(1536) or another dimension until the deployment is confirmed.

## Key data lifecycle
Uploads: staged → parsed → validated → embedded → awaiting approval → active → retired/deleted. Use immutable source versions and single active promotion semantics. On revocation immediately filter at query time; asynchronous physical deletion handles indexes/backups according to policy.

Action state: proposed → awaiting_confirmation → authorized → queued/running → completed/failed/unknown/cancelled. Each transition must be monotonic and auditable; unknown is not success. Provider correlation and idempotency prevent duplicates.

## Isolation and migrations
Create separate roles for migrations, app runtime, vector retrieval, ingestion writer, audit reader and token vault. Consider DB RLS as defense in depth, but still enforce application authorization. Use zero-downtime migrations when possible, transaction boundaries, encrypted backups with restore drills and a procedure to re-embed on model changes.

# Conversation core — active runtime

The only customer conversation coordinator is `services/api/src/conversation-core/turn-engine.ts`, composed by `services/api/src/index.ts` and mounted through `conversation-core/http/public-app.ts` and `http/customer-turn.ts`. There is no independent V2 HTTP controller or canary dialogue path.

## Request lifecycle

1. Node authenticates the tenant, session, public origin, customer access token and expiry; it binds the trusted actor server-side.
2. The PostgreSQL repository loads a revision-bound session snapshot. The private scoped vault masks customer data, and the model receives only the safe projection.
3. A bounded private Python LangGraph turn selects permitted read tools via the session-scoped Node registry. The gateway has no SQL, Salesforce, n8n or provider-write authority.
4. Node validates signed retrieval receipts against the current tenant/public source versions, verifies material claims through an independent semantic entailment reviewer, and rejects unsupported or revoked evidence.
5. The published business catalog supplies tenant-specific goals, allowed customer facts, requirements and prospective actions. Model proposals are not authorization. Node checks explicit session/customer authorization, consent, current catalog version and independently verified requirements.
6. Node atomically persists the customer message, response and validated facts. The HTTP and WebSocket entrypoints share this path. Unauthorized claims/actions fail closed.

## Current modules

- `catalog/catalog.ts`, `catalog/workflow-routing.ts`: published tenant business catalog and workflow-binding validation
- `adapters/p5-catalog.ts`, `adapters/p5-proposal-validator.ts`, `adapters/session-action-authority.ts`: server-owned goal/action proposal policy and grant readback
- `adapters/rag-read-tool.ts`, `adapters/read-tool-scope.ts`, `adapters/evidence-receipt.ts`: tenant-scoped authorized retrieval and signed provenance
- `adapters/authorized-claim-verifier.ts`, `authorization/grounding.ts`: claim-level independent grounding checks
- `adapters/postgres-repository.ts`, `adapters/p6-session-vault.ts`: transactional session state and protected PII
- `http/public-app.ts`, `http/customer-turn.ts`: authenticated public API, session and response routes

Some filenames still contain their historical implementation-phase prefixes (P4/P5/P6); these are modules of this **single** active engine, not competing runtimes. They can be normalized without altering behavior in a separate mechanical rename.

## Explicit limitations

Node's action-state reader does not create customer authorization grants; a separate authenticated consent/action API is required. Legacy administrative routers and event providers do not become new-core workflow execution merely because their data stores are reused. The old preview postback is disabled to avoid falsely recording consent. Complete provider-backed stages require reconciled callback evidence, integration tests and real Azure conversation evaluation.

## Storage transition

Apply `infra/postgres/075-business-catalog-storage.sql` before deploying the updated SQL queries. It renames versioned storage objects in place, preserving tenant data, embeddings, source versions and audit history. Historical migrations remain in the repository and must not be deleted. Verify schema and RLS under a real Postgres instance; CI unit runs alone cannot certify deployment readiness.

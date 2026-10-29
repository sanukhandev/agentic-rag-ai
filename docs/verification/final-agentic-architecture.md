# Agentic architecture verification

Date: 2026-10-28  
Branch: `feat/catalog-driven-journey-orchestration`  
Verified head: `e6a6d59e32fa4a45bc0c4fcfdf1ce5aff4d1ba03`

The implemented path is a tenant-scoped Node/Express chat boundary with PostgreSQL/pgvector retrieval, masked conversation state, catalog-driven journey requirements, bounded model drafting, citation validation, transactional outbox, Redis streams, n8n dispatch and authenticated callbacks. The model may draft intent, retrieval queries and responses; Node validates tenant, catalog, consent, citations, idempotency and state transitions.

The current implementation is not a complete Lead→Account→Package→Documents→Invoice→Contract platform. The durable domain types and APIs currently cover CRM Lead, supporting documents, actions and workflow execution. Account, Contact, Opportunity conversion, invoice, payment and contract entities/workflows are not present as verified capabilities.

The live stack was observed healthy for API, PostgreSQL, Redis, ingestion, event relay/worker, n8n, web and admin. n8n logs reported zero published workflows at startup. The existing live run reached n8n but ended in `reconcile_required` without a verified remote Lead ID.
# 2026-10-28 implementation validation

The current API image uses bounded typed agent tools for tenant-scoped context, catalog, approved knowledge, package/pricing, CRM, document, invoice and contract status. The model can plan read-only retrieval, while backend authorization controls facts, consent, eligibility, idempotency and side effects. The live Docker harness completed 205 customer turns across eight scenarios; external Account, billing and contract completion remain intentionally unclaimed where provider endpoints are unset.

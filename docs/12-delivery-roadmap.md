# Incremental implementation roadmap

All stages are **planned**, with no schedule or engineering commitment implied. Security-critical gates precede real customer traffic. Scope tasks independently using docs/14-feature-request-template.md.

## Phase 0 — foundation and decisions
Deliver: select package manager/versions, tenancy and identity model, hosting topology, Azure endpoints/chat + embedding model, storage and retention jurisdiction, secure secrets plan, first supported formats and n8n hardening plan. Approve ADRs and data handling. Gate: no public n8n/real PII.

## Phase 1 — repo bootstrap / infrastructure
Deliver: typed Node Express API scaffold, Next web scaffold, Angular admin scaffold, Python venv worker scaffold, PostgreSQL with pgvector migrations, Docker dev composition without public service exposure, CI skeleton, env templates and local health checks. Gate: typecheck/lint/build/tests, DB isolation roles, no committed secrets.

## Phase 2 — document knowledge base
Deliver: authenticated source upload and approval, a small validated file adapter set, checksums/versioning, content sanitizer, chunker, approved embedding adapter, vector upsert and retrieval tests. Gate: idempotent reindex, ACL prefilter, version/revocation checks, no raw PII sent to embedding model.

## Phase 3 — trusted chat and RAG
Deliver: session auth/scope, PII detector + encrypted token map, retrieval service, AI Foundry GPT-4.1-mini adapter, citations and evidence verification, web chat UI. Gate: unsupported questions fail closed; no PII in model/logs; cross-tenant tests pass.

## Phase 4 — safe automation POC
Deliver: typed intent schema, deterministic Node action registry, explicit confirmation step, private authenticated n8n demonstration workflow, durable idempotency and verified status. Gate: prompt injection cannot trigger action; retries do not duplicate effects.

## Phase 5 — admin operations and hardening
Deliver: knowledge management, role permissions, workflow run dashboard, source lifecycle, observability, incident/runbooks, backups and restore. Gate: penetration/security/privacy review, adverse-case evaluations and production go-live checklist.

## Phase 6 — additional channels and integrations
Deliver: channel adapters sharing the same Node conversation/policy core; implement one integration at a time with its own identity, webhook, payload minimization, consent and escalation design. Gate: no channel can bypass masking, knowledge ACL or action gateway.

## Suggested first vertical slice
Start with a small **synthetic** FAQ corpus: upload → parse → embed → approved retrieval → grounded web answer with citations, while keeping all external effects mocked. Then add privacy vault and guarded n8n side effect as explicitly tested gates before any real customer data.

## Acceptance checklist for each phase
- Architecture and contract docs updated
- Privacy/data classification reviewed
- Threat cases and tenant boundaries tested
- Normal and negative test evidence recorded
- Operator failure/rollback path documented
- Feature marked complete only if implementation and checks exist

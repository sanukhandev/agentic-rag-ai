# Product vision and scope

## North star
Enable accurate, traceable, conversion-oriented sales conversations across channels using business-controlled knowledge, without exposing customer identity to the generation model. A human operator or integration can complete approved actions, but the assistant must not invent business terms or claim that an action succeeded until the backend confirms it.

## Personas
- Visitor/prospect: asks about products, pricing, eligibility and services, may opt into lead capture.
- Sales/admin operator: curates approved source documents, monitors interactions, reviews leads and workflow results.
- Platform engineer: configures model deployments, ingestion, source access, channel adapters and integrations.
- Data/security owner: approves retention, access, compliance and incident procedures.

## Included in initial web MVP (target, not built)
- Mobile-accessible Next.js chat UI and Node chat API with conversation/session IDs.
- Tenant-aware, source-cited retrieval from approved documents and conservative unsupported-question handling.
- Secure ingestion job for an initial supported file subset, with extensible file adapters.
- Azure AI Foundry GPT-4.1-mini response generation; separate approved embeddings deployment.
- Structured intent detection and guarded n8n workflow trigger for a single approved demonstration use case.
- Server-side privacy masking, protected token mapping, authenticated admin source management and audit events.
- Basic metrics: ingestion status, retrieved source trace, model latency, token cost estimate, action outcome and failure counts without raw personal information.

## Later phases (not promised)
- Messaging/social/voice/channel adapters, CRM integrations, scheduling, advanced lead scoring, multilingual quality, human handoff, feedback loops, analytics dashboards and more document formats.
- Workflows vary by channel, compliance restrictions and business approval; do not implement on speculation.

## Explicitly out of scope unless separately requested
- Open-ended internet research as answer evidence; RAG knowledge is authoritative for company claims.
- Unreviewed autonomous purchasing, account edits, communications or CRM writes.
- Direct browser access to PostgreSQL, n8n or Azure AI.
- Model access to real customer names, phone numbers, addresses, emails or reversible token vault.
- Guaranteeing 100% factual correctness; control risk through citations, verification, rejection and testing.

## MVP definition of success
Given an approved source set, answer cited business questions correctly; reject questions not supported by the active, permitted corpus; preserve tenant isolation; avoid raw PII exposure to model/workflows; process repeat uploads idempotently; trigger exactly one authorized and auditable workflow when explicitly permitted; fail safely when model, DB, workflow or embeddings are unavailable.

## Nonfunctional targets to define before go-live
SLOs (availability and p95), ingest file limits, session retention, source update latency, RAG citation accuracy, supported languages, budget ceiling, model deployment region, accessibility target and privacy compliance jurisdiction. These are not yet selected.

## Confirmed multi-tenant MVP extension (15 October 2026)
The product is explicitly multi-tenant. The platform owner onboards organizations; organization admins log into an Angular control plane to manage their tenant, ingest DOCX/XLSX/TXT/Markdown/CSV/JSON/text-PDF and approved HTTPS link snapshots, publish approved knowledge and customize name, speaking style, personality and languages. Admin dashboards monitor Node API and dependent services with tenant-scoped metrics. Each organization's Next.js website chat accesses only that organization's **publicly approved** knowledge. Unsupported factual questions abstain; no factual general-knowledge fallback. Cross-organization and restricted-source disclosure are forbidden. Full functional requirements and acceptance criteria: docs/15-complete-feature-brief.md and docs/17-acceptance-test-matrix.md.

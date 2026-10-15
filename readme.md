# Agentic RAG AI

A local **privacy-first, multi-tenant, RAG-grounded sales assistant vertical slice**. Platform admins onboard organizations; tenant admins manage approved Word/Excel/text/PDF/URL knowledge and individual agent names, tone, languages and styles. Angular admins monitor service health through Node APIs; website visitors use a Next.js tenant-scoped, source-grounded chat. The first client channel is a web chat; the architecture allows additional sales channels via validated channel adapters.

**Status: local MVP vertical slice in progress.** The repository now contains the Next.js customer chat, Angular admin surface, Node/Express API, typed contracts, deterministic source-grounded retrieval, encrypted session PII vault, PostgreSQL/pgvector schema/adapter, Python ingestion tool, and guarded mock/private workflow adapters. Production identity, live Azure calls and live private n8n calls remain explicitly blocked until their contracts and credentials are approved.

## Target stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Customer UI | Next.js / React / TypeScript / Tailwind | Web chat channel |
| Admin UI | Angular / TypeScript / Tailwind | Manage sources and operations |
| Trusted API | Node.js / Express / TypeScript | Conversation, privacy boundary, retrieval and action policies |
| Relational store | PostgreSQL | Tenants, configuration, sessions, audit, masked customer records |
| Knowledge store | PostgreSQL + pgvector | Source chunks and vector search |
| Ingestion | Python, project venv | Extract, sanitize, chunk, embed and index files |
| Generation | Azure AI Foundry, GPT-4.1-mini | Model-driven conversational generation and intent proposals |
| Automation | n8n | Authorized workflows called by backend |

**Important:** GPT-4.1-mini is not an embedding model. A **separate embedding deployment/model** must be selected and matched to pgvector dimensions before ingestion is built.

## Core behavior

1. Channel sends an authenticated or anonymous-scoped message to Node.
2. Node validates and masks sensitive content; stores mappings in its protected data boundary.
3. Node retrieves authorized knowledge from pgvector and constructs evidence with stable citations.
4. Azure AI Foundry generates a grounded answer and optional structured intent proposal against *masked* context.
5. Node validates sources, proposed intent, consent and authorization. Only Node may invoke allowlisted n8n workflows.
6. Node rehydrates approved placeholders for the correct recipient, persists redacted history and returns the response.

Unanswered/unsupported business questions are answered with a transparent knowledge gap—not a guess.

## Build specifications
- [Complete multi-tenant feature brief](docs/15-complete-feature-brief.md)
- [Autonomous Codex execution plan](docs/16-autonomous-codex-execution-plan.md)
- [Acceptance test matrix](docs/17-acceptance-test-matrix.md)
- [Codex master prompt](docs/18-codex-master-prompt.md)

**Critical:** tenant A data must never leak to tenant B. Public chat uses only knowledge explicitly classified and approved for external display; internal tenant documents remain inaccessible to visitors. Approved Azure AI processing is a separate external processor boundary, subject to minimization and policy.

## Start here
- [Agent instructions](AGENTS.md)
- [Documentation index](docs/README.md)
- [Architecture](docs/02-system-architecture.md)
- [Security and privacy](docs/06-security-and-privacy.md)
- [Delivery sequence](docs/12-delivery-roadmap.md)

## Existing Docker Compose
The root `docker-compose.yml` runs **n8n only**, uses a digest-pinned image, and binds TCP 5678 to localhost by default over development HTTP. It is an **existing development bootstrap, not a production-ready platform**. See [security hardening](docs/06-security-and-privacy.md) before any controlled staging exposure.

## Local development

Install Node 22+ and Docker Desktop, then run:

```powershell
npm install
npm run db:up
npm run typecheck
npm test
npm run build
```

The API defaults to a deterministic in-memory store for repeatable development/tests:

```powershell
npm run dev:api
npm run dev:web
npm run dev:admin
```

With the API running, `npm run seed:local` creates synthetic tenant A/B data and asserts the local grounded-chat, refusal, isolation and mock-workflow journey.

`npm run acceptance:local` starts a disposable local API and runs the clean-room ingestion journey: real TXT, DOCX, XLSX and text-PDF uploads through Node staging and the Python worker, a deterministic approved HTTPS snapshot, publication of all five sources and a grounded public-chat query. It uses no browser automation or external network calls.

For the PostgreSQL/pgvector adapter, run `npm run db:migrate`, set `STORE=postgres` and `DATABASE_URL` from `.env.example`, then start the API. The API loads an ignored local `.env` when present; keep real credentials there, never in Git. The Python worker is under `tools/ingestion`; it supports TXT, Markdown, CSV, DOCX, XLSX, text PDF and bounded allowlisted HTTPS snapshots, and must run in a project venv. No real customer data or credentials belong in the repository.

The root `docker-compose.yml` is the n8n-only local development deployment with localhost-only defaults. `infra/docker-compose.dev.yml` is the private local PostgreSQL/pgvector service; neither compose file is a production deployment.

## Current verification and limitations

The verified local command is `npm run verify:local` (after PostgreSQL and the Python venv are prepared); it runs lint, typecheck, the compose security-default check, the PostgreSQL-backed workspace suite, builds, dependency audit and Python ingestion tests. GitHub Actions is intentionally not configured; verification is local-only. Azure GPT-4.1-mini chat has been smoke-tested with the supplied local credentials; the configured resource still lacks an embedding deployment, while production identity-provider and live n8n calls remain blockers. See [implementation progress](docs/implementation-progress.md).

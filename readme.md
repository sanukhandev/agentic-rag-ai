# Agentic RAG AI

A local **privacy-first, multi-tenant, RAG-grounded sales assistant vertical slice**. Platform admins onboard organizations; tenant admins manage approved Word/Excel/CSV/JSON/text/PDF/URL knowledge and individual agent names, tone, languages and styles. Angular admins monitor service health through Node APIs; website visitors use a Next.js tenant-scoped, source-grounded chat. The first client channel is a web chat; the architecture allows additional sales channels via validated channel adapters.

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
The root `docker-compose.yml` runs the full Docker stack behind one Docker Nginx listener on port `3000`; PostgreSQL, Redis, n8n, API, web and admin stay on the private Compose network, and local `data/` mounts persist state across rebuilds. It is still **not a production-ready platform** without TLS, identity, n8n hardening and operational controls. See [security hardening](docs/06-security-and-privacy.md) before controlled exposure.

## Local development

Install Node 22+ and Docker Desktop, then run:

```powershell
npm install
docker compose up -d --build
docker compose ps
```

The root Compose file is the canonical launch path. It builds the API, Next web, Angular admin, event workers and ingestion images through named multi-stage targets, then starts them with PostgreSQL/pgvector, Redis, n8n and the reverse proxy. Use `npm run typecheck`, `npm test` and `npm run build` for source-level checks.

The API defaults to a deterministic in-memory store for repeatable development/tests:

```powershell
npm run dev:api
npm run dev:web
npm run dev:admin
```

`npm run acceptance:seed` starts a disposable local API, creates synthetic tenant A/B data and asserts the local grounded-chat, refusal, isolation and idempotent mock-workflow journey. With an API already running, `npm run seed:local` runs the same checks against `SEED_API_URL` (default `http://127.0.0.1:4000`).

`npm run acceptance:local` starts a disposable local API and runs the clean-room ingestion journey: real TXT, DOCX, XLSX and text-PDF uploads through Node staging and the Python worker, a deterministic approved HTTPS snapshot, publication of all five sources and a grounded public-chat query. It uses no browser automation or external network calls.

For the PostgreSQL/pgvector adapter, run `npm run db:migrate`, set `STORE=postgres` and `DATABASE_URL` from `.env.example`, then start the API. The API loads an ignored local `.env` when present; keep real credentials there, never in Git. The Python worker is under `tools/ingestion`; it supports TXT, Markdown, CSV, JSON, DOCX, XLSX, text PDF, bounded ZIP bundles containing those formats, and allowlisted HTTPS snapshots, and must run in a project venv. ZIP bundles are extracted with path, size, duplicate-name, nested-archive, macro and unsupported-file checks before sanitization, chunking and embedding. No real customer data or credentials belong in the repository.

The root `docker-compose.yml` is the single deployment shape for PostgreSQL/pgvector, Redis, n8n, API, web, admin and Docker Nginx, with the reverse proxy routing everything through port `3000`. Only Docker Nginx publishes a host port; `.env` remains untracked and holds VM-specific connection settings. It is not a production deployment without the security controls documented above.

## Current verification and limitations

The verified local command is `npm run verify:local` (after PostgreSQL and the Python venv are prepared); it runs lint, typecheck, compose security-default and high-confidence repository secret checks, the PostgreSQL-backed workspace suite, builds, dependency audit, the clean-room acceptance journey and Python ingestion tests. GitHub Actions is intentionally not configured; verification is local-only. Azure GPT-4.1-mini chat has been smoke-tested with the supplied local credentials; the configured resource still lacks an embedding deployment, while production identity-provider and live n8n calls remain blockers. See [implementation progress](docs/implementation-progress.md).

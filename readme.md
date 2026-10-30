# Agentic RAG AI

A local **privacy-first, multi-tenant, RAG-grounded sales assistant vertical slice**. Platform admins onboard organizations; tenant admins manage approved Word/Excel/CSV/JSON/text/PDF/URL knowledge and individual agent names, tone, languages and styles. Angular admins monitor service health through Node APIs; website visitors use a Next.js tenant-scoped, source-grounded chat. The first client channel is a web chat; the architecture allows additional sales channels via validated channel adapters.

**Status: local Foundry conversation and application-managed read-only function calling verified; seven-stage provider integration not yet accepted.** The repository includes Next.js chat, Angular Admin, Node/Express, tenant/catalog/journey controls, encrypted PII vault, PostgreSQL/pgvector, Python ingestion and guarded outbox/Redis/n8n workflows. The named Foundry agent `agentic-rag-core-dev` responded successfully through the Azure CLI-authenticated local API: **v4** remains pinned for stable serving, while **v6** is an explicit isolated function-calling candidate. The last documented one-session ANCFZ journey stopped safely after local Lead action dispatch because the remote Salesforce Lead acknowledgment was not verified. Production exposure, billing and contract-signing integrations remain separate approval/verification gates.

## Target stack

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Customer UI | Next.js / React / TypeScript / Tailwind | Web chat channel |
| Admin UI | Angular / TypeScript / Tailwind | Manage sources and operations |
| Trusted API | Node.js / Express / TypeScript | Conversation, privacy boundary, retrieval and action policies |
| Relational store | PostgreSQL | Tenants, configuration, sessions, audit, masked customer records |
| Knowledge store | PostgreSQL + pgvector | Source chunks and vector search |
| Ingestion | Python, project venv | Extract, sanitize, chunk, embed and index files |
| Generation | Microsoft Foundry named agent, GPT-4.1-mini | Conversational wording and approved application-function requests |
| Automation | n8n | Authorized workflows called by backend |

**Important:** GPT-4.1-mini is not an embedding model. A **separate embedding deployment/model** must be selected and matched to pgvector dimensions before ingestion is built.

## Core behavior

1. Channel sends an authenticated or anonymous-scoped message to Node.
2. Node validates and masks sensitive content; stores mappings in its protected data boundary.
3. Node retrieves authorized knowledge from pgvector and constructs evidence with stable citations.
4. The named Foundry agent generates a response from *masked* authorized context and may request an approved read-only application function.
5. Node validates evidence, catalog intent, consent and authorization. Authorized business actions are persisted to PostgreSQL outbox, then dispatched by Redis Streams/event worker to allowlisted n8n workflows; Foundry does not directly write to providers.
6. Node rehydrates approved placeholders for the correct recipient, persists redacted history and returns the response.

Unanswered/unsupported business questions are answered with a transparent knowledge gap—not a guess.

## Build specifications
- [Current requirements](docs/current-requirements.md)
- [Active acceptance contract](docs/acceptance.md)
- [Foundry local development](docs/foundry-local-development.md)
- [ANCFZ stage verification matrix](docs/verification/ancfz-stage-verification-matrix.md)

**Critical:** tenant A data must never leak to tenant B. Public chat uses only knowledge explicitly classified and approved for external display; internal tenant documents remain inaccessible to visitors. Approved Azure AI processing is a separate external processor boundary, subject to minimization and policy.

## Start here
- [Agent instructions](AGENTS.md)
- [Documentation index](docs/README.md)
- [Current requirements](docs/current-requirements.md)
- [Architecture](docs/02-system-architecture.md)
- [Security and privacy](docs/06-security-and-privacy.md)
- [Acceptance contract](docs/acceptance.md)

## Existing Docker Compose
The shared `docker-compose.yml` defines the full stack. Use `docker-compose.local-dev.yml` for Windows/Docker Desktop development with Foundry Azure CLI authentication, or `docker-compose.vm-dev.yml` for the VM development deployment. PostgreSQL, Redis, n8n, API, web and admin remain private behind Docker Nginx; local `data/` mounts persist state across rebuilds. This is still **not a production-ready platform** without TLS, identity, n8n hardening and operational controls. See [security hardening](docs/06-security-and-privacy.md) before controlled exposure.

## Local development

Install Node 22+ and Docker Desktop, then run:

```powershell
npm install
docker compose -f docker-compose.yml -f docker-compose.local-dev.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.local-dev.yml ps
```

The shared Compose file builds the API, Next web, Angular admin, event workers and ingestion images through named multi-stage targets. The local-dev overlay adds the Foundry API image, isolated Azure CLI volume and loopback-only PostgreSQL/Redis ports, then starts PostgreSQL/pgvector, Redis, n8n and the reverse proxy. Use `npm run typecheck`, `npm test` and `npm run build` for source-level checks.

The ANCFZ-only PDF and mock-payment adapters are opt-in local profiles. Set random development-only `ANCFZ_PDF_API_KEY` (24+ characters) and `MOCK_PAYMENT_API_KEY` (20+ characters) in the ignored `.env`, then start them with:

```powershell
docker compose --env-file .env -f docker-compose.yml -f docker-compose.local-dev.yml --profile ancfz up -d --build
```

They remain private Compose services and never represent real payment settlement or legally binding documents.

The API defaults to a deterministic in-memory store for repeatable development/tests:

```powershell
npm run dev:api
npm run dev:web
npm run dev:admin
```

`npm run acceptance:seed` starts a disposable local API, creates synthetic tenant A/B data and asserts the local grounded-chat, refusal, isolation and idempotent mock-workflow journey. With an API already running, `npm run seed:local` runs the same checks against `SEED_API_URL` (default `http://127.0.0.1:4000`).

`npm run acceptance:local` starts a disposable local API and runs the clean-room ingestion journey: real TXT, DOCX, XLSX and text-PDF uploads through Node staging and the Python worker, a deterministic approved HTTPS snapshot, publication of all five sources and a grounded public-chat query. It uses no browser automation or external network calls.

For the PostgreSQL/pgvector adapter, run `npm run db:migrate`, set `STORE=postgres` and `DATABASE_URL` from `.env.example`, then start the API. The API loads an ignored local `.env` when present; keep real credentials there, never in Git. The Python worker is under `tools/ingestion`; it supports TXT, Markdown, CSV, JSON, DOCX, XLSX, text PDF, bounded ZIP bundles containing those formats, and allowlisted HTTPS snapshots, and must run in a project venv. ZIP bundles are extracted with path, size, duplicate-name, nested-archive, macro and unsupported-file checks before sanitization, chunking and embedding. No real customer data or credentials belong in the repository.

The VM deployment uses `docker-compose.yml` plus `docker-compose.vm-dev.yml` for PostgreSQL/pgvector, Redis, n8n, API, web, admin and Docker Nginx. The reverse proxy publishes port `3000` by default; set `APP_BIND_ADDRESS` and `APP_HOST_PORT` in the ignored VM `.env` when the VM firewall and ingress policy permit a different binding. Only Docker Nginx publishes a VM host port. It is not a production deployment without the security controls documented above.

## Current verification and limitations

For repeatable local verification, use `npm run verify:local` when its PostgreSQL and Python prerequisites are available; run `npm run qa:ancfz-single-journey` for the **single continuous seven-stage ANCFZ journey** (no 25-turn or 200-message benchmark). Live Foundry v6 tool calls and local API continuity were verified in previous evidence, not revalidated by this README change. The current journey remains blocked at external Salesforce Lead verification; consult [the acceptance contract](docs/acceptance.md) and [the dated run evidence](docs/verification/ancfz-single-journey-tool-calling.md).

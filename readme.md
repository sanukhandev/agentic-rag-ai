# Agentic RAG AI

A planned **privacy-first, multi-tenant, RAG-grounded sales assistant platform**. Platform admins onboard organizations; tenant admins manage approved Word/Excel/text/PDF/URL knowledge and individual agent names, tone, languages and styles. Angular admins monitor service health through Node APIs; website visitors use a Next.js tenant-scoped, source-grounded chat. The first client channel is a web chat; the architecture allows additional sales channels via validated channel adapters.

**Status: documentation / architecture baseline.** The repository currently has an n8n-only Docker Compose configuration. The Next.js web app, Angular admin app, Node/Express API, Python ingestion tooling, PostgreSQL schema, pgvector retrieval, AI Foundry integration, and cross-channel orchestration are **planned, not yet implemented**.

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
The root docker-compose.yml currently runs **n8n only** and binds TCP 5678 on all interfaces over HTTP. It is an **existing development bootstrap, not a production-ready platform**. See [security hardening](docs/06-security-and-privacy.md) before exposing it.

## Development principle
Implementation begins only from an approved feature scope; these documents describe intended contracts and guardrails, not deployed features.

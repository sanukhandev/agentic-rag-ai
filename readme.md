# Agentic RAG AI — ANCFZ single-journey upgrade

**Current migration goal:** reliable, grounded conversational intent recognition and one continuous seven-stage ANCFZ business journey. The architecture is **tenant-configurable**; ANCFZ is the current acceptance tenant, not a hardcoded implementation.

**Proposed runtime:** Next.js Chat → Node API (tenant/session + catalog/intent/journey/authorization) → private Python GPT model gateway (Azure OpenAI Responses API via API key) → Node RAG/response validation → approved catalog tool actions → PostgreSQL outbox → Redis Streams → n8n → Salesforce/OCR/invoice/contract provider callbacks.

**Current implementation differs:** the repository still uses a Node `@azure/ai-projects` named Foundry Agent client with Azure CLI. The Python GPT service, User Intent Document and new intent confirmation/scoring workflow are **not implemented**. Do not mistake this documentation update for code migration or a successfully verified seven-stage provider journey.

## Start here

1. [Engineering agent instructions](AGENTS.md)
2. [Documentation index](docs/README.md)
3. [Current code status and gaps](docs/current-state.md)
4. [Current product requirements](docs/requirements.md)
5. [Target architecture](docs/architecture.md)
6. [Migration stages](docs/migration-plan.md)
7. [Single-journey acceptance](docs/acceptance.md)

## Existing stack (retain)

- Next.js/React customer chat; Angular Admin.
- Node/Express/TypeScript API and typed contracts.
- PostgreSQL/pgvector for tenant, session, catalog, journeys, sources, audits and workflow state.
- Python ingestion/OCR and separate PDF/mock-payment development adapters.
- Redis Streams, PostgreSQL transactional outbox and private n8n provider execution.
- Published versioned Excel intent catalog and deterministic follow-up engine.
- Existing privacy, authorization, consent and provider-callback safeguards.

The target Python model gateway is an **additional isolated service**, not a replacement for Node authorization or the ingestion worker.

## Current local development

Existing Docker Desktop files: `docker-compose.yml`, `docker-compose.local-dev.yml`, plus VM overlay `docker-compose.vm-dev.yml`. Existing API and Foundry v4 stable runtime can be checked using repository scripts. Do not change the `CHAT_MODEL_PROVIDER` value to the proposed `python-gpt` until the adapter and private service are implemented.

Use `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run verify:compose` as applicable. Existing `npm run qa:ancfz-single-journey` tests the **old Foundry runtime** until migrated; it is not evidence for the new Python gateway. The seven-stage acceptance is currently blocked on independently verified Salesforce Lead completion.

For Azure GPT-model API-key setup and the required initial+3 transient retry policy, see [Python model gateway](docs/model-gateway.md). Keep the key in the private Python environment, never Git, Docker layers or browser.

## Acceptance

One synthetic customer, one authorized session/opportunity, confirmed single intent, a durable per-turn User Intent Document/cache, grounded answers with exactly one relevant follow-up during the active journey, seven ordered catalog stages, and verified external action/callback evidence. No mandatory 25-turn or 200-message benchmark.

**Do not claim completed CRM, payment, document transfer or signing based solely on model text, local records, n8n execution, mock responses or generated PDFs.**

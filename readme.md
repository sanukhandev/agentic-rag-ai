# Agentic RAG AI — ANCFZ single-journey upgrade

**Current migration goal:** a **GPT-led, intent-focused customer conversation** driven by the customer's actual **Business Goal** (not automatic CRM Lead capture), with answers grounded in RAG, intelligent follow-up questions, and one continuous seven-stage ANCFZ company-formation journey when that goal is confirmed. The architecture is **tenant-configurable**; ANCFZ is the current acceptance tenant, not a hardcoded implementation.

**Proposed runtime:** Next.js Chat → Node API (tenant/session + catalog/intent/journey/authorization) → private Python GPT model gateway (Azure OpenAI Responses API via API key) → Node RAG/response validation → approved catalog tool actions → PostgreSQL outbox → Redis Streams → n8n → Salesforce/OCR/invoice/contract provider callbacks.

**Current rewrite branch:** Python GPT gateway and Node adapter are added, and the Foundry Agent runtime is retired on this branch. **The existing monolithic Node `app.ts` still has legacy lead-first conversation logic**; the new User Intent Document, dynamic Node tool loop and goal-first coordinator are **not implemented**. Do not claim the seven-stage path is verified. Do not mistake this documentation update for code migration or a successfully verified seven-stage provider journey.

## Start here

1. [Engineering agent instructions](AGENTS.md)
2. [Documentation index](docs/README.md)
3. [Current code status and gaps](docs/current-state.md)
4. [Current product requirements](docs/requirements.md)
5. [Intent taxonomy](docs/intent-taxonomy.md)
6. [GPT conversation planner](docs/conversation-planner.md)
7. [Target architecture](docs/architecture.md)
8. [Migration stages](docs/migration-plan.md)
9. [Single-journey acceptance](docs/acceptance.md)

## Existing stack (retain)

- Next.js/React customer chat; Angular Admin.
- Node/Express/TypeScript API and typed contracts.
- PostgreSQL/pgvector for tenant, session, catalog, journeys, sources, audits and workflow state.
- Python ingestion/OCR and separate PDF/mock-payment development adapters.
- Redis Streams, PostgreSQL transactional outbox and private n8n provider execution.
- Published versioned Excel intent catalog and existing deterministic follow-up engine. **Target upgrade:** LLM-led goal/context weighting and next-question selection, persisted User Intent Document, per-turn cache. CRM Lead creation becomes only a conditional action when appropriate.
- Existing privacy, authorization, consent and provider-callback safeguards.

The target Python model gateway is an **additional isolated service**, not a replacement for Node authorization or the ingestion worker.

## Current local development

Existing Docker Desktop files: `docker-compose.yml`, `docker-compose.local-dev.yml`, plus VM overlay `docker-compose.vm-dev.yml`. Add `docker-compose.python-gpt.yml` **as an opt-in third overlay** for the private GPT gateway; do not expose the Python service publicly. The `python-gpt` provider is wired at bootstrap, but live use still requires Azure model credentials, running gateway and validation of the legacy conversation flow. It is not a seven-stage acceptance release.

Use `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build` and `npm run verify:compose` as applicable. Existing `npm run qa:ancfz-single-journey` tests the **old Foundry runtime** until migrated; it is not evidence for the new Python gateway. The seven-stage acceptance is currently blocked on independently verified Salesforce Lead completion.

For Azure GPT-model API-key setup and the required initial+3 transient retry policy, see [Python model gateway](docs/model-gateway.md). Keep the key in the private Python environment, never Git, Docker layers or browser.

## Acceptance

One synthetic customer, one authorized session/opportunity, confirmed single intent, a durable per-turn User Intent Document/cache, grounded answers with exactly one relevant follow-up during the active journey, seven ordered catalog stages, and verified external action/callback evidence. No mandatory 25-turn or 200-message benchmark.

**Do not claim completed CRM, payment, document transfer or signing based solely on model text, local records, n8n execution, mock responses or generated PDFs.**

# Agentic RAG AI — ANCFZ single-journey upgrade

**Current migration goal:** a **GPT-led, intent-focused customer conversation** driven by the customer's actual **Business Goal** (not automatic CRM Lead capture), with answers grounded in RAG, intelligent follow-up questions, and one continuous seven-stage ANCFZ company-formation journey when that goal is confirmed. The architecture is **tenant-configurable**; ANCFZ is the current acceptance tenant, not a hardcoded implementation.

**Proposed runtime:** Next.js Chat → Node API (tenant/session/**published persona** + catalog) → Python **Conversation Agent Runtime** (GPT strategy and pre-response trusted Node read tools) → **Persona Response Composer** → **Node Response Guard** → customer. Authorized catalog actions are separately dispatched through PostgreSQL outbox → Redis Streams → n8n → verified provider callbacks. ANCFZ's Zara is tenant-configured, never hardcoded.

**Current rewrite branch:** Python GPT gateway and Node adapter are added, and the Foundry Agent runtime is retired on this branch. **The existing monolithic Node `app.ts` still has legacy lead-first conversation logic**; the new User Intent Document, dynamic Node tool loop and goal-first coordinator are **not implemented**. Do not claim the seven-stage path is verified. Do not mistake this documentation update for code migration or a successfully verified seven-stage provider journey.

## Start here

1. [Engineering agent instructions](AGENTS.md)
2. [Documentation index](docs/README.md)
3. [Current code status and gaps](docs/current-state.md)
4. [Current product requirements](docs/requirements.md)
5. [Intent taxonomy](docs/intent-taxonomy.md)
6. [GPT conversation planner](docs/conversation-planner.md)
7. [Mandatory tenant persona response contract](docs/persona-response-contract.md)
8. [Python↔Node agent tool loop](docs/agent-tool-loop.md)
9. [Target architecture](docs/architecture.md)
10. [Migration stages](docs/migration-plan.md)
11. [Single-journey acceptance](docs/acceptance.md)

## Canonical Conversation Engine v2 implementation plan

**Design complete as a planning blueprint, not implemented runtime.** The target uses **one Python Conversation Agent** with Planning & Intent and Natural Persona Composer; Node provides Response Guard, Session & Conversation Manager and Trusted Tool Gateway; the seventh logical component is Node/PostgreSQL/Redis/n8n Workflow & Event Engine. This system helps one named published tenant persona naturally guide knowledge-only visitors or confirmed ANCFZ company-formation customers through seven strictly ordered stages without inventing status or forcing CRM Leads.

Read these **in order before coding**: [seven-component architecture](docs/conversation-engine-architecture.md), [typed engine contracts](docs/conversation-engine-contracts.md), [P0–P7 delivery roadmap](docs/conversation-engine-delivery-plan.md), [evaluation/acceptance scenarios](docs/conversation-engine-evaluation.md). The previous [migration plan](docs/migration-plan.md) is background where its sequencing differs.

**Implementation rule:** Freeze contracts and executable catalog v2 before expanding the Python scaffold. Do not delete working Node action/session safeguards, migrations or data until the replacement passes full compatibility and rollback tests.

## Existing stack (retain)

- Next.js/React customer chat; Angular Admin.
- Node/Express/TypeScript API and typed contracts.
- PostgreSQL/pgvector for tenant, session, catalog, journeys, sources, audits and workflow state.
- Python ingestion/OCR and separate PDF/mock-payment development adapters.
- Redis Streams, PostgreSQL transactional outbox and private n8n provider execution.
- Published versioned Excel intent catalog and existing deterministic follow-up engine. **Target upgrade:** LLM-led goal/context weighting and next-question selection, persisted User Intent Document, per-turn cache. CRM Lead creation becomes only a conditional action when appropriate.
- Existing privacy, authorization, consent and provider-callback safeguards.

The target Python model gateway is an **additional isolated service**, not a replacement for Node authorization or the ingestion worker.

## Local Docker / deployment topology

`docker-compose.yml` is the **only** Compose file needed. The default stack includes
PostgreSQL/pgvector, Redis, n8n, Node API, event workers, ingestion, Next.js,
Angular Admin, the private Python GPT/LangGraph gateway, and Nginx.

**Only Nginx publishes a host port:** `127.0.0.1:80` by default. Public routes:
`/` (chat), `/admin/`, `/api/`, `/n8n/`. Services use Docker DNS internally;
PostgreSQL, Redis and the model gateway have no host-published ports. For an
explicit non-local bind set `APP_BIND_ADDRESS=0.0.0.0`; public deployment must
use HTTPS/TLS and appropriate access controls outside this HTTP-only stack.

Use `docker compose config --quiet` then `docker compose up -d --build --remove-orphans --wait`.
For optional **non-production** PDF/payment simulators, add `--profile ancfz`.
Copy `.env.example` to `.env` and provide strong local credentials and valid Azure
configuration. The model gateway fails readiness when Azure configuration is
missing (unless intentionally using its test-only mock mode).

**Preserve local volumes:** existing `./data/postgres`, `./data/redis`,
`./data/n8n`, `./data/ingestion-staging`, and `./data/supporting-documents`
are unchanged. Do not use `docker compose down -v` or remove `./data`.
PostgreSQL init SQL only runs on an empty volume; apply outstanding migrations
to an existing database through `npm run db:migrate:vm` (see
`docs/vm-deployment.md`). Set `DB_MIGRATION_BASELINE` in the VM `.env` on the
first run when the existing schema predates the latest migration; do not guess
the baseline. Catalog content changes must use the authenticated catalog
validate/draft/publish flow, not direct SQL updates.

For Azure GPT model setup see [model gateway](docs/model-gateway.md).
Passing container health checks is not seven-stage provider or Azure dialogue
quality acceptance. Production V2 consent capture and trusted provider transition
wiring still require integration verification.

## Acceptance

One synthetic customer, one authorized session/opportunity, confirmed business goal, durable User Intent Document/cache and **session-pinned published assistant persona**. Python may call trusted Node tools **before** final generation; **every customer-visible message** passes the persona composer and Node guard (or approved persona fallback and guard), uses evidence-grounded facts and one purposeful follow-up when applicable, across seven business stages and verified callbacks. No mandatory 25-turn or 200-message benchmark.

**Do not claim completed CRM, payment, document transfer or signing based solely on model text, local records, n8n execution, mock responses or generated PDFs.**

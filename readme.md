# Agentic RAG AI

Agent-centric, persona-driven support and business automation: one **Agent** owns its private knowledge, intent and offerings catalogs, allowlisted tools, customer accounts, tickets and configurable n8n workflows. No Tenant domain in the target architecture. ANCFZ is an example Agent, not a hardcoded process.

> **Target architecture only.** The current branch still contains tenant-scoped SQL, pgvector, a Python LangGraph loop, WebSockets and legacy CRM-centered features. Updated docs do **not** indicate that these have been replaced.

## Intended single execution path
```text
Customer (Next.js chat / ticket header / secure OTP / uploads)
  -> Node API (agent resolution, authentication, durable ticket event, SSE)
  -> Python FastAPI Gateway -> versioned Microsoft Foundry Agent
  -> function request -> Python mediator -> Node-authorized tool
       -> Foundry IQ (approved agent RAG), intents, offerings, ticket facts/status
  -> Foundry reply -> Node evidence/fact validation -> PostgreSQL
  -> SSE event replay / browser response

Customer-approved operation
  -> Node preflight, consent + authorization
  -> transactional PostgreSQL action/outbox
  -> worker -> n8n -> external provider
  -> verified callback/reconciliation -> ticket event + SSE
```

### Data ownership
PostgreSQL: authoritative agents, configurations, accounts, messages, tickets, facts, operations, summaries and audit. Redis: cache, coordination, OTP challenge and event distribution only. Foundry IQ/Azure AI Search: separate, indexed approved knowledge for each Agent. Customer-uploaded documents are private ticket assets processed through OCR/Document Intelligence.

### Design rules
- Foundry selects natural responses, relevant tools, next questions and **proposes** actions; Node authorizes reads and every consequential action.
- Keep Python FastAPI; remove LangGraph after replacement with Foundry Agent Service and verified parity. Remove local pgvector search once Foundry knowledge retrieval works and a plain PostgreSQL baseline passes.
- Disable web browsing and arbitrary network tools. Only gateway-mediated, agent-allowlisted application functions are available.
- `get_intent_requirements` is generic; intent goals and product/service offerings are agent-managed versioned catalogs.
- Ticket-first customer journey: greeting → intent/knowledge → optional verified account/OTP → optional document extraction → consented n8n lead/quote → explicit ticket closure.
- Durable intake before asynchronous transcript/summary processing. Redis/SSE are not an authoritative business ledger.
- Preserve privacy and independently verify citations, prices, consent and provider outcomes.

## Documentation
[Engineering instructions](AGENTS.md) · [Canonical index](docs/README.md) · [Product](docs/01-product-requirements.md) · [System](docs/02-system-architecture.md) · [Gateway](docs/03-conversation-engine.md) · [Agent memory](docs/04-tenant-persona-memory.md) · [Knowledge](docs/05-rag-knowledge.md) · [Intents/actions](docs/06-intents-actions-workflows.md) · [Security](docs/07-security-and-validation.md) · [Acceptance](docs/08-testing-and-acceptance.md) · [Rebuild plan](docs/09-migration-plan.md).

Current Docker/runtime instructions remain in [local Compose](docs/local-docker-compose.md); current database inventory is in [database review](docs/database-bcnf-review.md). They describe the **existing** system until rewritten.

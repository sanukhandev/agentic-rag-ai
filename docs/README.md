# Canonical agent-centric architecture index

**Status: target design, not implemented runtime.** This is the single requirements index. Current source, database and exact-head tests remain authoritative for implemented behavior. Agent ownership replaces Tenant **only in the new target domain**; existing tenant-scoped records and pgvector remain until the planned clean POC rebuild.

| Document | Authority |
| --- | --- |
| [01 — Product requirements](01-product-requirements.md) | Agent, customer, ticket and administrative experience |
| [02 — System architecture](02-system-architecture.md) | Runtime components, boundaries and events |
| [03 — Foundry agent and gateway](03-conversation-engine.md) | Managed agent, function mediation and response contracts |
| [04 — Agent persona and memory](04-tenant-persona-memory.md) | Identity, context, Redis, PostgreSQL, ticket lifecycle |
| [05 — Knowledge](05-rag-knowledge.md) | Foundry IQ retrieval, approval, citations, OCR document boundary |
| [06 — Intents, offerings, actions](06-intents-actions-workflows.md) | Generic requirements and n8n-authorized business execution |
| [07 — Security](07-security-and-validation.md) | Agent isolation, OTP, PII, consent and guard policies |
| [08 — Acceptance](08-testing-and-acceptance.md) | Contract, security, provider and E2E evaluation |
| [09 — Clean POC rebuild plan](09-migration-plan.md) | Audit inventory, deletion rules, database/Compose and workstreams |
| [Database review](database-bcnf-review.md) | Existing tenant-indexed schema and migration notes |
| [Current Compose runbook](local-docker-compose.md) | Existing Docker deployment only |

See [AGENTS.md](../AGENTS.md) for mandatory engineering rules and [readme.md](../readme.md) for the application overview.

## Terminology
- **Agent:** application-wide isolation owner (`agent_id`), with configured Foundry agent/version, persona, private knowledge, tools, catalogs and workflows.
- **Ticket:** durable customer conversation, subject/intent, structured facts, private documents, transcript, action history, derived summary and explicit closure.
- **Intent:** model-inferred published business goal, not authorization.
- **Requirement:** typed conditional information/approval/document/prerequisite applied to intent or operation.
- **Offering:** versioned product, service, package, eligibility and price records.
- **Tool:** Python-mediated function call authorized and executed by Node or its approved retrieval adapter.
- **Action:** consequence-bearing command authorized by Node and executed asynchronously through worker/n8n.
- **SSE:** one-way event notification; PostgreSQL event log is authoritative, Redis accelerates delivery.

## Design boundaries
No customer-facing web/Bing tool. Foundry IQ via **one** Node-scoped `search_knowledge` path; no unmediated alternate search route. PostgreSQL retains business truth and all action outcomes. Read-only source retrieval and AI summaries are not CRM success or consent. Docs never authorize a destructive database reset or dropping historical customer data without explicit POC data disposal/backup.

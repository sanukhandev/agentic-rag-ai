# Agentic RAG AI

A generic, multitenant conversational AI platform that combines natural dialogue, approved RAG knowledge, tenant-specific personas, intent discovery and safely authorized business workflows.

**Status:** This README and docs/ describe the approved target architecture. They do not imply the existing runtime has been migrated or fully validated. The repository contains an existing Node API, Python model gateway, PostgreSQL/pgvector, Redis and n8n implementation that must be audited against the new requirements.

## Design principles
- A single model-led conversation: the assistant decides what to say, which authorized read tools to call and which business intent to explore.
- A strong application authority boundary: Node owns identity, permissions, persisted state, action approval and outcomes.
- Tenant configuration, not tenant-specific code: versioned personas, knowledge, business goals, requirements and workflow graphs.
- Evidence-backed business facts; normal conversational exchanges can be natural and uncited.
- No forced contact collection or automatic CRM lead creation in knowledge-only dialogue.
- Side effects require policy checks, explicit action authorization where appropriate, consent, idempotency and independently verified outcomes.
- Durable conversation context supports authenticated resumption. PII remains encrypted and access controlled.
- Existing RAG data, operational infrastructure and customer records remain protected during any redesign.

## Architecture at a glance

~~~text
Customer / Next.js
    -> Node / Express API: tenant, identity, session, policy
    -> Python / FastAPI LangGraph: GPT dialogue + authorized read tools
    -> Node: evidence and security checks + durable fact/response commit
    -> Customer response

Approved external action
    -> Node action gate -> PostgreSQL outbox -> Redis Streams
    -> n8n / external provider -> authenticated evidence reconciliation
    -> PostgreSQL authoritative status
~~~

**Primary LLM:** Azure GPT-5.4. **Optional provider:** OpenAI via the model adapter. Provider selection is deployment configuration; the model never acquires authority to execute writes.

## Documentation
1. [Engineering rules](AGENTS.md)
2. [Documentation index](docs/README.md)
3. [Product requirements](docs/01-product-requirements.md)
4. [System architecture](docs/02-system-architecture.md)
5. [Model gateway and conversation engine](docs/03-conversation-engine.md)
6. [Tenant persona and memory](docs/04-tenant-persona-memory.md)
7. [Protected RAG knowledge](docs/05-rag-knowledge.md)
8. [Intents, actions and workflows](docs/06-intents-actions-workflows.md)
9. [Security and validation](docs/07-security-and-validation.md)
10. [Quality and acceptance](docs/08-testing-and-acceptance.md)
11. [Migration and rollout](docs/09-migration-plan.md)

## Development
For Windows and Docker Desktop local startup, PostgreSQL host access, and the
isolated P2 integration database, see [Local Docker Compose guide](docs/local-docker-compose.md).

Use the repository's existing Docker Compose and package scripts as the implementation source of truth. Inspect docker-compose.yml, .env.example and package.json for current commands and services. Do not interpret healthy containers as proof of good conversation quality or successful external workflows.

Never run destructive volume/database cleanup, overwrite published tenant data, or alter existing embeddings as part of the conversation-engine refactor.

**Reference tenant:** ANCFZ may provide a company-formation catalog with a seven-stage workflow. It is sample configuration, not the platform's built-in process.

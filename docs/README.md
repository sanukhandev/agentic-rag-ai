# Canonical documentation

This is the only active design index for Agentic RAG AI. Numbered documents define a single generic multitenant target architecture. They are **requirements and design**, not evidence that an existing implementation already conforms. Source code, deployment configuration, database state and test reports remain authoritative for current behavior.

| Document | Decision authority |
| --- | --- |
| [01 — Product requirements](01-product-requirements.md) | Product outcomes and customer experience |
| [02 — System architecture](02-system-architecture.md) | Components, ownership, trust boundaries and event paths |
| [03 — Conversation engine](03-conversation-engine.md) | Model adapter, bounded LangGraph loop, tool registry and responses |
| [04 — Tenant persona and memory](04-tenant-persona-memory.md) | Published persona, context projection and conversation resumption |
| [05 — RAG knowledge](05-rag-knowledge.md) | Tenant isolation, evidence provenance and safe answers |
| [06 — Intents and workflows](06-intents-actions-workflows.md) | Editable catalogs, actions, graph prerequisites and provider evidence |
| [07 — Security](07-security-and-validation.md) | Authentication, PII, consent, authorization and guards |
| [08 — Acceptance](08-testing-and-acceptance.md) | Test matrix, real-model quality and release gates |
| [09 — Migration plan](09-migration-plan.md) | Non-destructive implementation and rollout order |

[AGENTS.md](../AGENTS.md) contains engineering constraints; [readme.md](../readme.md) is the repository entry point.

## Terminology
- **Tenant:** isolated organization with its own users, persona, knowledge, catalogs and workflows.
- **Turn:** one customer input and the associated authorized model/tool/response lifecycle.
- **Business goal:** a tenant-defined customer outcome inferred semantically across turns.
- **Intent:** a provisional interpretation of what the customer currently seeks. Intent inference is not action authorization.
- **Read tool:** a narrowly scoped Node API capability available to the model.
- **Action:** an externally consequential, policy-gated operation, never a casual model tool call.
- **Verified evidence:** an authorized, provenance-bearing source or independently confirmed provider outcome.

## Precedence and status
Product decisions are fixed here; the implementation is not automatically compliant. Before any runtime change, perform a concrete code and database audit, create compatibility mappings, and run the acceptance gates. Do not reintroduce separate conflicting specifications or interpret names of old files as active product contracts.

## Data preservation
The documentation rebuild does not authorize deleting or changing runtime source, database schemas, SQL migrations, pgvector embeddings, published catalog rows, provider integrations, customer data or historical Git commits.

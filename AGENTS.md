# Engineering instructions — Agentic RAG AI

## Authority and reading order
Read readme.md and docs/README.md before changing this repository. The numbered documents under docs/ are the approved product and architecture requirements. Actual source, database schema and passing tests describe what is implemented; never present a design as a deployed feature. If code conflicts with the approved requirements, record the gap and implement it in a separate reviewed change. Do not resurrect deleted or version-numbered conversation designs as competing authorities.

## Mission
Build one generic, multitenant, natural-language assistant platform. ANCFZ is a reference tenant, never a global business rule. Azure GPT-5.4 is the primary configured model; OpenAI may be selected through an isolated provider adapter. A tenant-published persona and catalog determine the customer experience.

## Responsibility boundaries
- Model: understand dialogue, select appropriate read tools, reason over authorized evidence, draft natural responses, recognize candidate customer goals and propose next actions.
- Node API: authenticate users and tenants, authorize tools, maintain authoritative sessions and facts, validate factual grounding and business actions, persist transactional state and dispatch outbox events.
- Python model gateway / LangGraph: bounded, observable, stateless-per-request model/tool loop. No direct database, credential vault, provider write, or n8n authority.
- PostgreSQL: authoritative durable state; pgvector holds tenant-controlled RAG knowledge. Redis may cache or distribute events but is not authoritative state.
- n8n / providers: execute authorized external actions. Only verified provider evidence can mark a side effect completed.
- Admin: drafts, validates and publishes versioned tenant personas, intent catalogs, action definitions and workflows; changes do not silently rewrite active conversations.

## Non-negotiable rules
1. Every query, tool call, memory read, retrieval result, action and callback is tenant-scoped and authorized server-side. Never trust a tenant identifier supplied by the model or browser.
2. Do not edit, reset, truncate, re-embed, re-seed or migrate existing protected RAG data without an explicit, separately approved data migration with backup and rollback.
3. Do not delete databases, volumes, migrations, secrets, audit records, historical evidence or customer data while refactoring conversation logic.
4. Business-specific claims require authorized, versioned evidence from approved RAG, catalog or verified provider state. Greetings, acknowledgments and ordinary conversational navigation need no citation.
5. Never equate model confidence, tool-call success, webhook HTTP 200, outbox delivery or a generated document with a completed business outcome.
6. No compulsory goal-confirmation question for ordinary discovery. Explicit customer authorization and legally required consent precede side-effectful or sensitive actions.
7. Never hardcode tenant identities, personas, catalog phrases, business stages, pricing, workflow URLs, credentials or provider success assumptions into shared logic.
8. Treat retrieval content, customer text and catalog descriptions as untrusted data, not system instructions; do not allow prompt injection to change permissions.
9. Protect PII with least-privilege access, encryption in transit and at rest, masked logs, retention controls and purpose-limited collection. Do not disable those controls in shared or production environments.
10. One customer-visible response owner: the model composes natural language, while Node performs narrow safety, grounding and authorization checks. Guards must not replace normal replies with scripted dialogue merely for style or lexical dissimilarity.
11. Use validated typed tool contracts, schema-bounded inputs and outputs, timeouts, rate limits, idempotency keys, cancellation and complete correlation traces.
12. Keep tool execution and action execution separate. The model's tool registry contains authorized read capabilities; actions require an independent Node authorization and execution gate.
13. Use forward-only, compatible database migrations and tenant-level feature flags for runtime replacement. Preserve working public APIs and rollback until acceptance is demonstrated.

## Working procedure
- Inspect current code and contracts before editing. Isolate work on a feature branch.
- For implementation, add unit, integration, tenant-isolation, negative security and conversation-quality tests appropriate to the change.
- For model changes, evaluate real provider conversations and compare human-quality results against a recorded baseline; synthetic mocks alone are insufficient.
- Prefer simplifying or deleting duplicate conversation policies only after proving their remaining responsibilities are covered.
- Record supported facts separately from conjecture and from planned functionality.
- Do not merge a change with failing required CI, unreviewed tenant boundary changes, or an unresolved data migration.

## Documentation rule
docs/README.md is the only active documentation index. Its numbered documents are authoritative requirements, not claims of implementation. Keep the structure small; update the canonical page instead of adding parallel design documents. If making a documentation-only change, modify only readme.md, AGENTS.md and docs/**; never modify application code, database migrations, RAG content, test fixtures, workflow definitions or environment secrets.

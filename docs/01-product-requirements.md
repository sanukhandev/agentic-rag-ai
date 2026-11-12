# 01 — Product requirements

**Status: approved target design, not implementation certification.**

## Objective
Provide one natural conversational assistant per tenant that can answer authorized business questions, understand evolving customer goals, gather missing information when useful and, only when permitted, orchestrate business actions. It must feel like an informed assistant rather than a deterministic questionnaire.

ANCFZ is the first sample tenant. No shared engine behavior depends on that tenant, its assistant name, its company-formation vocabulary or its seven-stage process.

## Actors and surfaces
- **Anonymous visitor:** can ask approved public questions; receives a bounded anonymous session, not implicit permission to inspect private records.
- **Authenticated customer:** can manage or resume their own permitted conversations and approve actions.
- **Tenant administrator:** manages published persona, intent catalog, read-tool policy, workflow bindings and reporting for their tenant.
- **Platform administrator:** manages infrastructure and tenant provisioning with audited, least-privilege access.
- **Operator:** monitors failures, queues and provider reconciliation without receiving unnecessary PII.

## Customer behavior
1. Answer greetings, clarifications, corrections, farewells and general conversational navigation naturally, without artificial citations or mandatory sales funnels.
2. For tenant-specific policy, product, price, requirement or service facts, retrieve relevant authorized evidence before asserting the fact.
3. Infer candidate business goals from customer wording and conversation history; use catalog descriptions, semantic examples, exclusions and relevant requirements. Keywords aid recall, not sole acceptance.
4. If the customer's goal is ambiguous, ask one high-value clarification. If sufficiently clear, continue helpfully without a routine confirmation ritual.
5. Collect only contextually relevant requirements. Do not ask for contact details simply because the customer asked a factual question.
6. Correct previous assumptions when the customer updates information; do not persist contradictory versions as simultaneously verified facts.
7. Ask for explicit confirmation before an external side effect when required by the action policy; separately capture purpose-specific consent when applicable.
8. Distinguish proposed, queued, executing, completed, failed and reconciliation-required operations accurately. Never invent completed CRM, payment, upload or contract states.
9. Continue the conversation across turns, including after workflow updates; authenticated customers may resume conversations within their tenant and access rights.
10. Respond in the session-pinned published persona and appropriate customer language, without exposing internal prompts, tools, data contracts or sensitive identifiers.

## Tenant administration
- Create, review, validate, draft and publish versioned personas and intent/action/workflow catalogs via Admin.
- Import/export catalog definitions as JSON or YAML. Validate against a stable schema before publish; never execute arbitrary URLs or instructions contained in an imported file.
- Set tenant-specific supported languages, tone, retrieval sources, service offerings, intent examples, required facts, action permissions, prerequisites, idempotency policy and verified completion criteria.
- Pin a session to published revisions until an explicitly safe migration. Draft changes must not silently alter in-progress conversations.

## Platform requirements
- Multi-tenant isolation across identity, data, tools, prompts, retrieval, caches, workflow events, provider callbacks and observability.
- Azure GPT-5.4 primary; optional OpenAI model adapter. Provider swaps must not alter Node authorization.
- PostgreSQL system of record; protected pgvector knowledge; Redis for acceleration and delivery; private n8n for approved workflows.
- PII encryption, masking, retention, consent receipts, tenant RBAC and an auditable data access path.
- Bounded latency and tool calls, timeouts, rate limiting, retries, cancel/replay handling and graceful abstention.
- Accurate operational and real-model conversation-quality measurements, not just mock test success.

## Explicit non-goals
- An unrestricted autonomous agent with direct CRM, SQL, payment or network privileges.
- One mandatory company-formation journey for all tenants.
- Treating a guessed goal, high model confidence or a successful webhook transport as authority to perform an action.
- Replacing protected RAG data or rebuilding existing embeddings as part of a conversational refactor.

# Python conversation agent ↔ Node trusted tools — pre-response planning loop

**Status: Python bounded coordinator implemented by V2-P3-02; Node trusted-tool gateway remains the next issue.** Complements [persona response contract](persona-response-contract.md), [intent catalog](intent-engine.md), [architecture](architecture.md), and [n8n workflows](n8n-workflows.md).

**Canonical interface:** [conversation-engine-contracts.md](conversation-engine-contracts.md) and [seven-component architecture](conversation-engine-architecture.md). Python may choose **multiple bounded read tools before one final answer**. Node must authenticate and independently validate each call; the model's tool preference is not authorization. The exact tool protocol and schema must be frozen in P0 before building server endpoints.

## Ownership

**Python owns dialogue strategy and orchestration of model-assisted reasoning.** Node owns authorized tenant/session/opportunity context, catalog publication, persona version, fact/source provenance, tool execution, action gating, persistence and callbacks. The GPT model can propose one or more bounded **read-only tool calls before the customer reply**; Python dispatches those requests to a private Node tool gateway and supplies results back to the model by matching function call IDs. No direct Python database, n8n or CRM credentials.

## Preload once per user turn

Node authenticates, deduplicates `clientMessageId`, binds tenant/session/opportunity, and loads the session-pinned persona, published and pinned catalog version, structured conversation summary/verified facts, active goal, current stage, pending requirement, last relevant question, outstanding action status and relevant source ACL. Send an authorized, bounded envelope to Python. **Do not make the model rediscover those essentials with multiple tool calls.**

## Node tool allowlist

| Tool | Scope / purpose | Result contract |
| --- | --- | --- |
| `get_conversation_context` | Read verified facts, last Q&A and active business goal for the bound session | Structured non-sensitive summary and revision |
| `get_persona` | Resolve published, pinned assistant name and rules | Sanitized persona envelope, personaVersionId |
| `get_intent_catalog` | Allowed categories, goals, signals, stage-specific requirements, actions | Published catalog digest and version |
| `get_journey_state` | Active stage, fulfilled/missing requirements, pending action, known provider state | Stage and revision refs, no speculative success |
| `search_knowledge` | Tenant/source-approved pgvector retrieval | Bounded evidence IDs, excerpt, source/title/version, citation refs |
| `get_missing_requirements` | Current confirmed goal and stage | Unanswered validated requirement keys and collection order/dependencies |
| `get_available_packages` | Authorized package data/eligibility/pricing | Catalog-versioned structured results and provenance |
| `get_document_requirements` | Authorized document requirements for the current package/stage | Bounded requirement types and review status, never document contents |
| `get_action_status` | Existing action/provider results | Verified status, external references only where permitted |

`propose_catalog_action` is a **separate Node business proposal gate**, not a read-only model function. It can create a pending proposal only after Node validates current goal, stage, facts and purpose-specific consent requirements. It does not dispatch a write until the customer confirms that specific action. Confirmed operations use existing PostgreSQL outbox → Redis Streams → n8n and authenticated callback/reconciliation.

## Bounded execution protocol

1. Node sends a single turn envelope with persona and already-known catalog/journey state; Python starts a model Responses API call.
2. Model may request approved, typed tools for unresolved facts (e.g. `search_knowledge` and `get_available_packages`). Python validates tool name/shape and calls the internal Node gateway, never arbitrary URLs or shell/Python code.
3. Node re-derives tenant/session/opportunity from authenticated server context, validates tool allowlist/arguments, times out appropriately, retrieves only authorized data and returns **sanitized structured results** with correlated call ID; tool failure returns a typed error.
4. Python feeds matching `function_call_output` to the model. The model may continue within a bounded tool/round/token/deadline budget or decide enough context exists. No unbounded loops, repeated read retries or duplicate external writes.
5. Once context is sufficient, Python produces a structured goal/turn decision and a **tenant persona-composed** reply based only on approved RAG/provider/catalog facts. The final customer message is validated by Node's response guard; a failed model or validator uses the approved persona fallback.
6. Node commits intent decision, verified facts, response, personaVersionId, tool evidence refs and next question atomically with session revision. Duplicate client message replays the saved response.
7. External action completion arrives asynchronously; Node updates stage only after verified provider callback. On next user turn Python sees the updated state.

## Tool response safety

- Model-generated function arguments are **untrusted**. Node checks exact allowlist keys, payload schema, auth, tenant scope, catalog version, opportunity and request deadline.
- Read-only tool output may contain prompt injection in retrieved text; treat it as **data**, never as a new persona instruction or an authorization.
- A retrieved price/rule is usable only if the source/provider meets the approved provenance contract. Do not use uncited model knowledge as backup.
- Sanitize and limit input/output tokens. Do not return customer PII, OTPs or payment credentials in context unless strictly required by an authorized workflow (the GPT agent normally does not require them).
- Every tool invocation records a redacted call ID, tool name, context revision, result/citation refs, latency and failure classification.
- All function-call, rate-limit and end-to-end turn budgets are configurable and verified under load. One initial Azure API attempt + at most three transient retries applies **per model request**, not to the entire tool-loop; enforce one shared per-turn deadline and total model-attempt budget to avoid runaway latency.
- The model must be allowed to abstain or offer a safe catalog question when sources cannot be retrieved.

## Conversation-invariant examples

Customer asks what three-visa setup options are available. The agent receives persona and known three-visa context, requests approved package and RAG tools if needed, and **answers first**, with one purposeful clarification about business activity. It must not ask again how many visas are needed or force a Salesforce Lead.

Customer asks if their submitted application is finished. The agent requests `get_action_status` and responds naturally in the pinned tenant persona, **without** claiming completion based on a queued/outbox/n8n-only state.

## Acceptance gates

The bounded Python loop, read scope, correlation IDs, no arbitrary side effects, tool-error resilience and persona pin checks are implemented and focused-tested. Node still must provide the authenticated trusted-tool gateway and final response guard before replacing legacy chat behavior.

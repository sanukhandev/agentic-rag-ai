# 03 — Conversation engine, model adapter and tool registry

**Status: target contracts. Rewrite only the layers that fail this contract after code audit.**

## Conversation authority
One GPT-led conversation decides the next useful move and writes natural customer prose. Node is not a second dialogue planner. It may reject an unauthorized action, ungrounded consequential claim, privacy leak or unsupported completion claim; it must not demand a canned prompt, particular wording, fixed question key, keyword overlap or gratuitous goal confirmation.

## Provider adapter
- A single provider-neutral ModelClient interface encapsulates request, response, structured output, function calls, timeout, cancellation, model identifier and usage metrics.
- Azure OpenAI GPT-5.4 is the primary provider profile. OpenAI is an optional profile using the same output contract. Deployment configuration selects provider; there is no implied automatic failover.
- Never leak provider keys to browser, Node tool results, model context or logs. Gateway readiness reports capability without secrets.
- Set explicit overall turn budget, maximum model calls, maximum tool rounds, output budget and concurrent-call limits as deployment policies; tune with measured latency and quality rather than arbitrary retries.

## Bounded LangGraph loop
~~~mermaid
flowchart TD
  A["Authorized turn envelope"] --> B["Build context"]
  B --> M["Model: understand + decide"]
  M --> Q{"Need trusted data?"}
  Q -->|Yes and within budget| T["Node read-tool registry"]
  T --> X["Validate, correlate, sanitize output"]
  X --> M
  Q -->|No or budget reached| F["Model: compose final response"]
  F --> O["Typed response and proposals"]
  O --> N["Node validator + durable commit"]
~~~

State in this graph is short-lived per-request execution state; Node/PostgreSQL owns resumable memory. The graph never executes side-effectful catalog actions. Stop deterministically on deadline, cancellation, tool budget, repeated identical tool requests or exhausted retry policy. Avoid silent recursive loops.

## Request envelope (conceptual)
- Correlation: request ID, tenant-bound session ID, message ID, time budget and pinned config version identifiers.
- Context: customer message, relevant recent turns, durable concise summary, validated known facts and corrections, unresolved topics, action status and tenant persona.
- Capabilities: registry of allowed read-tool names and versioned parameter schemas, plus available catalog goals for this session.
- Evidence: only authorized retrieval excerpts/provider facts, each with scope and provenance.
- Model context must **actually contain** the durable summary; merely setting a field in a Node DTO is insufficient.

## Tool registry
- Node maintains reviewed read-tool definitions with stable IDs, descriptions, JSON Schema parameters, explicit output schemas, required permission, per-tenant allowlist, timeout, data classification and audit policy.
- Examples: search_knowledge, list_supported_goals, get_goal_requirements, list_available_packages, get_verified_customer_facts, get_action_status, get_conversation_summary.
- The model requests a tool by registered name and validated arguments. Node resolves its implementation; arbitrary URLs, SQL, code execution and unknown tool names are forbidden.
- Tool responses include call ID, retrieval status, source IDs, tenant scope and revision metadata where applicable. Empty, unauthorized, stale and timeout are distinct result states.
- A successful read tool is not proof that an external action was completed.

## Candidate output (conceptual)
~~~json
{
  "message": "Natural customer-facing reply",
  "evidenceRefs": ["authorized-source-reference"],
  "goalCandidates": [{"goalKey": "company_formation", "confidence": "high"}],
  "factUpdates": [{"key": "requested_activity", "value": "consulting", "source": "customer_turn"}],
  "clarificationNeeded": false,
  "actionProposal": null
}
~~~

This is a desired minimal contract, not a declaration of existing API compatibility. Define actual TypeScript and Python schemas in a separate implementation change. Validate candidate goal keys and fact types against published catalog contracts; treat model confidence as advice, not authorization. Persist only validated information and use a conservative conflict policy for corrections.

## Response check
- **Conversational:** greeting, acknowledgment, clarification and natural follow-up; no citation required.
- **Business factual:** verify each consequential claim against approved RAG/catalog/provider evidence with compatible scope, revision and entailment; citation IDs alone do not prove support.
- **External outcome:** state completed only after authoritative verified provider state.
- **Policy violation:** reject or safely regenerate only the invalid content. Record reason and bounded retry; do not overwrite a correct response with a rigid template.

## Observability
Capture correlation ID, tenant-safe identifiers, model/provider version, selected read tools, latency/tokens, evidence refs, guard reasons, tool budgets, action proposals and human-quality evaluation metadata. Never log raw credentials, unmasked PII or sensitive source excerpts.

## P4 candidate status (implementation, not production activation)

An opt-in Python LangGraph GPT-first controller and private Node callback now use the isolated P2/P3 contracts. The private callback verifies the P3 session-token/catalog scope for every read and issues signed evidence receipts. Returned model citations must match receipts from the current turn; the Node claim verifier performs a fresh authorization/source revision read and requests independent entailment from the existing private grounding service. Raw lexical overlap is not required.

The candidate still needs a real encrypted privacy-vault binding, complete claim-coverage and tenant-isolation UAT, remote CI, live Azure evaluation and P6 feature-gated API wiring. The legacy V2 controller continues handling production chat. Never treat this documentation as proof of production readiness.

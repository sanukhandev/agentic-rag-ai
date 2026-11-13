# 03 — Microsoft Foundry Agent and Python Model Gateway

**Status:** target replacement for LangGraph; Python FastAPI stays.

## Agent invocation
Each application `agent_id` resolves to an approved Foundry project, named agent, pinned agent version/model, persona revision and published tool set. Python invokes that agent using its supported Responses/agent-reference API; Foundry manages natural reasoning and function selection. Preserve a single application-owned turn contract and bounded execution budget. The service cannot directly mutate PostgreSQL or execute workflows.

## Model turn contract (illustrative)
```json
{
  "requestId":"uuid",
  "ticketId":"uuid",
  "agentRef":"server-issued-binding",
  "pinnedVersions":{"persona":"v1","intents":"v1","offerings":"v1","knowledge":"v1"},
  "context":{"customerMessage":"...","recentTurns":[],"summary":"...","verifiedFacts":[],"actionStatus":[]},
  "toolScopeRef":"short-lived-node-issued-token",
  "limits":{"maxFunctionCalls":8,"maxRounds":3,"deadlineMs":60000}
}
```
`agent_id` and trust scope come from Node, not model or browser. The model returns natural message, citations/evidence refs, intent candidates, proposed fact updates and optional non-executing action proposal. Versioned TS/Python schemas are finalized during implementation.

## One model-visible tool set (per-agent allowlist)
| Tool | Purpose |
| --- | --- |
| `find_intents` | Search published intent definitions by conversation semantics |
| `get_intent_requirements` | Return applicable required/verified/missing/conditional facts and documents |
| `search_knowledge` | Gateway-mediated Foundry IQ retrieval, source IDs/revisions and citations |
| `get_offerings` | Approved products, services, package and pricing records |
| `get_ticket_context` | Verified ticket facts, summary and pending topics |
| `get_document_data` | Approved structured OCR fields from private ticket files |
| `preflight_operation` | Nonexecuting prerequisites, consent and authorization check |
| `propose_operation` | Submit proposal only, never direct execution |
| `get_operation_status` | Verified asynchronous operation result |

No redundant ANCFZ document-requirements tool, no hardcoded stage planner, no unrestricted SQL/web/Bing, no direct CRM/payment/n8n function.

## Tool handoff
Foundry requests an application function → Python checks schema, name, scope, correlation and budget → private Node dispatcher checks bound agent/account/ticket + allowlist and executes reviewed capability → Python returns result to Foundry → model continues or produces final answer. If supported native Foundry tools bypass this boundary, do not attach them to protected Agents. Ingestion and admin tool creation are not customer-visible functions.

## Evidence and guardrails
Greetings/clarifications need no citation. Agent-business facts require approved and current evidence with provenance; prices/formal quotes use authoritative offering catalog; external success requires verified provider status. Node independently rejects unsupported consequences without lexical-overlap policing. Tool errors distinguish unauthorized/empty/timeout/unavailable/stale; bounded recovery cannot weaken ACLs.

## Context and privacy
Node owns durable messages, facts and ticket revision. Redis caches current projection. Foundry conversation IDs may be used only as scoped ephemeral adapters; never be the sole durable memory. Do not send OTP, credentials, raw identity attachments or unnecessary PII. No separate LangGraph memory/planner is allowed in target.

## Observability
Correlate agent, ticket, turn, model deployment, Foundry agent version, tool IDs, budget, evidence revisions, policy decisions, retries and provider calls. Capture no raw secrets or unapproved document contents in routine logs.

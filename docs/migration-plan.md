# Implementation migration plan — current Node Foundry Agent to Node + Python GPT

**Status: TARGET PLAN; documentation does not execute these phases.** Build additive components and preserve current tested behavior until a staged cutover is proven. No arbitrary 25 commits/200 messages.

## Phase 0: snapshot and baseline

- Capture exact branch/commit, diff and any dirty local changes.
- Run existing Node API, PostgreSQL/Redis, catalog, outbox and security tests; capture one current Chat API response contract and latest seven-stage provider state.
- Confirm actual Azure **model deployment** endpoint, deployment name, API-key availability, quotas, region, Responses API support and restricted secret storage (not the Foundry Agent project URL).
- Enumerate published catalog, workflow bindings, **tenant personas and fallback templates**, plus current session personaVersionId behavior; identify missing provider credentials/acknowledgments.
- Use the preserved parent branch and Git history as rollback for retired Foundry Agent runtime code. Do not remove historical database migrations or customer records.

## Phase 1: private Python GPT gateway

- Initial slice created: `services/model-gateway/` using Python 3.12 FastAPI/Pydantic, an API-key OpenAI SDK client, structured plan/normalization, health checks and a private Compose overlay. **Not yet exercised against a live deployment; retry/circuit-breaker acceptance remains pending.**
- Implement structured `plan`, bounded authenticated **Python↔Node read-tool continuation**, `normalize`, final **Persona Response Composer**, typed errors and a private Node client. Preload the **published session-pinned persona before planning**. Azure model key stays within the gateway.
- Configure exactly initial request + up to **3 retries** for transient errors; 429 header adherence, rate limiter, one request deadline, circuit breaker, cost telemetry and mock tests. Avoid double retry.
- Initial slice created: `ChatModel`-compatible Node adapter and opt-in `CHAT_MODEL_PROVIDER=python-gpt` overlay, while retaining the existing public API shape. Old Foundry Agent code is removed from this isolated branch; rollback is via Git branch, not a runtime feature flag.

## Phase 2: persisted User Intent Document and cache

- Add additive Postgres migration for per-opportunity document current projection + append-only turn assessment.
- Backfill safely from existing intentProgress/journey state without inventing consent; use CAS revision and existing session-first lock order.
- Cache normalized retrieval tokens and interpretation decisions with fully scoped version/digest keys, record each turn even on cache hit, invalidate when facts/catalog/source/stage/consent change. Duplicate message must cost zero GPT requests.

## Phase 3: catalog/intent engine and response question

- Introduce six tenant-configurable **intent categories** and separate durable Business Goal, turn intent and ToolBinding keys; remove the conceptual assumption that `lead.capture` is the primary intent. The LLM must be the **primary conversational planner**: structured summary, goal candidates, bounded adaptive signal weighting, ambiguity, clarification, best next move and customer goal confirmation. Node validates and persists the accepted plan.
- Extend catalog schema safely for synonym/exclusion policy, `ToolBindings` and stage-specific action confirmation requirements; publish via existing Admin APIs; no ANCFZ-specific branching in Node.
- Implement the **Node Trusted Tool Gateway** for Python (persona, catalog, intent context, journey, requirements, RAG, packages and action status), with allowlist, correlated function calls and bounded execution. Integrate planner-assisted RAG normalization/retrieval; every factual claim needs approved evidence and tenant/source policy.
- Implement the **Python Persona Response Composer as the last generative step**, followed by a **Node Response Guard** checking persona version, language, citations, action truth, forbidden raw metadata and **one useful, non-repeated follow-up** (or valid exception). Provide versioned **offline tenant-persona fallbacks** that require no GPT availability. Use current pending requirement; knowledge interruptions must not erase it.
- Add evaluation fixtures measuring intent precision, ambiguity and state continuity before switching default provider.

## Phase 4: catalog-driven n8n tool actions

- Translate confirmed intent, validated facts and stage to tool **proposal**, not execution.
- Reuse current `ActionRequest`/consent, transactional outbox, Redis worker, n8n workflow registry and callback reconciliation.
- Verify workflow contracts for seven stages (qualification may stay Node-only); no direct Python/n8n or model-provided URL writes.
- Fix Salesforce Lead remote acknowledgment first. Verify side effects and idempotency before Account, package, SF-02 documents, invoice and contract.

## Phase 5: single-journey acceptance and rollback

- Run one session/opportunity through seven ANCFZ stages with real GPT, pre-response Node tool calls, **Zara's published voice on every customer message if configured**, approved RAG, one purposeful next question, confirmed goal, catalog tool proposals and verified provider/sandbox acknowledgments.
- Include interruption, fact correction, restart, duplicate message, delayed callback, 429 recovery and provider outage/fail-closed.
- Mark final outcome provider verified, sandbox/mock only, or blocked honestly.
- Validate public API contracts, **persona/response-guard release gates across every state, offline fallbacks and second-tenant persona isolation**, security, performance and rate limits.
- When accepted, switch the Node Python provider for the intended development deployment using a verified rollback plan; the Foundry adapter was already retired in the merged rewrite scaffold. No migration may erase prior journey state.

## Track phase results in `current-state.md`

Each change reports file paths, migration IDs, test counts, new failures, Azure deployment identity (no secret), action/provider evidence and blockers. Tests not executed are `NOT RUN`, not `PASS`. Do not push/merge or initiate real charges/signatures without explicit user authorization.

# Python Conversation Agent Runtime — model, tenant persona, tools and reliability

**Status: TARGET beyond scaffold.** An initial private Python FastAPI model-gateway scaffold exists, but **persona-final composition, full agent tool continuation and Node final response guard are not implemented**. Do not substitute a named Foundry Agent project endpoint for a GPT model deployment.

## Azure API/key selection

Use the OpenAI Python SDK against an Azure OpenAI **model deployment**. Microsoft documents the Responses API and key auth:

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    base_url=os.environ["AZURE_OPENAI_BASE_URL"],  # e.g. https://<resource>.openai.azure.com/openai/v1/
    max_retries=3,
    timeout=20.0,
)
response = client.responses.create(
    model=os.environ["AZURE_OPENAI_DEPLOYMENT"],
    input="Approved, bounded request context",
)
answer = response.output_text
```

`AZURE_OPENAI_DEPLOYMENT` is the **deployment name**, not merely `gpt-4.1-mini` unless the deployment was actually named that. The key belongs to the **model resource**, not a `foundryApiKey` project-agent tool connection. Confirm current deployment, region, quota and Responses availability before use. The OpenAI SDK may also connect to OpenAI's own endpoint, but Azure is the first target. Keep a provider interface so credentials and base URL are provider-specific.

Sources:
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses
- https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/switching-endpoints
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota

## Runtime decomposition and bounded model strategy

This service is **one Python Conversation Agent Runtime**, with a logical Planning & Intent Engine (component 2) and a final Natural Persona Composer (component 3), rather than multiple competing customer agents. The runtime receives a session-pinned persona, compact authorized catalog, current verified state and latest customer text. It may make **bounded** function calls through Node's authenticated read-only Trusted Tool Gateway (component 6) before final composition; never execute unrestricted Python code from a customer prompt.

The planned **internal v2 turn envelope** may wrap the existing `/internal/v1/model/plan`/`normalize` scaffold. Do not assume current methods implement the v2 contracts. Freeze Pydantic/TypeScript schema compatibility and tool call-ID correlation in P0. Enforce one global per-turn deadline and token/tool budget even though SDK `max_retries=3` is per model request; planning and composition can otherwise amplify quota/latency. See [contracts](conversation-engine-contracts.md) and [delivery roadmap](conversation-engine-delivery-plan.md).

## Private Python HTTP interface

Proposed FastAPI internal-only routes, with strict request/response schema, `tenantScopeRef` opaque context resolved/authorized by Node, request correlation and `modelTaskVersion`:

- **`POST /internal/v1/model/plan` (primary):** input bounded latest conversation, persisted **User Intent Document and summary**, and tenant-published compact catalog taxonomy/goals/signals/requirements/tool definitions; return strict JSON with turn intent category, primary-goal candidates, observed catalog signal evidence, **bounded weight suggestions and reasons**, fact/correction proposals, candidate confidence/ambiguity, requirements coverage, **next move** (`answer_knowledge`, `clarify_goal`, `confirm_goal`, `collect_requirement`, `request_document`, `request_contact`, `propose_action`, `check_action_status`, `complete_goal`, `ask_more_help`, `stop`), one next-question proposal and optional approved `toolKey`. This is the main LLM orchestration call; Node independently checks all fields and external action eligibility. `/interpret` may be retained internally as a task alias, but is **not** a separate mandatory model call.
- `POST /internal/v1/model/normalize`: input current masked/restricted text, **LLM's current turn category and structured conversation summary**, non-PII verified facts, previously answered topics, approved catalog vocabulary; output normalized retrieval query, keywords/tokens, preserved quantities/negation, reason and validation notes. No invented facts or arbitrary URLs.
- `POST /internal/v1/model/compose`: input authorized RAG/provider evidence IDs and excerpts, tenant persona, **confirmed business goal and turn-intent category**, LLM planner's allowed next move and pending requirements; output grounded answer, citations, **one relevant follow-up question** or explicitly allowed no-question reason, uncertainty. Node validates evidence and catalog compatibility; it should preserve the LLM's natural dialogue plan when valid, rather than replacing it with rigid scripted text.

Expose `/internal/health/live` and restricted `/internal/health/ready`. Python must never accept instructions to select arbitrary customer identities, tenant databases, external tool destinations, or provider credentials. Model output is untrusted structured data. Cap input bytes/tokens/output length and schema complexity; reject user-defined function code.

## Required persona-aware agent and Node tool contract

- **Preload before planning:** Node supplies an authenticated bounded envelope containing tenant/session/opportunity refs, published `personaVersionId`, assistant name, AI identity, tone/language/style rules, approved catalog, verified conversation summary, active goal, current stage and pending requirement. User messages and retrieved documents cannot override the persona.
- **Pre-response tools:** the Python agent can request typed read-only Node functions to retrieve RAG evidence, persona, catalog, missing requirements, packages, journey and action status. A Node tool gateway re-derives scope/authorization, executes and returns sanitized structured results correlated to model call IDs. Respect bounded rounds/requests/tokens/total deadline; no direct Python→n8n/DB/CRM, no arbitrary code execution. Business action proposals require separate Node consent/action confirmation.
- **Final generative step:** Python runs a **Persona Response Composer** after tool results. It returns an internal structured candidate (natural `answer`, `citationIds`, `nextQuestion` or reason none, `personaVersionId`, language and internal decision/evidence refs), never streams raw planner/function output to the customer.
- **Final enforcement step:** Node Response Guard checks published persona/session identity, citations and source grounding, business facts and provider truth, at most one purposeful question, language and absence of raw keys/JSON/tool traces. Invalid output must be safely regenerated within budget or replaced by an **approved tenant-persona offline fallback**.
- **All paths:** the same persona is required for greeting, clarification, RAG, contacts, documents, consent, queued actions, provider failures, payment/contract status, handoff and completion. The assistant is warm and thoughtful without impersonating a human or inventing its private thoughts.
- These are **new target interfaces**; the current `/plan` and `/normalize` scaffolding is not evidence of completing this contract. See [persona-response-contract.md](persona-response-contract.md) and [agent-tool-loop.md](agent-tool-loop.md).

## Retry and rate limiting

**Exactly one initial model request plus up to THREE retries (maximum FOUR attempts)** for *transient* errors only. Prefer SDK `max_retries=3` plus **no second wrapper retry loop**. The SDK automatically handles retry-after values and backoff; for advanced controls use one outer custom retry policy only with SDK auto retries disabled (`max_retries=0`). Preserve upstream `retry-after-ms` or `Retry-After` delays when possible; exponential backoff and random jitter otherwise, with max delay and bounded total deadline.

- Retry: 408/request timeout, 409 transient conflicts, 429 rate limit, 500/502/503/504 and connection reset/timeouts classified safe to repeat *inference*.
- Do NOT retry: 400/401/403, bad schema/model deployment/key, invalid prompts, unsupported API/model, other permanent errors.
- When all attempts fail: return sanitized typed `MODEL_UNAVAILABLE` with optional next retry hint, **no fabricated grounded answer, citation, intent, fact update or side effect**. Do not call n8n as a model failure fallback.
- Node timeout must exceed Python's bounded model request/retry budget plus service overhead, otherwise the intended retries will be cut short. Share one deadline/cancellation budget across normalization, interpretation and composition per turn.
- Rate guard: per deployment configurable RPM/TPM, max in-flight calls, bounded queue with timeouts, coalesce identical in-flight requests, stop preemptively when budget exhausted. Cache deterministic results to avoid repeat inference. Do not assume all deployments have identical RPM/TPM.
- Circuit breaker: open on sustained 429/5xx, honor cool-down and fail fast rather than stampeding provider.
- Trace sanitized requestId, task type, tenant hash, deployment, attempt count, latency, token consumption, rate headers, result status and retry reason. Do not log API keys, raw customer PII or full prompts.

Microsoft documents 429 `retry-after-ms`, exponential backoff/jitter and Python SDK `max_retries`. Reference: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota

## Token/cost and availability goals

A repeated message should return the saved durable response with **zero** provider calls. A new substantive turn should ordinarily call the **primary GPT planner**, with bounded additional normalize/compose calls only when useful; reuse the planner output and scoped cache instead of running an independent intent classifier on top. The model selects dialogue direction, while Node validates catalog-scoped eligibility. Cache normalized query and structured interpretations by catalog/context hash. Do not cache customer-specific interpretations globally or across tenants/sessions.

## Deployment and access

Python listens only on the private Compose network, with a Node→Python service credential, no host port. Use secret env or secret store; never copy secrets into Docker layers, `.env.example`, repository or browser. Production keys should use approved managed secret storage/rotation and require privacy/security review. Existing customer masking/consent stays in Node while advanced filter expansion is deferred.

## Acceptance tests

Provider mock tests for initial success, 429 with `retry-after-ms`, transient 5xx, three retries exhausted, 400/401 nonretry, per-call timeout, cancellation, concurrent throttling, circuit breaker, duplicated idempotency key, malformed JSON and secret-safe logs. One approved live model smoke test only after credentials/configuration confirmed.

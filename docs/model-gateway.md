# Python GPT inference service — contract, Azure key and reliability

**Status: TARGET.** No dedicated Python model service is presently implemented in this branch. Do not substitute the named Foundry Agent project endpoint for a GPT model deployment.

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

## Private Python HTTP interface

Proposed FastAPI internal-only routes, with strict request/response schema, `tenantScopeRef` opaque context resolved/authorized by Node, request correlation and `modelTaskVersion`:

- `POST /internal/v1/model/interpret`: input latest bounded conversation + catalog candidate keys/signals/required slots + confirmed context; output strict `intentCandidates[]` (key, evidence spans, negation, slot proposals, ambiguity indicators), **never a workflow authorization**.
- `POST /internal/v1/model/normalize`: input current masked/restricted text, non-PII facts, previous query, approved catalog vocabulary; output normalized retrieval query, keywords/tokens, preserved quantities/negation, reason and validation notes. No invented facts or arbitrary URLs.
- `POST /internal/v1/model/compose`: input authorized evidence IDs and excerpts, tenant persona, confirmed intent, pending requirement and validated facts; output answer text, cited evidence IDs, optional next-question *draft*, uncertainty. Node validates and overrides required next question to match catalog.

Expose `/internal/health/live` and restricted `/internal/health/ready`. Python must never accept instructions to select arbitrary customer identities, tenant databases, external tool destinations, or provider credentials. Model output is untrusted structured data. Cap input bytes/tokens/output length and schema complexity; reject user-defined function code.

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

A repeated message should return the saved durable response with **zero** provider calls. A normal turn should use at most the minimum necessary normalization/interpretation and one composition; prefer deterministic scoring when unambiguous. Cache normalized query and structured interpretations by catalog/context hash. Do not cache customer-specific interpretations globally or across tenants/sessions.

## Deployment and access

Python listens only on the private Compose network, with a Node→Python service credential, no host port. Use secret env or secret store; never copy secrets into Docker layers, `.env.example`, repository or browser. Production keys should use approved managed secret storage/rotation and require privacy/security review. Existing customer masking/consent stays in Node while advanced filter expansion is deferred.

## Acceptance tests

Provider mock tests for initial success, 429 with `retry-after-ms`, transient 5xx, three retries exhausted, 400/401 nonretry, per-call timeout, cancellation, concurrent throttling, circuit breaker, duplicated idempotency key, malformed JSON and secret-safe logs. One approved live model smoke test only after credentials/configuration confirmed.

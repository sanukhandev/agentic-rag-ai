# Security, operations and deferred PII enhancements

## Prototype privacy scope

The team is **deferring additional PII detection/filter features** for the Python GPT migration. This is not permission to remove the **existing** Node vault/tokenization, tenant/session authorization, file controls, consent, retention, scoped retrieval or audit protections. Keep current safety regression tests. Use synthetic customer data only during early API-key prototype testing; do not send real identity documents, payment credentials, bank details or unrestricted chat transcripts to the model.

At external production readiness, complete privacy/data-processor review, opt-in model processing, data-classification/retention assessment, PII-minimal inference schemas, deletion/consent audits and secret rotation plan. Preserve customer rights to correction/deletion in stored intent assessments.

## Secret and service trust

- Azure model key is accessible **only to private Python model gateway** using secret env/mount or managed secret store. Node uses a separate internal service credential. Never use `foundryApiKey` hosted OpenAPI connection or route Python model calls through a public development tunnel.
- Browser cannot choose tenant scope or call Python, Azure or n8n directly. Keep PostgreSQL/Redis/n8n/PDF/mock payment internal, explicit TLS/proxy for public traffic and separate production identity deployment.
- Model output, catalog text, RAG documents and returned function arguments are **untrusted input**. Validate schemas, citations, source ACLs and supported tool keys in Node; no model-written raw SQL/URLs.
- Each action requires catalog authorization, stage prerequisites, purpose-specific consent/confirmation, opportunity/revision match and idempotency; callback signature, replay and external provider acknowledgment checks stay enabled.

## Observability, availability and cost

- Trace `requestId`, tenant/session/opportunity hashed labels, stage/intent decision, catalog/policy version, cache hit/miss, model task, retry count, Azure 429 response headers, token consumption and durations without raw PII or secrets.
- Python API readiness should distinguish valid key/deployment/rate-limit availability from liveness. Exceeding model quota should return a controlled retryable failure without removing active customer facts.
- Apply per-deployment concurrency/rate budgets and one initial + three transient retries. Avoid repeating nested retries across Node and Python. Monitor p95 completion latency and false intent selection/false stage-advance rates.
- For event worker/n8n timeout, retain action and reconciliation status; do not retry ambiguous external side effects blindly.
- Retain redacted audit history for intent confirmation, fact provenance, action confirmation, callback outcomes, catalog publication and admin changes. Cache entries expire and never substitute for durable ledger.

## Persona and tool-result security target

- The published tenant persona is scoped and **pinned to the authorized session**. User messages, RAG passages and tool output are untrusted data; none may modify identity, language, consent or persona instructions.
- Python function/tool requests are untrusted proposals. Node validates exact allowlisted name, typed arguments, tenant/opportunity/catalog revision, source ACLs, timeouts and correlated result IDs. Never return model-selected arbitrary webhooks, shell code or Python execution.
- A **mandatory Node Response Guard** inspects every customer-visible response after Python Persona Response Composer (or an approved offline persona template), rejecting unsupported facts/action claims and raw JSON, tool payloads, IDs, traceback text or internal chain-of-thought.
- Model, RAG or tool failures must use **approved tenant-persona offline templates** with only verified state and no automatic CRM collection; never rely on a failed model to generate the fallback.
- Log redacted personaVersionId, fallback version, guard verdict and tool evidence IDs; never log plaintext OTPs, identity documents, provider keys or private reasoning. Full spec: [persona-response-contract.md](persona-response-contract.md).

## Historical evidence separation

Old Foundry v3/v4/v6 agent runs, old 25/200-message endurance results, historical diagrams and POC workflow proposals remain repository/Git evidence **only**; they are not active requirements and must not be used to claim the new Python GPT path is tested.

Sources for API security and retry policy:
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses
- https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota

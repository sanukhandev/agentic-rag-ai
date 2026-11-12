# 07 — Security, privacy and policy validation

**Status: non-negotiable target controls. Existing enforcement requires code-level verification.**

## Trust boundaries
- Browser/channel input and retrieved documents are untrusted.
- Node authenticates customer and operator, derives server-trusted tenant identity, authorizes session/record scope and issues short-lived private gateway credentials.
- Python/model receives the minimum scoped context and can invoke only Node-reviewed read tools.
- n8n and remote providers never accept authorization solely from model text or a browser-provided binding.
- PostgreSQL tenant-scoped records are the source of truth; audit row-level security where supported as defense in depth in addition to application checks.

## Multitenant invariants
Tenant identity is included and verified for every session, memory read, persona/catalog revision, RAG retrieval, cache key, tool argument, document, workflow command, callback and audit event. Cross-tenant IDs, reference enumeration, SQL joins, replayed callback IDs and caching collisions must not bypass this invariant. Administrative elevation requires explicit role checks and audit.

## Personally identifiable information
- Maintain encryption at rest for sensitive fields and secure transport between services; use managed key/secret rotation.
- Collect only data required for a customer-approved purpose. Separate contact/CRM consent from goal interpretation.
- Mask PII in traces, diagnostics, logs, error messages and support dashboards; do not use raw PII as cache keys or metric labels.
- Configure retention, deletion/export and access policies by tenant and applicable law. Never store secrets in catalog exports, prompts or Git.
- Enforce access-controlled memory resumption, anonymous-to-authenticated binding and tenant-scoped deletion.
- Development shortcuts affecting PII are allowed only in isolated synthetic-data environments, never by disabling core production boundaries.

## Model and knowledge defenses
- Treat tool descriptions as trusted code-reviewed configuration; treat source snippets, catalog prose and customer messages as data.
- Defend against prompt injection, tool-output role spoofing, SQL/URL injection, overlong context and requests for internal prompts/credentials.
- Validate JSON Schema input/output types, bound content lengths and sanitize model-visible tool errors.
- Disallow direct code/shell/SQL execution, arbitrary outbound HTTP requests and side-effect operations in the model read registry.
- Validate evidence claims based on source authority and meaning, not on keyword overlap or citation existence alone.

## Action security
- Node authorizes each external side effect against principal, tenant, published action revision, required facts, permission, confirmation, consent and verified prerequisites.
- Use stable idempotency keys, database transaction/outbox coupling, replay prevention and explicit pending/reconciliation states.
- Sign and authenticate provider callbacks, verify audience/tenant/command correlation, expiration/nonces and independently check completion evidence.
- Rate-limit customer input, gateway requests and high-impact actions; use deadlines, circuit breakers and retries with bounded exponential backoff.

## Response safety without robotic dialogue
Do not block an ordinary greeting or natural paraphrase for lacking a citation. Review consequential business claims, unauthorized data disclosure, invented provider outcomes and policy violations. If a claim is unsupported, use a concise transparent abstention or bounded regeneration. Avoid deterministic scripts that override valid model-authored prose.

## Required negative testing
Run cross-tenant identity/citation/cache tests, ownership and impersonation tests, callback replay/forgery tests, prompt-injection and unsafe tool arguments, consent withdrawal, concurrent duplicate actions, secret leakage, PII-masking and forbidden RAG-write tests. Security and action correctness failures block release regardless of conversational quality.

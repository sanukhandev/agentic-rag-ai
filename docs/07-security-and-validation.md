# 07 — Agent isolation, authentication, privacy and authorization

**Status:** mandatory target controls.

## Trust boundaries
Customer/browser, document text, Foundry output and catalog prose are untrusted. Node derives `agent_id` from an approved channel/route and checks every principal's ticket permissions. Python uses service-to-service authentication to call Node functions. Foundry never selects database authority or provider credentials. Agent-scoped RLS/composite FKs are defense-in-depth for database reads/writes; provider callbacks are authenticated and matched to expected action/version.

## Authentication
One Agent owns its accounts. An entered email does **not** authenticate or prove an account exists. Node offers OTP without enumeration, rate-limits challenges, hashes/verifies OTP server-side, issues scoped session credentials, audits guest-to-account binding and requires explicit opt-in for new account creation. OTP/passwords/keys are not model-visible. SSE is for notifications; POSTs/HTTP authentication own actions.

## Private data
Use encryption at rest/in transit, separate secrets, scoped document storage, minimum-data model envelopes and retention rules. Regex is acceptable for structured phone/email/secret patterns but not a complete strategy for names. Use contextual PII classification as a supplementary detector; store identity/contact info in protected structured fields and expose placeholder references to model where sufficient. Prevent logging raw customer documents, OTP, tokens and unmasked content in metrics or debug.

## Model and retrieval
No web search, Bing grounding or arbitrary external fetch. Tools are bound to Agent and published allowlist; reject unknown names, schemas, speculative URLs, SQL, oversized results and repeated call loops. Validate Foundry IQ source revision/access and evidence meaning; do not treat rank or model confidence as authorization. Retrieved text cannot amend instructions, enable operations or leak internal data.

## Business action safety
Node confirms actual user authorization, requirements and consent purpose; uses a transactional outbox, retry-safe idempotency and replay-resistant callbacks. Provider HTTP 200 is a transport acknowledgment only. Failed/unknown outcomes remain pending/reconciliation. Ticket closure requires customer confirmation and handling of pending work.

## Mandatory negatives
Cross-agent document/account/ticket/cache/callback access, OTP brute-force and replay, wrong-agent email login, prompt injection, rogue tool calls, stale/revoked source citations, duplicate actions, SSE unauthorized replay, Redis failure and secrets in logs all block acceptance. Admin privilege must be explicit and audited.

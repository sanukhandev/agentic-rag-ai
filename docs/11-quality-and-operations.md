# Testing, observability and operations

## Test pyramid
- **Unit**: normalization, tenant scope resolver, masking/rehydration, action policy, prompt construction, citation validator, payload schema and ingestion content hash.
- **Integration**: Express + PostgreSQL, vector filters, token mapping access, migrations, n8n mock signature verification, worker replay and retry, app API consumers.
- **Contract**: versioned OpenAPI, workflow input/output DTOs, AI output schema, admin uploads and parsing adapters.
- **End-to-end**: web chat with isolated test corpus, admin publish/revoke, safe refusal, consented mock workflow and status reconciliation.
- **Security**: IDOR, cross-tenant source leak, PII exfiltration, prompt injection from files, unknown token forgery, malicious uploads, replay and secrets in logs.
- **Grounding evaluation**: golden Q/A datasets with expected source IDs, contradiction/expiry cases, no-evidence cases, multilingual cases if supported.

## Minimum acceptance checks per feature
What inputs are allowed? Who can call the endpoint? Can it expose customer identity to a model, embedding service, n8n or logs? What is source of truth? What happens when evidence is absent? How are side effects confirmed? What happens on retries, crashes, duplicate delivery and revoked sources? Can a different tenant see it? Tests must answer these, not just a happy-path screenshot.

## Metrics and tracing
Record redacted trace ID/correlation ID, request volume, request rate and p95 latency; retrieval duration, sanitized top-k IDs, citation precision, unsupported-rate and model failures; ingestion backlog, failures, active source versions and Redis-stream progress by job/stage/counter; workflow action success/retry/unknown rate; token usage and cost estimates. **Never** emit plaintext prompts, customer input, token-map values, raw document text or third-party workflow secrets to shared telemetry.

## Logs and audit
Structured log fields: timestamp, service, environment, requestId, tenant pseudonymous reference, event name, sanitized error code. Restrict admin/audit access. Separate immutable privileged audit events from diagnostic logs. Implement data retention and deletion rules for both.

## Reliability
Use bounded timeouts, circuit breakers, retries with jitter only for safe operations, durable job status and idempotency. Retrieval/model errors fail closed. Workflow callbacks signed and replay-protected. Ingestion failed jobs must not become searchable; quarantine and retry explicitly. Monitor rate-limit abuse and token spend.

## Runbook starting points
- **LLM outage**: return "currently unable to verify" response, do not unground facts, preserve scoped session state.
- **Vector retrieval failure**: do not attempt unsourced business advice; alert on DB health.
- **Suspected PII leak**: stop external calls, rotate credentials as necessary, preserve restricted evidence, identify scope, invoke incident/privacy response.
- **n8n exposure or compromise**: isolate listener/editor, rotate workflow credentials, disable actions pending audit.
- **Corrupted source index**: revoke affected version, restore previously approved version, rebuild vectors, verify citations.
- **High action error/replay**: disable action key in registry, reconcile idempotency state before resuming.

## Evidence of completion
Release notes list changes, tests actually run and their results, migrations, security decisions, docs updates and rollback plan. The presence of documentation is not proof of operational deployment.

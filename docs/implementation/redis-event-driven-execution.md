# Redis event-driven execution

The chat request remains synchronous in Node. Only server-authorized side effects are emitted after their PostgreSQL state change:

```text
chat/action confirmation or document upload
  -> PostgreSQL state + event_outbox transaction
  -> event-relay XADD
  -> Redis Streams consumer group
  -> bounded n8n start request or Python document worker
```

## Event boundaries

`event_outbox` is the durable source for publication. `event_inbox` deduplicates successful consumer handling. Streams are:

- `rag:v2:crm` — CRM and summary events
- `rag:v2:documents` — document extraction requests
- `rag:v2:actions` — approved intent actions
- `rag:v2:notifications` — channel notifications
- `rag:v2:dead-letter` — explicitly quarantined events

Event payloads are validated routing references only. They do not contain visitor names, email addresses, phone numbers, messages, OCR text, file bytes, credentials or Salesforce tokens. Workers re-read and revalidate tenant, action/job state and workflow binding from PostgreSQL before dispatch.

## Local processes

- `event-relay` claims unpublished outbox rows and publishes them with retryable leases.
- `event-worker` consumes action/document streams with Redis consumer groups and starts the configured bounded n8n entrypoint using opaque references. Existing Python OCR polling remains the document execution worker.

The existing polling endpoints and n8n exports remain compatible during rollout. A workflow response of `202` means accepted/started only. Timeout is treated as ambiguous and moves the action to `reconcile_required`; it is not blindly retried as a new external create.

## Recovery guarantees

Delivery is at least once. The outbox can be replayed after Redis downtime, consumer groups reclaim idle pending messages, and database inbox keys prevent successful duplicate handling. Redis AOF is not a substitute for PostgreSQL outbox history or production replication/backup.

## Verification

Unit coverage validates stream routing, field round-tripping, PII rejection and memory-store approval events. PostgreSQL migration and live Redis restart/replay tests remain deployment-level checks and must be run against the target environment before production claims.

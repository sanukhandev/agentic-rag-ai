# Event delivery and recovery

The API writes business state and `event_outbox` rows in the same PostgreSQL transaction. `OutboxRelay` claims unpublished rows with a lease and publishes them to Redis Streams. New consumer groups start at `0-0`; existing groups retain their Redis offsets.

Consumers claim an `(consumer,eventId)` inbox row before dispatch. The durable lifecycle is `processing`, `retry_scheduled`, `completed`, `reconcile_required`, or `dead_lettered`. A live lease blocks duplicate work; an expired lease can be recovered. A transient n8n failure is retried up to the configured consumer limit. Ambiguous results and unavailable routes become reconciliation work, never an automatic duplicate CRM create.

Outbox publication is also bounded. After the relay limit is reached, the row is marked dead-lettered in PostgreSQL first. The `rag:v2:dead-letter` Redis stream is a retriable projection; Redis being unavailable cannot erase the durable terminal state. Redis acknowledgements happen only after the corresponding durable inbox state is written.

An accepted n8n dispatch is recorded with the inbox claim attempt and a configurable completion deadline (`N8N_COMPLETION_DEADLINE_MS`, default 15 minutes). Callback updates correlate the action execution, while the worker watchdog changes overdue accepted executions and their still-active actions to reconciliation-required. No timeout is treated as a safe duplicate-create retry.

The guarantee is at-least-once delivery with effectively-once side effects through stable action idempotency and reconciliation. Redis is not the system of record; PostgreSQL outbox/inbox state is.

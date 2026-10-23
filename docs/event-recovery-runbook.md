# Event recovery runbook

1. Check PostgreSQL `event_outbox`, `event_inbox`, action state, and audit history before replaying anything.
2. Check Redis `XPENDING` and the oldest pending age for the relevant stream/group.
3. If a worker stopped, restart it and allow lease recovery. Do not reset group offsets.
4. For transient failures, allow bounded retry. For `reconcile_required`, verify the provider through its approved read/reconciliation path before any retry.
5. Replay a dead-letter event only through an authenticated operator action with audit metadata and the original idempotency key.
6. Never mark a CRM action completed from an HTTP 2xx alone and never create a second record after an ambiguous timeout without reconciliation.

Redis AOF and the PostgreSQL outbox are local durability aids, not a replication/backup plan. Production rollout still requires tested backup, recovery, and provider reconciliation procedures.

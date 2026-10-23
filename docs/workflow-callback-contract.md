# Workflow callback contract

Workflow requests carry opaque references and correlation metadata only. The API resolves tenant, action, catalog, consent, and payload data server-side. n8n credentials remain in n8n; they are not sent to the browser, Redis, or model.

The callback must authenticate the internal caller, validate tenant/action scope, execution correlation, schema version, and legal state transition. A remote CRM ID is accepted only from a verified completion response. Replayed or stale callbacks are ignored or recorded as audit events and cannot overwrite newer state.

The application claims a `dispatching` execution row before the n8n request is sent, using the action idempotency key plus event/correlation IDs. A fast callback therefore has a durable target, and later acceptance cannot downgrade a terminal callback result. Workflow acceptance is recorded separately from business completion in `action_executions` and audit history; accepted records include the durable inbox attempt and completion deadline.

Both signed callback routes use the same transition matrix. A verified late success may resolve `reconcile_required` only when it carries a bounded execution reference; otherwise the action remains in reconciliation. Action, execution, session workflow status, and recovery audit are protected from stale regressions. Terminal inbox failures are projected to the Redis DLQ from durable PostgreSQL state and are acknowledged only after that projection succeeds.

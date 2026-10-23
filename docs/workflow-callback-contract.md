# Workflow callback contract

Workflow requests carry opaque references and correlation metadata only. The API resolves tenant, action, catalog, consent, and payload data server-side. n8n credentials remain in n8n; they are not sent to the browser, Redis, or model.

The callback must authenticate the internal caller, validate tenant/action scope, execution correlation, schema version, and legal state transition. A remote CRM ID is accepted only from a verified completion response. Replayed or stale callbacks are ignored or recorded as audit events and cannot overwrite newer state.

The application records workflow acceptance separately from business completion in `action_executions` and audit history. Accepted records include the durable inbox attempt and completion deadline. Completion callbacks may carry a bounded opaque `executionReference`; the backend updates only the tenant-scoped active execution and rejects replayed or stale state transitions.

# Migration and rollout

Apply migrations in filename order: `032-event-inbox-lifecycle.sql`, `033-crm-contact-completeness.sql`, `034-outbox-dead-letter.sql`, `035-v2-reliability-hardening.sql`, `036-review-race-and-inbox-dlq.sql`, then `037-poll-claim-leases.sql`. The final migrations add dead-letter projection leases, action deadline/recovery indexes, inbox DLQ projection state, action/event correlation, poll-claim lease coverage, and bounded hybrid-retrieval indexes. All changes are additive and preserve existing sessions, catalogs, CRM records, documents, and event rows.

Roll out the API and workers after the schema is available. Existing Redis groups keep their offsets; new groups consume retained backlog. Monitor outbox backlog, inbox leases, retry/dead-letter counts, reconciliation-required actions, and callback failures before enabling higher traffic.

Rollback is application-version rollback after additive migrations. Do not remove the new columns during rollback. A later cleanup migration requires a separate reviewed data-retention decision.

# CRM qualification and reconciliation

CRM readiness has separate dimensions:

- `contactCompletenessScore` measures valid name, email, and phone availability.
- `qualificationScore` measures commercial fit, timeline, requirements, and engagement using the existing scoring policy.
- `intentConfidence` records classification confidence and is not a side-effect authorization.

The legacy ANCFZ contact policy remains unchanged at the action boundary. A lead may be progressively enriched internally, but external CRM writes require the configured contact policy, business gates, current consent, and an approved workflow binding.

An accepted n8n request is not a completed CRM write. Verified callbacks are required before storing a remote CRM reference. Timeout, missing-ID, or route ambiguity produces `reconcile_required`; it is not retried as a blind create.

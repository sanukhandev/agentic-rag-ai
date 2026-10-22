# CRM omnichannel v2 security decision

Status: implemented locally, live activation pending review.

## Decision

The backend remains authoritative for tenant access, catalog publication, consent, lead scoring, contact validation, idempotency and durable CRM state. n8n receives server-generated action references and masked conversation data. The existing remote CRM path is provider-neutral: the endpoint is an n8n environment value and provider credentials are an n8n credential-store reference, never repository code or JSON secrets.

The backend-issued remote payload endpoint is the only place that can rehydrate validated contact fields for a claimed, consented action. The workflow must validate a real remote record identifier before calling the internal callback. A timeout or response without a valid identifier is not a sync success and must be reconciled.

## Consequences

- Generated CRM/DOC/INTENT workflow exports are inactive by default.
- The source-derived ANCFZ catalog is draft and does not publish or enable unverified bindings.
- `crm_leads.lead_id` and `crm_leads.remote_crm` remain the durable remote-link fields.
- Field-level slot values are persisted masked; tenant-admin rendering rehydrates only inside the authorized API response.
- The authorized local Salesforce smoke used the n8n encrypted credential and validated the actual sandbox response shape. The returned ID was written to PostgreSQL; no ID is fabricated by local tests.

## Rejected shortcut

Putting Salesforce URLs, OAuth client values or tenant IDs in Node configuration, workflow JSON or the catalog was rejected because it would bypass the per-tenant n8n boundary and make review/rotation unsafe.

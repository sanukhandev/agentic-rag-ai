# ANCFZ dedicated deployment — current business architecture

**Current focus:** one ANCFZ setup assistant deployment on the existing tenant-scoped platform. Dedicated deployment does **not** permit removal of persisted tenant IDs, session ownership, source ACLs or callback authorization.

For the full runtime diagram and Foundry trust boundary, see [`../02-system-architecture.md`](../02-system-architecture.md). For mandatory stage requirements, see [`../current-requirements.md`](../current-requirements.md).

## Domain ownership

- **Angular Admin:** tenant persona, approved sources, catalog publication, action/operation monitoring; existing Admin API unchanged.
- **Next.js Chat:** conversational interface through the existing Node API; no browser/provider credentials.
- **Node/PostgreSQL:** owns opportunity-scoped journey revision, validated facts, pending prompt, stage gates, consents, PII vault, provider mappings, idempotency and authenticated callback reconciliation.
- **Named Foundry agent:** v4 stable; v6 candidate with five Node-mediated read-only functions. Wording and knowledge lookups only—not business policy.
- **pgvector:** only authorized, approved, active tenant knowledge. Do not automatically ingest customer identity documents.
- **Outbox/Redis/n8n:** server-authorized workflows to Salesforce, OCR/SF-02, invoice/payment mock and contract providers; workflow status does not prove remote completion.

## Seven-stage business order

1. Lead Generation — validated contact, explicit purpose-based consent, verified remote Salesforce Lead if required by configured CRM action.
2. Lead Qualification — catalog-defined requirements and deterministic qualification evidence.
3. Account Creation — only qualified, approved, verified Lead; then real Account/Contact/Opportunity associations. Never create Accounts for all Leads.
4. Package Selection — approved current offerings, eligible pricebook and confirmed quote/selection.
5. Document Upload — separate consent; secure upload, OCR/review and SF-02 association.
6. Payment Details & Invoice — authoritative billing/quote and invoice; `mock_paid` must never mean real settlement.
7. Contract — approved template, verified provider evidence and separate signed-state proof.

Each stage is blocked until its real prerequisites are proven. Interruptions, fact corrections, session restarts, delayed callbacks and retries must preserve the same opportunity and catalog scope. Old journey consent/actions/documents cannot transfer to a new opportunity.

## Present verification limit

The latest recorded single-journey v6 test (2026-10-30) had 13 customer turns and one real `get_journey_state` function-call/output cycle. A local Lead action was created and dispatched, but the remote Salesforce Lead result was not verified and reconciliation remained pending. Other stages were **not** completed in that run. Distinguish this from earlier isolated sandbox or mocked test evidence.

Refer to [`../verification/ancfz-single-journey-tool-calling.md`](../verification/ancfz-single-journey-tool-calling.md) and [`../verification/ancfz-stage-verification-matrix.md`](../verification/ancfz-stage-verification-matrix.md) before declaring milestones complete.

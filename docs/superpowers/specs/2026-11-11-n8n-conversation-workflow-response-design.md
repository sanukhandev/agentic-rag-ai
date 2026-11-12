# n8n Conversation Workflow Response Design

Date: 2026-11-11  
Status: approved direction — option 2, catalog-first action bridge  
Scope: local development, synthetic remote n8n acceptance and the development VM catalog publication

## Intent

Make the customer conversation reflect the result of the active n8n Lead and quotation workflows while keeping the published intent catalog authoritative. A workflow may be proposed only when its catalog binding, stage, requirements, consent and explicit customer confirmation are valid. A workflow result must be normalized, persisted and passed back as verified context for the customer response.

## Approaches

1. Direct synchronous calls from the conversation turn. This is small, but bypasses the existing action/outbox/correlation boundary and risks duplicate CRM writes or quotes on retries. Rejected.
2. Catalog-first action bridge. The catalog declares the tool, stage, prerequisites and workflow route; Node validates and dispatches; the adapter normalizes the n8n result; the response composer reports only the verified outcome. Chosen because it preserves intent authority, idempotency and truthful status.
3. Fire-and-forget workflow dispatch with no turn result. This preserves the queue boundary but leaves the customer with a generic pending response and does not satisfy the requirement to use workflow responses. Rejected.

## Goals

- Add active catalog bindings for the supplied Salesforce Lead and quotation webhooks.
- Represent quotation generation as an explicit catalog action, not a heuristic branch.
- Require explicit purpose consent and customer confirmation for both external writes.
- Require an approved package and a verified account reference before quotation dispatch. The account reference is supplied by the authoritative journey/provider state, never invented by the model.
- Normalize the supplied n8n contracts:
  - Lead JSON response with a non-empty provider lead reference and `SUCCESS`/`UPDATED` status.
  - Quotation `application/pdf` response with a non-empty body, content type and SHA-256 artifact digest.
- Feed the normalized result into the final customer response without exposing internal keys, API credentials, raw provider payloads or unsupported completion claims.
- Keep the remote n8n base URL and quotation API key in private runtime configuration; keep route and payload identity in the catalog binding.

## Response semantics

- Lead success: tell the customer the Lead request was accepted/updated by the connected Salesforce workflow and continue to the next journey requirement. Do not claim a completed business stage without the existing provider-evidence gate.
- Quotation success: tell the customer the quotation was generated and provide only the approved artifact reference/attachment mechanism available to the API. Do not claim payment, invoice settlement or contract completion.
- Pending/accepted: explain that processing is underway and provide the next useful step; do not present a queued or HTTP-200 result as provider completion.
- Failure or invalid response: persist a typed failed/reconciliation state and explain that the action was not confirmed, without leaking provider errors or falling back to unrelated package text.
- Because external writes remain outbox-backed, the confirmation turn returns a truthful submitted/pending message. The normalized n8n result is persisted and becomes customer-visible on the next status/continuation turn through the authorized action-status tool; the worker does not inject a second assistant message into the conversation.

## Catalog changes

The published V2 catalog will contain:

- `lead.create` → `crm.lead.create` at `lead_generation`, with the existing contact, consent and confirmation requirements enabled.
- `quotation.generate` → `sales.quote.generate` at `package_selection`, requiring package choice, account reference, quotation consent and explicit quotation confirmation.
- `crm.lead.create` bound to `/n8n/webhook/salesforce-lead` with a versioned payload/callback contract.
- `sales.quote.generate` bound to `/n8n/webhook/generate-quotation` with a versioned payload/callback contract.

The catalog fixture, source review rows and catalog validation tests must agree. No conversation code will select these routes by matching user text.

## Implementation boundaries

- Node remains the only business authority and owns action identity, catalog pin, requirements, consent, confirmation, idempotency, persistence and reconciliation.
- The n8n adapter owns transport and response normalization only. It must not select intents or advance stages.
- The response composer receives a typed workflow outcome and produces one persona response. The response guard remains the final enforcement step.
- Existing migrations, SSL/configuration files, customer/session data and legacy code remain untouched for rollback. No VM or production deployment is part of this change.

## Acceptance

- Catalog validation rejects missing route identity, missing tool/workflow cross-reference and missing quote prerequisites.
- Unit tests prove no Lead or quotation action is created without explicit confirmation and required verified facts.
- Adapter tests prove Lead success, Lead update, PDF success, invalid content type, empty PDF and non-2xx failure handling.
- Coordinator tests prove successful workflow outcomes change the customer response and failures do not claim completion.
- Local Docker API test completes synthetic Lead and quotation conversations using the catalog actions.
- Remote synthetic acceptance reports both supplied `/webhook/` routes and stores no real PII or API key in logs or artifacts.
- The 15-use-case replay is rerun; functional failures and workflow-result response defects are reported separately from repetition observations.
- After local verification, publish the reviewed catalog version to the development VM, without changing VM SSL files, unrelated runtime configuration or existing session data. Verify the active catalog pin and run the VM smoke/replay there.

## Non-goals

- Rewriting the seven-stage journey, adding unsupplied provider workflows, or changing VM/production data.
- Treating n8n HTTP 200, a generated PDF, or a Salesforce response alone as legal business completion.
- Removing existing privacy, authorization, callback or rollback controls.
- VM database/session cleanup or broad data refresh; this change updates catalog/workflow configuration only.

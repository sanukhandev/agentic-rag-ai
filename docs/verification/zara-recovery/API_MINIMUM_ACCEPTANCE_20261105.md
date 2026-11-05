# API Minimum Acceptance Run — 2026-11-05

Environment: development, tenant `anc` / ANCFZ, public API through nginx.

## Results

| Check | Result | Evidence |
|---|---|---|
| GPT/RAG company-formation answer | PASS | Fresh live API turn returned `grounded: true` with an approved ANCFZ citation. |
| Intent-driven formation follow-up | PASS | Natural initiation produced a formation confirmation question; explicit confirmation persisted `anc.company_formation`. |
| Conversation-controlled Lead confirmation | PASS | Explicit customer confirmation returned the authorized-processing response. |
| Salesforce Lead create/readback | PASS | One guided run and 10 synthetic runs completed through n8n and Salesforce readback. |
| PostgreSQL CRM linkage | PASS | 10/10 recent `crm_leads` rows have `validation_pass=true`, a Salesforce Lead ID, and `remote_crm=salesforce_sandbox`. |
| Document requirements response | PASS | Live API answered the document question with grounded approved evidence. |
| Document upload/OCR/SF-02/Description update | BLOCKED_EXTERNAL_DEPENDENCY | Published `anc:r5` has no active document workflow/package; `/documents/config` returned `enabled:false`, empty policies/requirements; upload returned `DOCUMENT_REQUIREMENT_NOT_ACTIVE`. The SF-02 n8n template is inert. Standard Salesforce REST Lead PATCH and Attachment endpoints were live-tested successfully, and the provider sync implementation is covered by tests, but it has not yet been exercised through the public document route because the pinned catalog/lifecycle gate is disabled. |

## Verified Salesforce Lead references

`00QFW009PZNj4K42YJ`, `00QFW009PNoQkFA2Y0`, `00QFW009PWefiPU2YY`,
`00QFW009PZi1q1k2YA`, `00QFW009P7RQfJM2I1`, `00QFW009PZvZ1AC2Y0`,
`00QFW009Pa2KbjQ2IS`, `00QFW009P68YZDo2IO`, `00QFW009POFZIf62YH`,
`00QFW009OlpRsoe2IC`.

## Corrective change used for the run

The event worker dispatch timeout is configurable and defaults to 30 seconds (`N8N_DISPATCH_TIMEOUT_MS`). The previous fixed 5-second timeout aborted the n8n webhook before provider processing completed. The runtime n8n Lead readback request has no custom idempotency header; its OAuth credential binding is preserved.

## Acceptance verdict

The Lead/GPT/RAG portion passes. The requested all-or-nothing acceptance does **not** pass because the pinned published catalog does not authorize document upload/package prerequisites, and the configured SF-02 workflow is inert. Direct sandbox diagnostics separately verified a synthetic Lead Description PATCH/readback and a synthetic Salesforce Attachment create/readback; those are provider capability evidence, not proof that the customer-facing document journey completed. No local row was marked as completed for the missing end-to-end document outcome.

## Additional Salesforce capability evidence (2026-11-05)

- OAuth client-credentials authentication succeeded against the configured sandbox.
- Standard Lead readback succeeded for a synthetic Lead.
- `PATCH /services/data/v68.0/sobjects/Lead/{leadId}` with a synthetic Description marker returned HTTP 204; a subsequent Lead GET returned the exact marker.
- `POST /services/data/v68.0/sobjects/Attachment` with `ParentId=<synthetic Lead ID>` returned an attachment ID; a subsequent Attachment GET verified the parent Lead and file name.
- The application now implements matching verified mutation methods and a document-result synchronization hook, but the public route still correctly refuses until catalog/package/document prerequisites are published and authorized.
- The application sync hook is covered by an integration regression: completed OCR updates the local CRM summary, creates a verified Lead attachment, and performs a readback-checked Lead Description update through the injected provider boundary.

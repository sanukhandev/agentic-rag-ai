# CRM OCR Details and Clean Requirements Design

## Intent

Make the authorized Admin CRM record useful after OCR completes: show the exported OCR summary for each supporting document and present customer requirements as concise, deduplicated statements instead of a pasted conversation transcript.

## Goals

- Include structured OCR details in the persisted Admin CRM opportunity specification and document panel.
- Normalize visitor requirements deterministically: remove greetings/filler, collapse whitespace, deduplicate repeated turns, and retain useful customer facts.
- Keep the AI model input masked and metadata-only for identity documents.
- Keep Salesforce descriptions metadata-only; OCR details remain inside the authorized Admin CRM boundary.
- Redact stale/unknown privacy placeholders from legacy OCR records rather than failing the whole summary.

## Non-goals

- Do not send identity-document OCR text or bytes to Python, Azure, n8n, or Salesforce.
- Do not expose OCR details through the public customer document endpoint.
- Do not add a new OCR provider or change document storage, download authorization, or workflow activation.

## Approach

The existing `composeDocumentSummary` remains the model-facing safe summary and gains deterministic requirement cleanup. The Admin summarize route builds the model prompt from that safe summary, formats the model response, then appends a separate Admin-only OCR section from stored masked document summaries. Known privacy tokens are rehydrated only while building the authenticated Admin response; unknown legacy tokens become `[REDACTED]`. The Admin UI renders the OCR section beside each document and keeps the existing protected download action.

## Acceptance

- A completed OCR document contributes its document type, processing status, and exported OCR summary to the Admin CRM summary.
- Repeated greetings and duplicate requirement turns do not appear as separate requirements.
- The model-gateway request contains no OCR summary text or identity-document values.
- Salesforce-facing document descriptions remain metadata-only.
- Legacy records with stale placeholders produce a clean summary with redactions, not `CRM_SUMMARY_AI_UNAVAILABLE`.

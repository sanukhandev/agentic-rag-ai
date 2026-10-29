# ANCFZ seven-stage verification matrix

This matrix separates application behavior, local workflow execution, and independently verified external-provider evidence. A successful n8n execution is not treated as provider completion without a provider response and persisted Node-side evidence.

| Stage | Implemented boundary | Verified evidence | Mocked or blocked | Status |
|---|---|---|---|---|
| Lead Generation | Node authorization, tenant/session scope, PII masking, intent/catalog gating, durable action and outbox; n8n lead-capture workflow uses the existing Salesforce OAuth credential. | Live local API session; approved action; outbox publication; n8n execution reference; remote CRM lead response or deduplicated association; workflow tests pass. | Local n8n/Salesforce sandbox only; no production CRM claim. | PASS — sandbox evidence |
| Lead Qualification | Published intent catalog, required facts, consent gate, score/summary persistence and resume behavior remain Node-owned. | Live 20-turn qualification run persisted facts, consent, opportunity and pending requirement; n8n qualification gate and callback path exercised. | The QA runner previously joined only `crm_leads.action_id`; deduplicated runs use `crm_lead_associations`. The evidence query is corrected and must be rerun for a clean runner count. | PARTIAL — code and DB evidence |
| Account Creation | Account action requires qualified lead, verified remote lead identity, applicable confirmation and CRM prerequisites. | Static workflow test confirms the verified-ID gate and conditional conversion. | `REMOTE_CRM_ACCOUNT_URL` is not configured; no live Account conversion was attempted. | BLOCKED — provider configuration |
| Package Selection | Node journey/catalog state and pinned catalog data control package selection. | Existing journey and catalog regression coverage; no provider side effect is dispatched by Foundry text. | No live pricebook/provider acknowledgment in this run. | PARTIAL — application evidence |
| Document Upload | Upload consent, OCR/review state, SF-02 association and Node authorization boundaries are present. | Existing document/API/security tests and workflow definitions inspected. | No live Salesforce SF-02 acknowledgment was available in this run. | PARTIAL — no provider evidence |
| Payment Details & Invoice | Approved quotation/invoice state stays in Node; payment acknowledgment is separate from settlement. | Invoice workflow static test confirms bounded provider execution and reconciliation behavior. | `BILLING_INVOICE_URL` is not configured; development payment is mock-only; no payment was executed. | BLOCKED — provider configuration |
| Contract | Node requires verified signing evidence before completion; n8n is only an executor. | Contract workflow static test confirms bounded provider execution and reconciliation behavior. | `CONTRACT_PROVIDER_URL` is not configured; no signature was requested or claimed. | BLOCKED — provider configuration |

## Evidence scope

- Foundry conversational v4 remains frozen: named agent, tool-free serving version, Azure CLI credential, real Responses API output and continuity were verified separately.
- The existing Chat API and Admin API were not changed for this lifecycle work.
- No Salesforce, payment or contract completion is inferred from an n8n `success` status alone.
- Provider IDs, tokens and customer PII are intentionally excluded from this checked-in matrix.

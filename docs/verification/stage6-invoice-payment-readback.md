# Stage 6 — invoice issuance, delivery and verified payment

Status: **provider integration requires deployment configuration**. The Node authorization, readback contracts and Stage 7 proof gate are implemented, but no real invoices are sent and no real payments are settled until the tenant publishes an approved billing workflow and installs credentials. Never use the deterministic mock as financial proof.

## End-to-end contract

1. **Prerequisites:** Stage 5 document verification, verified Salesforce Account/Contact/Opportunity, customer-confirmed package selection, currently approved quote and matching price/currency. Node scopes every operation to tenant, session, opportunity, catalog version, stage, action revision and idempotency key. The quote is the authoritative amount; the model cannot set it.
2. **Issue:** `POST /api/v1/chat/sessions/:id/invoices` with `{ "opportunityId": "<UUID>", "quoteId": "<UUID>" }` creates or reuses the single draft invoice per tenant and quote and proposes the catalog-enabled `invoice.issue` action. After customer confirmation and required purpose consent, the outbox publishes an n8n event. Publishing/HTTP 202 is not issued/sent status.
3. **Generate and send:** n8n `06a-invoice-issue.json` calls a configured **billing provider** through managed credentials. The billing provider must generate the real PDF, store an immutable SHA-256 artifact, send the invoice to the authorized customer, and create a hosted HTTPS payment link. The provider returns an external invoice ID. Do not put billing PII or payment card details on the event bus.
4. **Verify invoice:** n8n sends the external invoice ID, action correlation and stage to `POST /api/v2/internal/provider-evidence/invoice`. Node independently retrieves `GET {V2_BILLING_READBACK_BASE_URL}/v1/invoices/{invoiceRef}` with its own bearer token. It verifies `deliveryStatus=sent`, invoice/quote/opportunity/tenant IDs, exact amount and currency, a SHA-256 document checksum and HTTPS hosted link. Only then does it persist the external invoice, link, `provider=billing_live`, `status=pending` and trusted delivery audit. The invoice sub-action completes; Stage 6 stays open.
5. **Payment:** Customer pays through the provider-hosted HTTPS link (never via model-provided bank/card inputs). `POST /api/v1/chat/sessions/:id/payments` requires `{ "opportunityId": "<UUID>", "invoiceId": "<UUID>", "paymentConfirmation": true }`, and creates the catalog-bound `payment.authorize` action. A customer statement is an authorization to check, **not proof** that money arrived.
6. **Settlement readback:** n8n `06b-payment-verify.json` submits the external payment reference and correlation to `POST /api/v2/internal/provider-evidence/payment`. Node independently requests `GET {V2_BILLING_READBACK_BASE_URL}/v1/payments/{paymentRef}`. Only `status=paid` with `settledAt`, exact invoice/reference/amount/currency/tenant/opportunity match and prior verified invoice delivery results in an immutable settlement audit, invoice `status=paid`, completed payment action and Stage 6 → Stage 7.
7. **Contract:** The contract route rejects any invoice without a completed, correlated, same-opportunity `payment.authorize` action and provider-record-verified settlement audit; it also checks approved quote, confirmed package and verified Account. Stage 7 generates a **draft** only; signed status is a separate signature provider readback.

## Trusted readback payloads (normalized by the tenant's billing gateway)

Invoice GET response:

```json
{
  "kind": "invoice",
  "provider": "billing_live",
  "tenantId": "<TENANT_UUID>",
  "opportunityId": "<OPPORTUNITY_UUID>",
  "quoteId": "<QUOTE_UUID>",
  "invoiceId": "<INVOICE_UUID>",
  "externalInvoiceId": "inv-external-123",
  "amountMinor": 150000,
  "currency": "AED",
  "artifactSha256": "<64-CHARACTERS-SHA256>",
  "deliveryStatus": "sent",
  "hostedPaymentUrl": "https://payments.example.com/checkout/abc"
}
```

Payment GET response:

```json
{
  "kind": "payment",
  "provider": "billing_live",
  "tenantId": "<TENANT_UUID>",
  "opportunityId": "<OPPORTUNITY_UUID>",
  "invoiceId": "<INVOICE_UUID>",
  "externalInvoiceId": "inv-external-123",
  "paymentId": "payment-external-123",
  "amountMinor": 150000,
  "currency": "AED",
  "status": "paid",
  "settledAt": "2026-11-11T09:00:00+04:00"
}
```

The billing gateway MUST independently obtain these records from the actual settlement authority; it cannot simply echo the n8n payload. The gateway must validate payment success and final settlement and reject failed, pending, refunded, expired, cancelled, partial or ambiguous payments. If refunds/chargebacks are later supported, revoke contract readiness from authoritative updated state.

## Deployment checklist

- Configure a real invoice/payment service (provider choice, invoice PDF template/numbering, billing address, invoice tax details from authoritative policy, email delivery provider, payment processor, webhook signing and chargeback/reconciliation policies).
- Supply Node environment `V2_BILLING_READBACK_BASE_URL=https://<approved-billing-gateway>` and `V2_BILLING_READBACK_TOKEN=<server-secret>`. Node uses fixed HTTPS readback URLs and does not accept arbitrary callback URLs. Prefer egress network allowlisting and TLS certificate validation.
- Replace both `https://configure-provider.invalid/...` POST/GET placeholders in the two **disabled** n8n workflows. Configure n8n managed Header Auth credentials and the Node internal secret; do **not** put credentials in version control.
- Publish a new V2 tenant catalog version binding `invoice.issue` and `payment.authorize` to their correct n8n workflow IDs, webhook paths and `providerType=billing_live`. Do not mutate published catalog versions or live sessions; pin new sessions to the new catalog version.
- Enable the n8n workflows only after the provider integration has been tested. No simulated proof may be used in production. Do not enable live payment authorization without proper customer consent and applicable payment/financial compliance review.
- Define an invoice receipt/email redelivery path, polling/retry path for still-pending payments, reconciler for ambiguous commits, and a refunded/chargeback reversal handling path before production rollout. A settlement readback should be verified against an authoritative processor ledger and reconciled with accounting.
- Monitor `invoice.live_delivery_verified` and `payment.live_settlement_verified` audits, timeout/reconciliation cases, duplicate messages, tenant-mismatched callbacks and external-provider outages. Never log payment card or bank details.

## Safety outcomes

| Condition | Invoice state | Contract allowed |
| --- | --- | --- |
| Draft invoice or PDF created, not delivered | Pending | No |
| Invoice sent, hosted payment link issued | Pending | No |
| User says "I paid" or n8n POST returns 200 | Pending | No |
| Payment pending/failed/partial/amount mismatch/unknown | Pending or reconciliation required | No |
| Deterministic mock reports `mock_paid` | Pending (simulation only) | No |
| Authenticated live readback verifies matching settlement | Paid | Yes, draft preparation only |
| Contract signing provider verifies signature | Paid | Contract may become signed after separate signature evidence |

## Testing

- `services/api/src/conversation/billing-readback.test.ts`: strict identity, delivery, amount, URL, settlement and HTTPS-only gateway tests.
- `services/api/src/business-stage6.test.ts`: no audit/no completed action, simulated provider, incorrect settlement amount, and positive real-payment proof gate.
- CI / integration must cover database updates, stage-CAS collision and retry semantics, provider 5xx/timeouts, n8n credential failures, duplicate/late payment notifications, service restart and two-tenant isolation **before** treating this as production-ready. The current work does not claim those integrations have run against a live provider.

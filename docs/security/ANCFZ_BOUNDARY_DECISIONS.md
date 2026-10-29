# Security decisions requiring implementation review

- Dedicated ANCFZ **does not mean** tenant filtering or customer session ownership can be removed; existing `tenant_id` remains a persisted security scope. Public other-tenant onboarding/admin features can be disabled after a validated migration.
- Managed n8n Salesforce credentials are existing operator-held secrets; the tool cannot access their values. Bind the workflow credential reference in n8n and test sandbox access, scope and expiry. No credentials in GitHub or exported JSON.
- Some existing exports use `$env.N8N_WEBHOOK_SECRET` and a raw PII path. Review and replace with managed n8n credentials and narrowly approved internal data processor before activating in the dedicated deployment.
- PDF renderer must not be publicly exposed. Input to renderer must be approved, schema-validated, versioned data from Node. Private files retained per approved policy; SHA-256 bound to quote/invoice version.
- Payment mock must NEVER collect credit card, CVV, bank account/password, or payment credentials. It must have a separate `mock_paid` status; production paid remains false.
- Customer identity-document OCR and external Salesforce attachment are distinct consent purposes. Customer uploads are not RAG ingestion sources unless separately approved and sanitized.
- Stage-scoped consent, action CAS, outbox idempotency, provider reconciliation and callback signature verification are release blockers, not optional enhancements.
- No silent mass deletion of code: first run a reference search and tests, prepare a file removal map, ensure protected features still pass and remove only independently proven unused code.

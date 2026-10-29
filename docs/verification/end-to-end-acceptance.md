# End-to-end acceptance

## Executed checks

- Remote branch fetch and head verification: passed.
- API/PostgreSQL Docker suite: 277 passed, 1 Redis-gated test skipped.
- API typecheck, lint and build: passed.
- Workspace production build: passed.
- Live health: `/api/v1/health/live` and `/api/v1/health/ready` passed.
- Focused API app suite: 45 passed.
- Live agentic harness run `f52f8203-b955-40d6-8de6-a4490f2beb63`: eight scenarios, 205 customer turns, 205 assistant responses, 631 assertions passed.
- Browser smoke: passed through the Docker-served web chat; Zara response and verified-source rendering observed.
- n8n workflow contract tests: account conversion, invoice and contract definitions passed.
- Execution 1488 root cause: `LEAD_ALREADY_LINKED`; the existing-identity reconciliation path is now covered.

## Mandatory gates not passed

Remote Salesforce Account conversion is not verified because `REMOTE_CRM_ACCOUNT_URL` is unset. Invoice and contract provider completion are not verified because `BILLING_INVOICE_URL` and `CONTRACT_PROVIDER_URL` are unset. External OCR completion is also not independently verified. The correct verdict is `CONVERSATION VERIFIED — EXTERNAL GATES REMAIN`.

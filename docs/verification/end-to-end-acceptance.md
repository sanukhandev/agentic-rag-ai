# End-to-end acceptance

## Executed checks

- Remote branch fetch and head verification: passed.
- API full suite: 194 passed, 10 skipped (PostgreSQL/Redis integration cases skipped by the direct Vitest command).
- API typecheck, lint and build: passed.
- Workspace production build: passed.
- Live health: `/api/v1/health/live` and `/api/v1/health/ready` passed.
- Existing live conversation artifact: 20 customer turns, context continuity and masking assertions passed; Salesforce Lead completion and callback completion failed with `reconcile_required`.

## Mandatory gates not passed

The eight independent 25-message scenarios, 200-message minimum, verified Salesforce conversion, package selection, OCR completion, invoice, contract draft and browser acceptance were not executed successfully. The correct verdict is `PARTIALLY VERIFIED — ACCEPTANCE FAILURES REMAIN`.

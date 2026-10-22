# CRM omnichannel conversation v2 verification report

Date: 22 October 2026
Branch: `feature/crm-omnichannel-conversation-v2`
Tenant fixture: `anc-test`
Tracking: [issue #45](https://github.com/sanukhandev/agentic-rag-ai/issues/45)

## Scope and source traceability

- Source ZIP: 8 DOCX files, SHA-256 `480d6579ec7b43141d6f015a58d769b6fdd64df1af5cf1756326f0fe5fe76fe1`.
- Source workbook: SHA-256 `71755f426c1bf52d57e97ffad6001d0b395ce2e52516e69bdc2d8d060d5b160b`.
- Generated intent workbook: draft-only, tenant-scoped to `anc-test`, 15 intents, 195 signals and 6 slots. All generated bindings are inactive until real n8n IDs and tenant approval exist.
- Training ZIP: `artifacts/anc-test/anc-test-rag-training-package.zip`, containing the two workbooks, manifest, test cases, report and 8 redacted source artifacts.

## Implementation evidence

| Area | Evidence |
| --- | --- |
| Durable chat state | PostgreSQL migrations `028-conversation-state.sql` and `029-crm-secondary-intents.sql`; MemoryStore/Postgres tests passed. |
| Prompt handling | Server-side `pendingPrompt`, prompt IDs, slot merge, postback input and prompt mismatch rejection are covered by API/catalog tests. |
| CRM policy | Deterministic score and contact validators in `services/api/src/crm-scoring.ts`; internal CRM route rechecks consent, tenant, score and hard gates. |
| n8n | CRM-01/02/03, DOC-01 and 13 intent-neutral JSON exports are inactive, authenticated and secret-free. Existing ANC Lead Capture WF-1 remains present and provider endpoint/credentials stay outside source. |
| OCR | Existing Python/Tesseract document path remains tenant-scoped; OCR/document tests and Python suite passed. |
| Omnichannel | Text/postback/attachment contract fields and `replyToPromptId` are accepted at the backend boundary; tenant-scoped channel authentication remains in place. |
| Admin UX | Action outcome remains visible after approval; catalog extension fields are preserved by import/edit validation. |

## Commands and results

- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm test` — passed: 132 tests, 1 expected skip; API 91 passed/1 skipped.
- `npm run build` — passed for Angular admin, Next web, API and shared packages.
- `npm run verify:compose` — passed.
- `npm run verify:secrets` — passed; 271 files scanned.
- `npm run verify:secrets:test` — passed: 2/2.
- `npm run acceptance:seed` — passed: tenant A/B isolation and idempotent approval.
- `npm run acceptance:local` — passed: TXT, DOCX, XLSX, PDF, HTTPS snapshot and grounded chat.
- Python `pytest` — unavailable because the provided venv does not install pytest; `python -m unittest discover -s tools/ingestion -p "test_*.py"` passed: 24 tests.
- Existing n8n tests plus `crm-v2-workflows.test.mjs` — passed.
- `docker compose build api admin web ingestion` and `docker compose up -d api admin web ingestion` — passed. API ready, web/admin HTTP 200, no browser console errors.

## Browser smoke evidence

Local Chrome was run against `http://127.0.0.1:3000/?tenant=anc-test` after the final image rebuild. Sara resumed the existing session after refresh and answered a commercial request with source-backed text and targeted questions: visa count, licence duration and business activity. The browser DOM showed verified-source counts, the tenant/persona identity and no console errors. The first run exposed missing persistent migrations; applying 028/029 fixed session creation and the same journey passed.

The browser smoke used the existing published local catalog. The newly generated workbook remains draft-only and was not imported or published, as required by the master prompt.

## Provider classification and blockers

Mock/local: API, MemoryStore/Postgres contracts, deterministic scoring, OCR tests, workflow export validation, idempotency and browser/Docker smoke.

Live/unverified: no authorized n8n import/activation was performed; no Salesforce client credentials or real Apex response were available. Therefore Salesforce creation, returned record-ID write-back, ambiguous timeout reconciliation and live n8n execution remain blocked. No live IDs or success claims were fabricated.

The issue remains open and no ready-for-review PR is opened until the approved n8n credentials, Salesforce sandbox response and the remaining live security/acceptance gates are available.

## Rollback and safety notes

The change is isolated to the feature branch. The two migrations use `ADD COLUMN IF NOT EXISTS`; generated catalogs are drafts; workflow exports default to inactive; Salesforce secrets are not in code, JSON or logs. Rollback is the normal reviewed database migration rollback procedure plus reverting the feature branch commits; no tenant data was reset or deleted.

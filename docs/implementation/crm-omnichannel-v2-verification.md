# CRM omnichannel v2 verification

This report records executable checks and the subsequent authorized local n8n/Salesforce smoke. It does not claim production deployment or production traffic.

## Source inputs

- Tenant fixture: `anc-test` (passed as a command argument; not a global backend constant).
- Supplied ZIP: 8 DOCX sources, SHA-256 `480d6579ec7b43141d6f015a58d769b6fdd64df1af5cf1756326f0fe5fe76fe1`.
- Supplied workbook: SHA-256 `71755f426c1bf52d57e97ffad6001d0b395ce2e52516e69bdc2d8d060d5b160b`.
- Source-derived package: 8 redacted review-only sources and 991 deterministic chunks.

## Implemented locally

- Durable conversation state, prompt IDs, consent state and workflow status in MemoryStore/Postgres.
- Catalog-driven text/postback continuation, latest-value merge and one-question-at-a-time prompting.
- Deterministic 0–100 CRM score and contact validation.
- Parser support for catalog extension sheets.
- Inactive tenant-neutral n8n exports for CRM-01/02/03, DOC-01 and 13 source intent keys.
- Source-derived intent/content catalogs and training ZIP. The updated workbook validates as tenant `anc-test` with 15 intents, 195 signals, 6 slots and all five extension sheets.

## Checks

The release-gate results below are from the local run on 22 Oct 2026:

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `npm run typecheck` | passed |
| Unit/integration | `npm test` | passed: 132 tests, 1 expected skip; API 91 passed/1 skipped |
| Build | `npm run build` | passed |
| Compose/security | `npm run verify:compose`, `npm run verify:secrets`, `npm run verify:secrets:test` | all passed |
| Python ingestion/OCR | `tools/ingestion/.venv/Scripts/python.exe -m pytest -q tools/ingestion` | pytest unavailable in the venv; fallback `unittest discover` passed: 24 tests |
| Workflow export tests | existing workflow tests plus `infra/n8n/workflows/crm-v2-workflows.test.mjs` | passed; exports are inactive and secret-free |
| Catalog/artifacts | source generator, artifact-tool inspection, parser and TypeScript validation | passed; package contains 14 deliverables, SHA-256 `6935f15d497fab0bd74d6bfd788211706f786416b0a7b6612237f4f27b84ad6d` |
| Browser/Docker | `docker compose build api admin web ingestion`, restart, health checks and local Chrome smoke flow | passed after applying migrations 028/029; chat session creation, published ANCFZ intent response and one-question clarification verified |
| Acceptance | `npm run acceptance:seed`, `npm run acceptance:local` | both passed; tenant A/B isolation, idempotent approval and five-source ingestion/grounded chat verified |
| Authorized CRM smoke | Local Chrome synthetic callback journey → active n8n execution `584` → PostgreSQL | passed; n8n completed in 5.135s, Salesforce returned a validated Lead ID, and the same tenant lead row is `completed`, score 95 and `remote_crm=salesforce` |

## External blockers

The authorized local n8n instance and Salesforce sandbox happy path are now verified. OAuth failure, missing-ID and ambiguous-timeout cases were not induced against the live sandbox; retain the existing negative tests and run those cases in a controlled staging environment before production. The generated source catalog and bindings remain draft/inactive by design.

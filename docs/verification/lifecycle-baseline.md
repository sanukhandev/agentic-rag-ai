# ANCFZ lifecycle baseline

Date: 2026-10-29
Branch: `feat/ancfz-seven-stage-lifecycle-acceptance`
Bootstrap SHA: `c863f5fcfc189a460688e4815cce4080b70de598`
Main baseline: `c4a807c60801fe66cdb34199d1cb9aaee86a9409`

## Repository and candidate comparison

The feature branch initially contained the ANCFZ delivery prompts and plan, but no
ANCFZ lifecycle implementation. The candidate lifecycle branch was reviewed at
`20e3dd81b4d562afa9bcfedbd6f4d0f31b194ebc` and the retrieval-continuity branch at
`7245f6f`. The candidate adds journey identity, lifecycle types/routes, migrations
044–052, n8n templates and API harnesses. Its own evidence explicitly leaves live
Salesforce conversion, document association, invoice-provider completion, signing,
and fresh-source ingestion unverified; those remain acceptance blockers.

## Current status at baseline

| Area | Status | Evidence |
| --- | --- | --- |
| Existing Node/API, web, admin and tenant security | IMPLEMENTED | Existing source and test suite |
| Source-grounded retrieval and masking | IMPLEMENTED / UNVERIFIED for fresh ZIP | Existing tests; fresh ZIP only preflighted |
| ANCFZ starter artifacts | IMPORTED | Commit `2058628`; archive SHA recorded in delivery manifest |
| ANCFZ seven-stage state and external identities | MISSING on this baseline | Candidate branch reviewed, not yet integrated |
| Salesforce/n8n live provider effects | BLOCKED | Managed credentials and sandbox evidence unavailable to this checkout |
| Quote/invoice PDFs | MOCK-ONLY | Starter ReportLab service explicitly accepts `mode=MOCK` only |
| Payment | MOCK-ONLY | Development SQLite/HTTP mock; no card data accepted |
| Contract signing | BLOCKED | No approved signing provider or verified callback configured |

## Checks executed

- `npm test`: PASS, 22 test files; 187 tests passed and 8 existing PostgreSQL/
  Redis tests skipped because those services were not running.
- `python -m unittest discover -s tools/anc -p 'test_*.py'`: PASS after the
  imported workflow test was scoped to its three named starter workflows.
- `python tools/anc/validate_catalog_review.py`: PASS; 8 intents, 23 signals,
  9 inactive bindings and 7 proposed stages; publication remains disabled.
- `python tools/anc/ingestion/prepare_local_rag.py --zip OneDrive_1_23-10-2026.zip
  --out data/ancfz-review`: PASS; 18 eligible members staged, 1 rejected member,
  ZIP SHA-256 `5a0d6f5f50809ec562f46125279304d9be918b88be92fadbe60f2d0919ce237`.
  This is preflight only, not ingestion or publication.

## Required follow-up gates

Fresh document extraction and review, real embedding writes to isolated pgvector,
catalog parser support for ANCFZ stage metadata, durable seven-stage persistence,
provider callback verification, one uninterrupted 25+ turn API session, eight
scenario/200-turn coverage, browser acceptance, and real Salesforce/n8n/invoice/
signing evidence remain to be implemented or executed. No completion claim is
made by this baseline.

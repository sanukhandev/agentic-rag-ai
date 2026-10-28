# ANCFZ development acceptance report

Date: 2026-10-29  
Branch: `feat/ancfz-seven-stage-lifecycle-acceptance`  
Bootstrap: `c863f5fcfc189a460688e4815cce4080b70de598`  
Implementation commits after bootstrap: >25 (threshold verified with
`git rev-list --count c863f5fcfc189a460688e4815cce4080b70de598..HEAD`)

## Result

**PARTIALLY VERIFIED — local application gates pass; external and fresh-source gates remain blocked.**

This is not the requested `DONE — ANCFZ DEVELOPMENT E2E VERIFIED` status. No
Salesforce, n8n, payment, signing, or fresh-source publication claim is made.

Continuation commit references: security remediation `70bbf2b`, patched-API
conversation rerun `5f77cfe`, and acceptance evidence updates `231ad79`,
`7b35d81`, `51a7645`. The final local audit, secret scan and Compose checks
were run from the clean branch tip after these commits.

## Verified locally

- Starter archive SHA-256: `24fd7b46e92eee67a120371593cc6d263f2f50875edbcebd98a863f9d75c3885`.
  Safe archive inspection passed; 29 non-conflicting artifacts were imported.
- Fresh source archive SHA-256:
  `5a0d6f5f50809ec562f46125279304d9be918b88be92fadbe60f2d0919ce237`.
  Safe preflight found 18 eligible members and one rejected unsupported
  `knowledge_records.jsonl` member.
- Docker Python extraction: 18/18 eligible files, 1,678 deterministic chunks,
  zero extraction warnings. DOCX headings and table-row locators are retained.
  No raw source text was committed.
- Database backup completed before migration. Migration 053 applied successfully
  after the local backup; lifecycle table count is 7, pgvector is 0.8.7, and
  revoked starter package rows are not available for customer selection.
- Correct Docker PostgreSQL test path after the dependency upgrade:
  `docker compose -f docker-compose.yml -f docker-compose.test.yml run --rm --build api-test`
  — 43 test files passed, 1 optional Redis test file skipped, 284 tests passed,
  1 skipped. The workspace `npm test`, typecheck, lint and production builds
  also passed after the upgrade.
- Workspace tests before the Docker aggregate: admin 45, web 14, API 209/11
  skipped, chat-utils 3, contracts 3. Compose verification and the repository
  secret scan passed.
- Production dependency audit is clean after upgrading the API runtime to
  `body-parser@2.4.0` and `zod@4.6.7`:
  `npm audit --omit=dev --audit-level=high --json` reports zero vulnerabilities.
  The redacted package audit evidence is [full audit JSON](../../artifacts/ancfz/npm-audit-final-2026-10-29.json)
  and [production audit JSON](../../artifacts/ancfz/npm-audit-prod-final-2026-10-29.json).
- The two production high advisories were:
  - `GHSA-27r3-jxmh-p828` (`body-parser`, CVSS 7.5): a network-reachable
    denial of service when trailing bytes follow a compressed request body.
    The affected runtime tree was `express@5.3.0 -> body-parser@2.3.0`, range
    `>=2.0.0 <2.4.0`; `body-parser@2.4.0` is now installed directly in the API
    workspace to pin the patched transitive runtime.
  - `GHSA-mrhx-c7xc-m3w5` (`zod`, CVSS 7.5): memory exhaustion while validating
    oversized constrained collections supplied at an untrusted boundary. The
    affected direct API/contracts dependency was `zod@3.25.76`, fixed from
    `4.6.6`; `zod@4.6.7` is now installed. Zod 4 compatibility changes preserve
    the prior GUID-shaped identifier contract and all tests pass.
- The unfiltered `npm audit --json` remains non-zero only for development
  tooling: 1 low, 9 moderate, 5 high and 2 critical findings. The remaining
  high findings are in Angular CLI, MCP SDK, nested development `body-parser`,
  undici and Vite; the two critical findings are in Vitest/tinypool. npm's
  available remediation for the Vitest findings is the major upgrade to
  `vitest@5.0.5`. The current Angular compiler CLI has no matching
  `21.2.29` release, so no broad or incompatible dev-tooling upgrade was
  applied. These packages are not in the production dependency set.
- Starter workflow tests 2/2; fresh-RAG preflight tests 4/4; mock payment tests
  5/5; PDF renderer tests 4/4.
- PDF fixture inspection passed: `quote.mock.pdf` and `invoice.mock.pdf` each
  contain one extractable page. Quote SHA-256 is
  `b991315a0d212d9a0104418cecd91b5ff7f721570996353d49ce8da89ab5427e` and
  invoice SHA-256 is
  `c82d5c21e43455d12b1d1d7a58271f59f92d328380709b9d7bdc08a5a7e6a96f`.
  These are mock fixtures, not customer journey outputs.
- Real HTTP conversation harness passed against the local deployed API and
  tenant `anc`: one session with 25/25 answered and durable turns, then eight
  sessions with 200/200 answered and durable turns. Redacted status artifacts:
  [25-turn evidence](../../artifacts/ancfz/api-25-turns-local.json) and
  [200-turn evidence](../../artifacts/ancfz/api-200-turns-local.json).
- The same harness was rerun after rebuilding the API with the security fixes:
  25/25 in one uninterrupted session and 8/8 scenarios totaling 200/200,
  each with durable history. Post-upgrade evidence:
  [25-turn evidence](../../artifacts/ancfz/api-25-turns-after-security-2026-10-29.json)
  and [200-turn evidence](../../artifacts/ancfz/api-200-turns-after-security-2026-10-29.json).
- Browser smoke passed on `http://localhost/?tenant=anc`: ANC persona loaded,
  a non-PII knowledge query returned an answer, and the UI rendered “4 Verified
  Sources.” The admin surface loaded the ANC organization and protected CRM
  view.

## Blocked or not verified

- Fresh ZIP contents are not approved or published into the tenant knowledge
  store. The live database still contains one pre-existing active source and
  2,057 1,536-dimensional chunks; these are not evidence of fresh ZIP ingestion.
  No fresh source embedding write is claimed.
- The checkout did not provide authorized local administrator credentials. The
  existing database contains one platform admin and two tenant admins, so no
  new account was created and no destructive reset was performed. Creating a
  password or deleting existing users would violate the requested controls.
- Salesforce sandbox Account, Contact, Opportunity, document associations and
  seven-stage object IDs were not independently verified for this run. Existing
  local CRM records do not substitute for a new controlled acceptance journey.
- Imported n8n exports and local workflow tests do not prove active credentialed
  execution. Quote, invoice, document, conversion and contract callbacks were
  not verified against live n8n/Salesforce dependencies.
- Payment and signing remain explicitly mock/development-only. No real card data
  was collected and no production payment or signing provider was contacted.
- The unfiltered audit is not fully clean because of the explicitly documented
  development-only findings above. The production audit is clean.
- `npm run verify:local` is not green in this checkout because its host process
  targets `127.0.0.1:54329`, while the Compose PostgreSQL service is intentionally
  internal-only. Its 10 host-side PostgreSQL failures are connection refusals;
  the Docker test command above passes the same database integration coverage.

## Delivery decision

Do not push or open a draft pull request yet. The 25-commit threshold is met, but
the required fresh-source approval/embedding evidence, authorized single-admin
setup, live Salesforce/n8n verification, payment callback evidence, and contract
signing evidence are not available in this checkout.

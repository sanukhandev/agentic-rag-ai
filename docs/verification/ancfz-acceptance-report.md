# ANCFZ development acceptance report

Date: 2026-10-29  
Branch: `feat/ancfz-seven-stage-lifecycle-acceptance`  
Bootstrap: `c863f5fcfc189a460688e4815cce4080b70de598`  
Implementation commits after bootstrap: >25 (threshold verified with
`git rev-list --count c863f5fcfc189a460688e4815cce4080b70de598..HEAD`)
Evidence update commit: `b0cc27f` (`docs(ancfz): record live Salesforce blocker evidence`)

## Result

**PARTIALLY VERIFIED — fresh-source publication and single-admin gates pass; live Salesforce/provider execution remains unverified.**

This is not the requested `DONE — ANCFZ DEVELOPMENT E2E VERIFIED` status. The
Salesforce sandbox and provider-backed seven-stage journey are not claimed.
Payment and signing evidence below is explicitly development-only mock evidence.

Continuation commit references: security remediation `70bbf2b`, patched-API
conversation rerun `5f77cfe`, and acceptance evidence updates `231ad79`,
`7b35d81`, `51a7645`. The final local audit, secret scan and Compose checks
were run from the clean branch tip after these commits.

The final live Salesforce-path investigation is recorded in [redacted runtime
execution evidence](../../artifacts/ancfz/salesforce-runtime-execution-2026-10-29.json).
The n8n database contains one managed `oAuth2Api` credential named `SalesForce
ANC - CREDS`; its secret data was not exported. The sandbox Lead endpoint host
and Apex REST path are configured, but the Account endpoint binding is absent.
Three synthetic Node-authorized actions reached n8n and ended in durable
`reconcile_required` state after HTTP 400 `INVALID_DATA` from the internal
reconciliation branch. No Salesforce remote ID or independent Salesforce
readback was observed, so these executions do not satisfy the Salesforce gate.

## Verified locally

- Starter archive SHA-256: `24fd7b46e92eee67a120371593cc6d263f2f50875edbcebd98a863f9d75c3885`.
  Safe archive inspection passed; 29 non-conflicting artifacts were imported.
- Fresh source archive SHA-256:
  `5a0d6f5f50809ec562f46125279304d9be918b88be92fadbe60f2d0919ce237`.
  Safe preflight found 18 eligible members and one rejected unsupported
  `knowledge_records.jsonl` member. The 18 eligible members extracted into
  1,714 deterministic chunks with zero parser warnings; DOCX headings and
  table-row locators were retained and no raw source text was committed.
- Content review classified the 16 DOCX business sources as approved for ANCFZ
  public chat. `knowledge_registry.csv` and `README.txt` were ingested for
  review but revoked because they are metadata/draft-governance material, not
  approved business sources. The unrelated pre-existing `latest file test`
  source was also revoked from the isolated ANCFZ tenant.
- Fresh RAG publication is now verified in the real PostgreSQL/pgvector store:
  16 active/public fresh sources, 1,467 active fresh chunks, 16 distinct
  source IDs, and vector dimensions min=max 1,536. The configured Azure
  `text-embedding-3-large` endpoint returned finite 1,536-dimensional vectors
  during a live connectivity probe. Redacted source-by-source evidence is
  [fresh RAG evidence](../../artifacts/ancfz/rag-fresh-acceptance-2026-10-29.json).
- Real API retrieval probes returned citations from the fresh source IDs for
  business activity, contact, FAQ, licensing, packages, rules, strategic
  partners and company-type questions. An unrelated Mars-fact question
  returned `grounded=false` with no citations. Answers and source text were
  omitted from the committed evidence artifact.
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
- Final rerun: unfiltered audit reported 1 low, 9 moderate, 5 high and 2
  critical findings; production-only audit reported zero vulnerabilities. The
  critical paths are direct workspace `vitest@3.2.7` through `tinypool@1.1.1`
  and npm's available fix is the major `vitest@5.0.5`. High paths are
  development Angular CLI/MCP SDK, nested development `body-parser@1.20.8`,
  `undici` and Vite. Their fixes require broad toolchain changes or are not in
  the deployed runtime, so they were not applied during this acceptance run.
  Exact rerun artifacts are [full audit rerun](../../artifacts/ancfz/npm-audit-final-rerun-2026-10-29.json)
  and [production audit rerun](../../artifacts/ancfz/npm-audit-prod-rerun-2026-10-29.json).
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
- Secure administrator bootstrap completed in the isolated development
  database after creating a custom-format PostgreSQL backup
  (`data/ancfz-backups/ancfz-pre-admin-bootstrap-20261029.dump`, 15,107,745
  bytes). The two unnecessary tenant-admin rows were removed; the resulting
  database count is exactly one platform administrator, zero tenant
  administrators and one total user. Protected login, `/auth/me`, platform
  overview authorization and anonymous HTTP 401 rejection all passed. The
  generated credential is held only in the ignored local
  `data/ancfz-admin-bootstrap/credentials.json`; no password is committed or
  printed. Redacted counts and backup evidence are in [admin bootstrap
  evidence](../../artifacts/ancfz/admin-bootstrap-final-2026-10-29.json).
- Final local regression gates after the database changes: `npm test` passed
  with 284 tests and one skipped; `npm run typecheck`, `npm run lint` and
  `npm run build` passed. The Docker PostgreSQL aggregate passed 43 test files,
  284 tests and one skipped. Workflow tests passed 2/2, mock payment tests
  passed 5/5, fresh-RAG preflight tests passed 4/4, and the PDF renderer passed
  4/4 in its dependency-complete Docker test image.
- n8n internal `/healthz` and `/healthz/readiness` returned `{"status":"ok"}`.
  The active workflow names and non-secret runtime inspection are recorded in
  [n8n runtime evidence](../../artifacts/ancfz/n8n-runtime-final-2026-10-29.json);
  no credential secret or exported customer payload was written.
- The loopback-only mock payment HTTP adapter was independently smoke-tested:
  authenticated creation returned `pending`, the same idempotency key reused
  the same payment ID, protected settlement returned `mock_paid`, and replay
  remained at version 1. The private PDF HTTP adapter returned a mock quote
  artifact with a 2,468-byte PDF and a 64-character SHA-256. These are adapter
  checks only, not Node/n8n lifecycle completion.

## Blocked or not verified

### P0 runtime failure reconciliation — 2026-10-29

- Executions `3977`, `4008` and `4022` were inspected node-by-node. All three
  failed at `Reconcile Existing CRM Lead` with HTTP 400 `INVALID_DATA`; the
  redacted request IDs, action IDs and local lead IDs are in the [P0 root-cause
  evidence](../../artifacts/ancfz/salesforce-runtime-root-cause-2026-10-29.json).
- The exact failing request was `/api/v1/internal/crm/leads/undefined/remote-reconcile`.
  The API issued the response because PostgreSQL rejected parameter `$1` in
  `SELECT * FROM crm_leads WHERE id=$1 AND tenant_id=$2` with SQLSTATE `22P02`:
  the UUID column received the string `undefined`. The cause was an inverted
  n8n IF connection: the false/unlinked branch was wired to reconciliation.
- The workflow is now active with false/unlinked leads routed to
  `Remote CRM Create Lead` and true/linked leads routed to reconciliation. The
  API also validates the route ID as a UUID before database access. Targeted
  workflow regression tests pass 3/3 and targeted API CRM tests pass 3/3.
- No provider write was reached in any of the three original executions: all
  local remote IDs remain blank and no remote-link audit event exists. A
  read-only Salesforce REST query through the managed n8n credential succeeded
  in execution `4337` and returned a redacted Lead count of 143; this is
  connectivity evidence, not proof of a specific customer Lead write.
- An audited retry transition preserves the original action idempotency key and
  uses a unique transport event. A fresh retry reached the internal CRM-upsert
  path before the provider node; replay of the historical session is now blocked
  by the configured 15-minute token TTL, so no stale customer data is reused.
  The controlled same-action retry was n8n execution `4387`; it ended
  `reconcile_required` with no provider Lead ID and no provider write.
  A fresh authorized synthetic session is still required for provider-verified
  Lead creation and the remaining Salesforce lifecycle.

- Salesforce sandbox Lead creation/qualification, Account/Contact/Opportunity
  writes, package/quote linkage, SF-02 attachment and independent remote-ID
  reconciliation remain unverified. The n8n runtime is healthy and
  `n8n list:workflow --active=true` reports four active workflows (lead,
  account conversion, invoice generation and contract preparation), but active
  status is not provider completion evidence. The runtime exposes no billing
  or contract provider URL variables, and no independently queryable Salesforce
  sandbox result was obtained without a verified provider test path. The
  live Lead attempts are now independently evidenced: the managed credential
  reference exists, but the active workflow reached `Reconcile Existing CRM
  Lead` with an absent canonical remote identity and the internal API returned
  `INVALID_DATA`; the local action was correctly held at `reconcile_required`.
- The checked-in quote/PDF and mock-payment workflows remain inactive templates
  that require their secured internal endpoints and private service bindings.
  Mock unit tests and provider-callback tests pass, but an actual Node→n8n→mock
  payment callback and a durable `MOCK_SIGNED` contract callback were not
  executed. No real card data, payment settlement or legal signature was
  claimed.
- The unfiltered audit is not fully clean because of the explicitly documented
  development-only findings above. The production audit is clean.
- `npm run verify:local` is not green in this checkout because its host process
  targets `127.0.0.1:54329`, while the Compose PostgreSQL service is intentionally
  internal-only. Its 10 host-side PostgreSQL failures are connection refusals;
  the Docker test command above passes the same database integration coverage.

## Delivery decision

Do not push or open a draft pull request yet. The 25-commit threshold, fresh
RAG publication and single-admin setup are complete, but provider-verified
Salesforce state and the actual runtime mock payment/contract callback evidence
remain mandatory blockers. The branch therefore remains **PARTIALLY VERIFIED**.

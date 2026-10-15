# Implementation progress

Status: in progress (local MVP vertical slice; no VM deployment)

The complete feature brief, execution plan, acceptance matrix and master prompt arrived in remote commit `6582f7d` while the initial implementation was being prepared. They are now present and have been read; they supersede the earlier baseline assumption that only docs `01–14` existed. This file records actual implementation and verification; a checked box means the corresponding command or test was executed successfully.

## Phase gates

- [x] P00: repository audit, security constraints, spec set and threat review
- [ ] P01: workspace, API, UI, database migration, ingestion and CI foundation (clean `npm ci --dry-run`, local gates and CI workflow are valid; hosted run not observed)
- [ ] P02: validated source ingestion, versioning, approval and retrieval (durable job state/lease/retry, authenticated worker-result boundary, tenant-admin TXT/PDF/DOCX/XLSX upload to private Node staging, Python worker retrieval/extraction, SQL vector filtering/order, transactional reindex-to-review, explicit source version history, guarded revoked-source purge and approved HTTPS worker snapshots added; production staging/object storage, retention policy, malware scanning and production embedding remain)
- [x] P03: tenant-aware chat, PII masking, citations and fail-closed model boundary (synthetic API gate passing; conflict refusal, scoped history, invalid-citation abstention, numeric claim verification, permitted-language refusal, tenant domain management and configured public chat-origin binding verified)
- [x] P04: guarded, confirmed, idempotent mock/private n8n action (unit/API gate passing; durable callback nonce replay guard added; live n8n blocked)
- [ ] P05: admin operations, audit, observability and security regression coverage (platform/tenant metrics including ingestion state, RBAC, lifecycle, rate limits, CORS, callback replay guard, durable admin session revocation, tenant session purge, local backup/restore rehearsal and redacted request telemetry added; production observability remains)
- [x] P06: PII vault and conversation API (AES-GCM session vault, structured-name masking, lazy token expiry purge, session expiry/purge, rate limiting and Postgres persistence verified; production KMS-backed vault remains open)
- [ ] P07–P10: full persona/version workflow, operations hardening, clean-room acceptance and go-live review (persona draft/publish/version API, grounded preview API/UI, history/publish/rollback and tenant domain UI added; final operations remain)

## Decisions for this local vertical slice

- npm workspaces with Node 22 and TypeScript strict mode.
- A deterministic 8-dimensional embedding double is used locally; the production embedding deployment and dimension remain configurable and must be selected before real data. The pgvector migration is explicitly marked local-demo-only.
- In-memory repositories make unit and deterministic end-to-end tests repeatable. A parameterized PostgreSQL/pgvector adapter and migration are included for integration and deployment work.
- Azure AI Foundry and n8n are injectable adapters. Tests use deterministic model and private mock workflow doubles; no live credential or production call is claimed.
- Authentication is a signed development JWT boundary with RBAC and tenant resolution. Production SSO/MFA/KMS decisions remain open.
- The admin and web applications call only the Node API; secrets are server-side.

## Acceptance evidence ledger

This section is updated after verification. No scenario is marked passing from source inspection alone.

| Scenario | Evidence | Status |
| --- | --- | --- |
| Two tenants remain isolated during retrieval | `services/api/src/app.test.ts` | pass (memory store) |
| Tenant admin can approve and revoke a source | `services/api/src/app.test.ts` | pass (memory API) |
| PII is masked before model/embedding/workflow boundaries | `privacy.test.ts`, `embedding.test.ts`, API model-spy test, PostgresStore session test | pass for local adapters; live provider blocked |
| Structured name, email and phone masking | `privacy.test.ts` token-vault boundary assertions | pass for supported phrase patterns; general name detection remains a production classifier decision |
| Approved evidence is cited | API integration test | pass (deterministic model) |
| Unsupported facts are refused | API integration test | pass |
| Invalid model citation cannot publish an ungrounded answer | `app.test.ts` invalid-citation model test | pass |
| Valid citation cannot support an invented numeric claim | `app.test.ts` and `model.test.ts` evidence-sufficiency tests | pass |
| Unsupported chat language is refused before model call | `app.test.ts` + `model.test.ts` language tests | pass for Arabic/English family detection |
| Persona draft/publish/version history and preview | API app test, PostgreSQL version/publish assertion, grounded preview route/model contract, migration `012-persona-versions.sql` and Angular version/preview panels | pass locally; manual browser verification pending |
| Prompt injection in source is treated as data | model prompt contract plus API test where injected evidence proposes a lead without explicit user intent | pass for the local deterministic/mock boundary; broader adversarial corpus remains a production hardening task |
| Conflicting active evidence is not chosen arbitrarily | `knowledge.test.ts`, API conflict guard | pass (numeric contradiction heuristic) |
| Confirmed action is idempotent and audited | `actions.test.ts`, API integration test | pass (mock adapter) |
| Callback replay is rejected across store-backed instances | API callback replay assertion plus `claimCallbackNonce` memory/PostgreSQL tests and migration `011-callback-nonces.sql` | pass locally; live n8n blocked |
| Next web chat flow builds | `npm run build` | pass |
| Angular admin flow builds | `npm run build` | pass |
| Frontend unit checks | `apps/admin/src/app/upload-utils.test.ts`, `apps/web/app/chat-utils.test.ts` | pass (1 admin + 1 web test; no browser automation) |
| Python ingestion tests pass | `tools/ingestion/test_ingestion.py` | pass (13 tests, local venv via `unittest`; pytest is not installed) |
| PostgreSQL/pgvector persistence smoke | `services/api/src/store-postgres.test.ts` with `DATABASE_URL` | pass (local container) |
| Ingestion job state and lease persistence | API job assertion and `store-postgres.test.ts` with migration `008-ingestion-jobs.sql` | pass (memory + PostgreSQL) |
| Authenticated worker result boundary | `app.test.ts` worker flow; hash, ordinal and locator validation | pass (synthetic Python result) |
| Python file-to-API worker client | `tools/ingestion/test_ingestion.py` worker submission test | pass (mock transport) |
| Tenant-admin binary file upload bridge | API upload test, `IngestionStaging`, Angular upload panel, Python worker API-input test | pass locally; manual browser/worker run pending |
| Failed ingestion retry | Tenant-scoped audited `failed` → `queued` API transition and Angular retry action | pass locally |
| Private file staging | `tools/ingestion/ingestion/staging.py` and unittest copy/purge assertion; worker `--staging-root` | pass locally; production object storage/malware scanning remains open |
| Python approved HTTPS-to-API worker client | `tools/ingestion/test_ingestion.py` URL snapshot test; CLI supports `--url`, `--title` and repeated `--allowed-host` | pass (mock transport) |
| Unsafe ingestion inputs | Python tests reject `.doc`/`.xls`, private DNS targets and redirects | pass locally |
| SQL-level vector retrieval filters | `store-postgres.test.ts` with pgvector query | pass (local vector dimension) |
| Source reindex lifecycle | API and `store-postgres.test.ts` version replacement assertions | pass (new version returns to review) |
| Source version history | API `GET /api/v1/admin/sources/:id/versions`, memory test and PostgreSQL integration assertion | pass locally |
| Tenant-scoped ingestion job list | API `GET /api/v1/admin/ingestion-jobs`, app assertion and Angular job panel | pass (API/build; manual browser verification pending) |
| Tenant domain management | API domain CRUD, tenant-scoped memory/PostgreSQL store methods, migration `013-tenant-domains.sql`, Angular tenant-admin panel and tenant-bound approved URL-job validation | pass locally; manual browser verification pending |
| Public chat origin binding | Tenant-admin channel API/UI, exact-origin enforcement plus tenant-origin CORS preflight for public sessions/config, production requires configured origin | pass locally; manual browser verification pending |
| Tenant member management | Existing tenant-scoped member API wired into Angular tenant-admin panel; API role and cross-tenant coverage in `app.test.ts` | pass locally; manual browser verification pending |
| PostgreSQL backup/restore rehearsal | Local `pg_dump`/`psql` round trip to explicit scratch database `agentic_rag_restore_check`; restored schema verified, scratch database removed | pass locally; managed production backup/retention/restore schedule remains open |
| Redacted operational telemetry | Authorized service-health response and Angular health panel report request count, 5xx count, average latency and last-observed timestamp without request bodies or tenant content | pass locally; production metrics backend/alerts remain open |
| Tenant ingestion counters | Memory/PostgreSQL dashboard metrics and Angular queued/failed job card are tenant-scoped | pass locally; manual browser verification pending |
| Platform tenant lifecycle controls | Platform API status transition plus Angular suspend/reactivate/archive actions | pass locally; manual browser verification pending |
| Duplicate chat idempotency | API repeats a completed `clientMessageId` and returns the same response without a second durable user message | pass (memory API; PostgreSQL unique constraint and store lookup covered) |
| Bounded API input and abuse control | API suite verifies typed 413 oversized JSON and 429 rate-limit responses | pass locally |
| Observed health outage | API suite forces the store check to fail and verifies timestamped 503/down reporting | pass locally |
| Revoked-source purge | API negative/positive test; PostgreSQL delete uses tenant + revoked predicates | pass (memory API; SQL path covered by query contract) |
| Lint/typecheck/build | `npm run lint`, `npm run typecheck`, `npm run build` | pass locally after Angular 21 / Next 16 upgrade |
| Latest workspace test run | `npm test` | Admin 1 + web 1 + API 36 + contracts 1 passed; 1 PostgreSQL test skipped by default |
| Chat resume/history | `GET /api/v1/chat/sessions/:id` API assertion | pass (masked, tenant-scoped messages) |
| Durable admin session revocation | `auth.test.ts` and API logout assertion backed by store session records; PostgreSQL migration `010-auth-sessions.sql` | pass (memory + migration applied locally) |
| Chat session expiry and purge | API expiry/purge test plus PostgreSQL cascade purge assertion | pass locally |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | pass: 0 vulnerabilities after Angular 21.2.25, Next 16.4.1, React 19.3.1 and TypeScript 5.9.3 upgrade |
| Reproducible install dry run | `npm ci --dry-run` | pass locally |

## Blockers and risks

- Live identity-provider and production n8n credentials are unavailable; live Azure chat is verified locally, while embedding remains blocked by the missing deployment.
- Azure Foundry chat credentials are now configured locally from the user-provided private note; a live GPT-4.1-mini v1 request returned HTTP 200 with valid JSON. The configured resource does not have an embedding deployment available (`DeploymentNotFound` for `text-embedding-3-small`), so local runs keep the deterministic embedding provider until a deployed embedding model name is supplied.
- CI was added but its hosted run has not been observed from this local session.
- The framework dependency audit is clean locally; lockfile integrity and hosted CI still need verification in the repository CI environment.
- No browser automation was used; UI validation is build/typecheck-only per the requested unit-test-only constraint.
- The existing root n8n Compose file is still a public HTTP development deployment and is not a production security baseline.

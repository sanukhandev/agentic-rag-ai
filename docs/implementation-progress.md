# Implementation progress

Status: in progress (local MVP vertical slice; no VM deployment)

The complete feature brief, execution plan, acceptance matrix and master prompt arrived in remote commit `6582f7d` while the initial implementation was being prepared. They are now present and have been read; they supersede the earlier baseline assumption that only docs `01–14` existed. This file records actual implementation and verification; a checked box means the corresponding command or test was executed successfully.

## Phase gates

- [x] P00: repository audit, security constraints, spec set and threat review
- [ ] P01: workspace, API, UI, database migration, ingestion and CI foundation (CI added; hosted run not observed)
- [ ] P02: validated source ingestion, versioning, approval and retrieval (durable job state/lease, authenticated worker-result boundary, SQL vector filtering/order, transactional reindex-to-review and approved HTTPS worker snapshots added; private file staging, retention lifecycle and selected production embedding remain)
- [ ] P03: tenant-aware chat, PII masking, citations and fail-closed model boundary (synthetic API gate passing; conflict refusal and scoped history added)
- [x] P04: guarded, confirmed, idempotent mock/private n8n action (unit/API gate passing; live n8n blocked)
- [ ] P05: admin operations, audit, observability and security regression coverage (platform/tenant metrics, RBAC, lifecycle, rate limits, CORS and callback replay guard added; retention/backup pending)
- [ ] P06: PII vault and conversation API (AES-GCM session vault and Postgres persistence verified; retention/rate limits pending)
- [ ] P07–P10: full persona/version workflow, operations hardening, clean-room acceptance and go-live review

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
| Approved evidence is cited | API integration test | pass (deterministic model) |
| Unsupported facts are refused | API integration test | pass |
| Prompt injection in source is treated as data | persona rejection, explicit-intent gate, source-only model prompt | partial; adversarial corpus expansion pending |
| Conflicting active evidence is not chosen arbitrarily | `knowledge.test.ts`, API conflict guard | pass (numeric contradiction heuristic) |
| Confirmed action is idempotent and audited | `actions.test.ts`, API integration test | pass (mock adapter); callback route pending |
| Next web chat flow builds | `npm run build` | pass |
| Angular admin flow builds | `npm run build` | pass |
| Python ingestion tests pass | `tools/ingestion/test_ingestion.py` | pass (7 tests, local venv) |
| PostgreSQL/pgvector persistence smoke | `services/api/src/store-postgres.test.ts` with `DATABASE_URL` | pass (local container) |
| Ingestion job state and lease persistence | API job assertion and `store-postgres.test.ts` with migration `008-ingestion-jobs.sql` | pass (memory + PostgreSQL) |
| Authenticated worker result boundary | `app.test.ts` worker flow; hash, ordinal and locator validation | pass (synthetic Python result) |
| Python file-to-API worker client | `tools/ingestion/test_ingestion.py` worker submission test | pass (mock transport) |
| Python approved HTTPS-to-API worker client | `tools/ingestion/test_ingestion.py` URL snapshot test; CLI supports `--url`, `--title` and repeated `--allowed-host` | pass (mock transport) |
| SQL-level vector retrieval filters | `store-postgres.test.ts` with pgvector query | pass (local vector dimension) |
| Source reindex lifecycle | API and `store-postgres.test.ts` version replacement assertions | pass (new version returns to review) |
| Lint/typecheck/build | `npm run lint`, `npm run typecheck`, `npm run build` | pass locally |
| Chat resume/history | `GET /api/v1/chat/sessions/:id` API assertion | pass (masked, tenant-scoped messages) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | blocked: 9 advisories remain in Angular 19/PostCSS; remediation requires a major framework/toolchain upgrade and was not applied unverified |

## Blockers and risks

- Live identity-provider and production n8n credentials are unavailable; live Azure chat is verified locally, while embedding remains blocked by the missing deployment.
- Azure Foundry chat credentials are now configured locally from the user-provided private note; a live GPT-4.1-mini v1 request returned HTTP 200 with valid JSON. The configured resource does not have an embedding deployment available (`DeploymentNotFound` for `text-embedding-3-small`), so local runs keep the deterministic embedding provider until a deployed embedding model name is supplied.
- CI was added but its hosted run has not been observed from this local session.
- `npm audit` reports high-severity Angular 19 and PostCSS advisories; upgrading Angular/Next across major versions is a separate verified dependency task.
- No browser automation was used; UI validation is build/typecheck-only per the requested unit-test-only constraint.
- The existing root n8n Compose file is still a public HTTP development deployment and is not a production security baseline.

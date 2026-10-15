# Implementation progress

Status: in progress (local MVP vertical slice)

The complete feature brief, execution plan, acceptance matrix and master prompt arrived in remote commit `6582f7d` while the initial implementation was being prepared. They are now present and have been read; they supersede the earlier baseline assumption that only docs `01–14` existed. This file records actual implementation and verification; a checked box means the corresponding command or test was executed successfully.

## Phase gates

- [x] P00: repository audit, security constraints, spec set and threat review
- [ ] P01: workspace, API, UI, database migration, ingestion and CI foundation (implemented, not fully gated)
- [ ] P02: validated source ingestion, versioning, approval and retrieval (implemented, format/database gate pending)
- [ ] P03: tenant-aware chat, PII masking, citations and fail-closed model boundary (synthetic API gate passing)
- [x] P04: guarded, confirmed, idempotent mock n8n action (unit/API gate passing)
- [ ] P05: admin operations, audit, observability and security regression coverage (partial)
- [ ] P06–P10: future channels, production identity, provider hardening, load/restore and go-live review

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
| Tenant admin can approve and revoke a source | publish covered; revoke not yet covered | partial |
| PII is masked before model/embedding/workflow boundaries | `privacy.test.ts`, API model-spy test | pass for chat/model boundary; embedding/vault persistence pending |
| Approved evidence is cited | API integration test | pass (deterministic model) |
| Unsupported facts are refused | API integration test | pass |
| Prompt injection in source is treated as data | dedicated fixture/test | pending |
| Confirmed action is idempotent and audited | `actions.test.ts`, API integration test | pass (mock adapter) |
| Next web chat flow builds | `npm run build` | pass |
| Angular admin flow builds | `npm run build` | pass |
| Python ingestion tests pass | Python container | blocked: Docker daemon unavailable locally |

## Blockers and risks

- The local workstation has no Python executable and Docker Desktop was not running, so Python checks and PostgreSQL/pgvector smoke tests were blocked.
- No Azure, identity-provider or production n8n credentials are available. Live calls are intentionally not attempted.
- The existing root n8n Compose file is still a public HTTP development deployment and is not a production security baseline.

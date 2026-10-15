# Autonomous Codex execution plan — build, verify, finish

Status: **execution contract**, not evidence of implementation. Primary specs: AGENTS.md; docs/15-complete-feature-brief.md. Codex should implement this work in sequential, reviewable increments with rigorous continuous verification and no unsupported claims. No unattended production rollout, credential changes or real-customer-data ingestion.

## 0. Working mode and non-negotiable completion rules
- Inspect repository first; confirm branch, existing files, history, remotes, test tooling and actual docker-compose.yml. The repository was documentation + n8n only as of 15 October 2026.
- Plan into trackable tasks/checklist in the repository (e.g., docs/implementation-progress.md), mark `pending/in progress/complete/blocked` with objective evidence, and keep it updated after every phase.
- Continue across safe independent tasks without asking routine preferences. Choose reasonable **reversible development defaults**, put them in ADRs, and distinguish them from user-approved production policy.
- Never bypass security gates to satisfy a green build. Do not fabricate live Azure credentials, production identities, deployment URLs, user consent or success claims.
- Use synthetic tenant A and B, seed fake sources and mock n8n+model for deterministic CI. Live Azure/provider validation occurs only when approved credentials are supplied. Missing credentials are a documented integration blocker, not a reason to fabricate tests.
- Keep each phase small, buildable, and committed with clear messages. Use a feature branch/PR if possible; never force-push or overwrite unrelated user changes. Do not deploy or publish real infrastructure without explicit authorization.
- For risky decisions (privacy jurisdiction, public exposure, real data sharing, secret access, billable cloud provisioning), implement local stubs, document blocker and continue on independent components. The phrase "nonstop" never authorizes unsafe deployment/credential handling.

## 1. Target repository layout
~~~text
/
  AGENTS.md
  apps/
    web/                     # Next.js React Tailwind chat
    admin/                   # Angular Tailwind protected console
  services/
    api/
      src/
        routes/ middlewares/ auth/ tenants/ personas/ sources/
        conversations/ retrieval/ ai/ privacy/ workflows/
        observability/ db/ config/
      migrations/
      tests/
  tools/
    ingestion/
      src/ parsers/ extractors/ embeddings/ jobs/ tests/
      requirements.txt
      .venv/                 # gitignored
  packages/
    contracts/               # OpenAPI and generated clients
    config/                  # only if used
  infra/
    compose/                 # dev-only private services or overrides
  docs/
    15-complete-feature-brief.md
    16-autonomous-codex-execution-plan.md
    17-acceptance-test-matrix.md
    18-codex-master-prompt.md
~~~
Choose a compatible Node LTS/Angular/Next.js/TypeScript version from verified toolchain. Prefer pnpm workspaces for JS and Python venv + pinned dependencies for ingestion, but document version choices in ADRs. PostgreSQL + pgvector may be one service with separate schemas/roles. Start with Postgres-backed ingestion job state/worker so Redis is not a default dependency.

## 2. Phase plan with completion gates

### P00 — repo reconnaissance, spec lock and threat review
Tasks:
1. Inventory sources, Git branch, current Compose and environment; identify public n8n exposure/HTTP weaknesses.
2. Read AGENTS.md and product docs; create backlog/checklist and architecture decision log with reversible dev defaults and production TBDs.
3. Identify API and data privacy boundary; define tenant public/private source visibility, trust zones and no-web-answer policy.
4. Create repository .gitignore strategy before generating build artifacts; no customer files, secret .env, node_modules or Python .venv.
Gate: explicit baseline diff, implementation task list, diagram/data flow and documented production blockers.

### P01 — secure developer platform and workspace
Tasks:
1. Add root pnpm workspace scripts for build/typecheck/lint/test; scaffold strict TypeScript Express Node API, Next.js/React/Tailwind web, Angular/Tailwind admin, Python venv package, typed contracts.
2. Add local development Docker configuration for Postgres with pgvector; keep DB private. Harden existing n8n Compose from public HTTP bind for safe local use (do not deploy); pin images.
3. Add dependency locking, env.example with placeholders, health checks, migrations tool, secret scanning and reproducible README setup.
4. Add CI workflow for reproducible installs, formatter/lint, types, tests, builds, dependency/secret checks; don't require live Azure secrets for PR CI.
Gate: clean checkout can start local services, compile each app/worker, run smoke health checks and shut down. No internet-exposed admin/webhook/DB services in dev compose by default.

### P02 — Postgres schema, tenant identity and access
Tasks:
1. Create migrations: tenants, tenant_domains, users/principals, tenant_memberships, tenant_roles/permissions, sessions or chosen identity integration, personas, source metadata, versions/chunks/jobs, chat sessions/turns, encrypted token vault, action runs, audit.
2. Implement tenant resolver based on verified admin identity and approved public domain/signed chat configuration; prevent tenant spoofing via client-supplied identifiers.
3. Implement admin login/logout with development-test auth provider adapter and secure session strategy; choose compatible production provider with decision left explicit. RBAC for platform_owner, tenant_admin, tenant_editor and tenant_viewer. Protect admin APIs.
4. Add Postgres RLS where feasible, always mandatory tenant-scoped repositories and ACL guards; test cross-tenant ID guessing, missing/invalid auth, member removal/suspension.
Gate: simulated tenant A admin cannot read, update, delete or infer tenant B resources in routes, service layer or DB. Platform admin cross-tenant access is explicit and audited.

### P03 — organization onboarding and admin console
Tasks:
1. Implement Node CRUD/lifecycle APIs for tenant creation, domain/channel config, memberships/invitations if auth strategy supports, suspension/archive, quota/retention settings.
2. Angular UI: protected login flow, shell/navigation, platform dashboard scaffold, tenant list/create/edit, tenant workspace, member role forms, source library, persona editor, ingestion-job status, monitored-service panels and alert/error states.
3. Seed two synthetic organizations and roles for e2e; use generated typed clients where beneficial; no hardcoded production URLs.
Gate: admin A onboards tenant C in a test environment and grants its admin; tenant C cannot see A/B; suspension blocks new public chats and indexing.

### P04 — Python safe ingestion (initial supported formats)
Tasks:
1. Define typed ingestion job request/result schema; implement private staging path/object adapter, job leasing/locking, retries, checksum/idempotency, progress/error states and quarantine.
2. Implement adapters with tests for DOCX, XLSX, TXT, text PDF and approved HTTPS URLs. Reject unsupported .doc/.xls, protected/invalid binary, macro files and OCR-only PDF with actionable error until explicitly supported.
3. For Excel preserve sheet and column headers, rows and units; prohibit formula/macro execution; for URLs enforce admin-scoped HTTPS host allowlist, DNS/IP/redirect SSRF checks, canonicalization, bounded fetch, no automatic recursive crawl.
4. Extract source locators, sanitize secrets/PII, chunk deterministically, call injectable embedding interface, upsert versioned vectors, stage/review/publish atomically; retain previous active version on failure.
5. Implement lifecycle revoke/reindex and purge according to policy; enforce tenant and public/internal audience classification on chunks; admin job progress API.
Gate: five synthetic source types are extracted/indexed with traceable locators, repeat ingest is idempotent, malicious URL and path tricks fail, revoke makes source unqueryable instantly.

### P05 — retrieval/evidence API and grounded model adapter
Tasks:
1. Implement vector retrieval with tenant/visibility/source-version SQL predicates, optional lexical/hybrid retrieval, bounded top-k and source evidence metadata.
2. Add Azure AI Foundry GPT-4.1-mini adapter and separate embedding adapter, both injectable/mocked; credentials server-only. Use proper server-controlled tenant persona; do not accept unrestricted prompt overrides.
3. Define strict output schema (answer, citationChunkIds, evidenceStatus, intentProposal). Validate every ID against authorized context and verify claim/evidence sufficiency. Enforce source-only factual response and abstention.
4. Add prompt-injection adversarial fixtures and tests for missing, old, conflicting or another-tenant evidence and unsupported language transformations. Prevent runtime arbitrary browsing.
Gate: automated golden corpus Q/A answer/citation and negative tests pass; no unsupported claims are returned by response verifier. External Foundry smoke optionally executed only with valid secrets, labelled as such.

### P06 — PII vault and conversation API
Tasks:
1. Implement customer PII classifier/rules plus configurable deny/sensitive patterns, tenant/session-scoped opaque tokens, encrypted vault and key abstraction with rotation tests.
2. Chat session create/resume, message submit/history, normalized idempotency keys, rate limits, CSRF/CORS where needed, safe errors and server-resolved tenant channel scope.
3. Enforce masking **before** prompts, retrieval embeddings, logs and workflow payloads; ensure only authorized recipient/session-specific rehydration after output policy gate.
4. Store masked history with TTL; ensure no PII leakage on error, streaming, telemetry or generated citations. Use test doubles that record every outbound call for inspection.
Gate: chat message through full mocked RAG passes, IDs cannot cross tenants, raw synthetic PII absent from model/embedding/n8n/log payloads; token misuse/expiry/cross-tenant resolution denied.

### P07 — web chat and persona behavior
Tasks:
1. Implement Next.js chat UI: tenant-safe bootstrap, persona display/greeting/languages, chat messages, evidence citations, uncertainty reply, loading/error/retry and accessible keyboard/mobile interactions.
2. Tenant admin persona editor with draft/validate/preview/publish/version rollback. Sanitize free-form persona text and restrict override to non-security presentation; default and allowed languages.
3. Add source-aware multilingual answer checks, persona version pinned per answer/session as defined, and no-knowledge fallback translations without invented facts.
4. E2E test two chat sites and tenant-specific greetings/personas plus isolated retrieval and unsupported questions.
Gate: matching tenant persona styles observed, but source evidence and access remain identical under adversarial persona settings.

### P08 — guarded n8n workflow POC
Tasks:
1. Implement allowlisted action registry, structured intent validation, confirmation UI/API, consent reference, action state machine, idempotency and durable audit.
2. Implement private authenticated n8n webhook adapter with mocked counterpart in CI; restrict data to opaque IDs, sanitized fields and allowed destinations, not raw chat or token vault.
3. Add a simple synthetic "lead interest" notification/mock processing workflow; avoid real CRM writes or customer email until approved.
4. Test duplicate confirmations, stale/forged callbacks, wrong tenant, timeout/unknown status and workflow disabled/suspended tenant.
Gate: confirmed synthetic action fires exactly once, every attempt is auditable, prompt injection alone cannot invoke the workflow, and unconfirmed action cannot run.

### P09 — service dashboard, operations and monitoring
Tasks:
1. Node metrics endpoints for platform/tenant-scoped usage, indexed source count, ingestion throughput/failure, service health last-checked times, chat latency/error rates, token/cost estimate, workflow status.
2. Angular dashboards with tenant isolation and platform admin overview; no raw private source, model prompt or customer PII in telemetry.
3. Health/readiness and alerts with measurable checks; rate limiting, secure env configuration, backups/restore rehearsal, data retention/deletion job, trace correlation and runbooks.
Gate: synthetic data drives truthful counters and status, RBAC cannot access cross-tenant detailed metrics, health outage displayed truthfully.

### P10 — full integration, docs and final readiness
Tasks:
1. Run clean-room setup on fresh checkout, migrations, sample seed, worker ingestion for all five input types, publish, web chat, unsupported refusal, separate tenant isolation, admin monitoring and mock n8n confirmation.
2. Execute full test matrix from docs/17-acceptance-test-matrix.md; measure performance against documented chosen development baseline; fix genuine issues.
3. Run lint/typechecks/unit/integration/E2E/builds, dependency/secret audit, Postgres ACL tests, malicious URL/prompt tests; document actual commands and outputs.
4. Update README, architecture, API contract/OpenAPI, ER diagram, ADRs, env examples, runbooks and docs/implementation-progress.md. Open PR or commit reviewed increments. Never hide skipped test categories.
Gate: full synthetic local acceptance suite green + security tests pass + no live cloud/provider feature marked verified without credentials. Publish objective finish report with implemented vs deferred and blockers.

## 3. Suggested module-level API worklist (all endpoints provisional)
- Identity: POST /api/v1/admin/auth/login, POST /logout, GET /me (final auth provider may change routes).
- Platform: POST/GET /api/v1/platform/tenants, GET/PATCH /:id, POST /:id/suspend, GET /services/health.
- Tenant: GET/PATCH /api/v1/admin/tenant, /members, /domains, /agent-persona (GET/PUT draft, POST publish/preview).
- Knowledge: POST /api/v1/admin/sources/upload, POST /sources/url, GET /sources, GET /sources/:id/versions, POST /:id/publish, POST /:id/revoke, GET /ingestion-jobs/:id.
- Tenant dashboard: GET /api/v1/admin/dashboard/overview, /services, /usage, /audit.
- Public: GET /api/v1/chat/config (domain/signed channel scoped); POST /chat/sessions, POST /chat/messages, GET /chat/sessions/:id; POST /chat/actions/:id/confirm, GET /chat/actions/:id.
- Internal: authenticated worker job lease/update/publish, authenticated n8n callback/action adapter. Do not expose publicly.
Contract-first OpenAPI + runtime schemas; status, pagination, correlation IDs and error DTOs.

## 4. Test execution sequence
Per phase: static checks → unit → integration → security-negative → affected builds → container smoke → E2E if available. CI must have separate bounded suites and synthetic fixtures. Maintain records in implementation-progress.md. Minimum mandatory acceptance cases appear in docs/17-acceptance-test-matrix.md.

## 5. Autonomy and blocking policy
Move continuously from one phase to the next once its gate passes. For mundane reversible choices, pick a secure sensible default and record ADR. If one external dependency is unavailable, build/test a compatible mock, continue independent work, record integration as blocked; do **not** silently declare live verification complete. Stop and ask only for genuinely irreducible approval/credential/production decisions; never exfiltrate secrets or enact billable resources without permission. No false assurance that all file types or languages are reliable before test evidence.

## 6. Final delivery report
| Item | Expected evidence |
| --- | --- |
| Code | Commit SHAs/PR and changed modules |
| Working path | Synthetic tenant A/B, five types, persona, citations, unsupported refusal, dashboard and mock action |
| Tests | Actual commands and passing/failing counts by suite |
| Security | Tenant ACL, SSRF, PII leak, injection, replay, RBAC and source revocation test results |
| External dependencies | Which Foundry/embedding/n8n live calls really worked vs mocked/blocked |
| Operations | How to run locally and securely, backup/restore, known issues and fixes |
| Open decisions | Production-ready gaps kept explicit, not labelled complete |

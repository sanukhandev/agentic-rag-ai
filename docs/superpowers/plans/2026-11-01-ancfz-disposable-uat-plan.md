# ANCFZ Disposable API UAT Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the real HTTP conversation path against a disposable Postgres/Redis Docker stack without touching operational data, and produce truthful Stage 1–5 evidence.

**Architecture:** Reuse the compiled Node API, private LangGraph gateway and existing PostgreSQL schema. Seed only synthetic ANC configuration into the disposable database, use a deterministic local model/provider only inside UAT, and validate public responses plus durable state.

**Tech Stack:** Docker Compose, PostgreSQL/pgvector, Redis, Node/TypeScript, Python/FastAPI/LangGraph, deterministic UAT adapters.

**Spec:** `docs/verification/conversation-v2/stage5-langgraph-safe-uat.md` and the repository `AGENTS.md` contract.

## Global Constraints

- Never modify the existing operational database, Docker volumes, credentials or `.env`.
- Bind only the API to `127.0.0.1`; keep Postgres, Redis, gateway and providers internal.
- Use only synthetic identities and harmless synthetic documents.
- Keep consent, grounding, catalog, tenant, opportunity and provider-evidence gates enabled.
- Report mock-model and Azure-model evidence separately; never label mock evidence as GPT-5.4.

## Review Focus

- Fresh UAT storage must not resolve the operational Postgres host; test Compose isolation and connection scope.
- Session tokens must be carried by the HTTP runner; strict enforcement is UAT-only to preserve the existing public contract.
- Tool output and provider callbacks must remain tenant/session/opportunity scoped; test wrong scope and replay.
- Empty retrieval must produce a useful abstention and next question, not an invented business claim.
- A local document acceptance must not be reported as verified SF-02 attachment; test the evidence tier.

### Task 1: Disposable stack and safe model mode

**Files:**
- Create: `docker-compose.anc-mock-uat.yml`
- Create: `services/model-gateway/gateway/mock_model.py`
- Modify: `services/model-gateway/gateway/app.py`
- Test: `services/model-gateway/tests/test_mock_model.py`

- [ ] Add a failing test for deterministic structured output, authorized tool continuation and envelope persona/language preservation.
- [ ] Add `MODEL_MODE=mock` behind an explicit UAT setting; leave Azure behavior unchanged by default.
- [ ] Add isolated named volumes, internal-only services, loopback API binding and health checks.
- [ ] Run the Python focused test and `docker compose ... config --quiet`.

### Task 2: Synthetic ANC bootstrap and provider worker

**Files:**
- Create: `tools/qa/ancfz-uat-bootstrap.mjs`
- Create: `tools/qa/anc-mock-provider-server.mjs`
- Create: `tools/qa/ancfz-stage5-api-conversation.mjs`

- [ ] Bootstrap `anc` and an empty-retrieval companion tenant with published Zara persona, executable legacy catalog, published v2 catalog and synthetic pricebook.
- [ ] Route workflow events to deterministic local lead/account/document handlers with idempotent callback evidence.
- [ ] Use the returned session token on every session-scoped HTTP request and record redacted evidence only.
- [ ] Exercise happy path, empty retrieval and security/recovery scenarios; query durable state read-only.

### Task 3: UAT-only session-token enforcement

**Files:**
- Modify: `services/api/src/app.ts`
- Modify: `services/api/src/app.test.ts`

- [ ] Add a failing regression test for missing/invalid session-token rejection when the feature flag is enabled.
- [ ] Validate `x-agentic-session-token` against the existing hashed access-token store for messages, actions, lifecycle and documents.
- [ ] Keep the flag disabled by default so current clients and existing tests retain their contract.

### Task 4: Verification and evidence

**Files:**
- Create: `artifacts/ancfz-stage5-api-uat/.gitkeep` only if the report directory needs tracking.
- Modify: `docs/current-state.md` with measured results only.

- [x] Build the disposable images, run health/readiness checks, run the real HTTP runner and inspect durable UAT state.
- [x] Run existing focused/full tests and report Azure mode as blocked when no configured deployment is verifiable.
- [x] Commit implementation and report changes locally; do not push or merge.

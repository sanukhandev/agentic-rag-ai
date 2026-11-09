# Salesforce Lead Workflow Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ANCFZ Salesforce Lead workflow reproducible, fail-closed, observable, and testable from a fresh local Docker start without relying on hidden n8n state.

**Architecture:** Keep Node as the authority for catalog routing, consent, action authorization, provider evidence, and durable state. Keep n8n as the execution adapter: it receives the authorized correlation envelope, calls Salesforce, reads the Lead back, asks Node to verify the evidence, and reports completion or reconciliation. Add a dev-only runtime verification/bootstrap boundary so activation and credentials are explicit, never silently enabled in production.

**Tech Stack:** TypeScript/Node.js, Express, PostgreSQL, Redis Streams, n8n JSON workflows, Docker Compose, Vitest, Node test runner.

**Spec:** `docs/n8n-workflows.md`, `docs/architecture.md`, `docs/acceptance.md`, `docs/migration-plan.md`, and `docs/current-state.md`.

## Global Constraints

- Node is the sole external business API and authority for tenant/session scope, consent, catalog binding, action eligibility, idempotency, outbox, and callback reconciliation.
- n8n is execution, not planning; it may not mark a Salesforce Lead complete without trusted provider readback verified by Node.
- `AZURE_OPENAI_API_KEY`, Salesforce tokens, and n8n credentials must never enter source control, logs, reports, or model payloads.
- Production workflow activation, Salesforce writes, charges, and signatures remain disabled unless explicitly configured and approved.
- Synthetic customers and Salesforce sandbox data only for automated and local verification.
- Preserve the existing public Chat API, historical migrations, inactive workflow templates, and rollback evidence.

## Review Focus

- Fresh n8n startup with the workflow present but inactive: readiness must fail clearly instead of producing a later 404/reconciliation surprise; test runtime workflow ID, path, contract, and active state.
- Missing or drifted Salesforce/OAuth/internal-header credentials: the workflow must fail closed before a provider write; test secret-presence checks without printing values.
- `202 onReceived` followed by a provider/readback/evidence failure: the action must reach a durable failed or `reconcile_required` state within the configured deadline; test correlation and sanitized reason preservation.
- Duplicate/replayed webhook or stale action revision: no duplicate Salesforce Lead and no state regression; test idempotency and replay rejection.
- Contract-invalid or unauthenticated mock webhook: reject before Salesforce execution and expose no internal payload or PII; test HTTP status and n8n execution behavior.

---

### Task 1: Add a declarative n8n Salesforce readiness contract

**Files:**
- Create: `scripts/verify-n8n-salesforce-lead-runtime.mjs`
- Create: `scripts/verify-n8n-salesforce-lead-runtime.test.mjs`
- Modify: `package.json`
- Modify: `scripts/verify-compose.mjs`
- Modify: `.env.example`
- Modify: `docs/current-state.md`

**Interfaces:**
- `verifyRuntime({ workflowId, expectedPath, expectedContract, runtimeList, envPresence }) -> { ok: true, workflowId, path, contract } | throws a typed readiness error`.
- The verifier consumes n8n runtime metadata and boolean environment-presence flags only; it never prints endpoint values, tokens, credential IDs, or customer payloads.

- [ ] **Step 1: Write failing tests** for inactive/missing workflow, wrong webhook path, wrong contract, missing credential-presence flags, and the valid active runtime shape.
- [ ] **Step 2: Run the focused verifier tests** and confirm they fail for the missing verifier behavior.
- [ ] **Step 3: Implement the verifier** with exact expected values: workflow ID `ancfzV2LeadCreateR1`, path `ancfz/v2/lead-create`, contract `ancfz-v2-stage-action-v1`, active state `true`, and required runtime flags for Salesforce create/readback plus Node internal authentication.
- [ ] **Step 4: Add explicit commands** `verify:n8n:salesforce` and `verify:compose`; keep activation separate from verification and require an explicit dev-only activation command/flag.
- [ ] **Step 5: Document the fresh-start sequence** and the fail-closed production behavior in `docs/current-state.md` and `.env.example`.
- [ ] **Step 6: Run** `npm run verify:compose`, `npm run verify:n8n:salesforce`, and the focused tests; expected result is PASS with no secret values in output.
- [ ] **Step 7: Commit** the readiness contract separately.

### Task 2: Make dev workflow activation reproducible without enabling production

**Files:**
- Create: `scripts/activate-ancfz-n8n-dev.mjs`
- Create: `scripts/activate-ancfz-n8n-dev.test.mjs`
- Modify: `package.json`
- Modify: `docs/n8n-workflows.md`
- Modify: `docs/current-state.md`

**Interfaces:**
- `activateDevWorkflows({ executor, workflowIds }) -> { activated: string[] }`.
- The command targets only the local Compose n8n container, publishes the reviewed workflow revisions, restarts n8n when required, and verifies the active list afterward.

- [ ] **Step 1: Write a unit test** that asserts only the allowlisted IDs are publishable: `ancfzV2LeadCreateR1`, `ancfzV2PackageQuoteR1`, and `ANCDocumentOCRWF1`; any other ID must be rejected.
- [ ] **Step 2: Implement the dev-only command** using the existing n8n CLI/container boundary. Do not create credentials, print credential contents, or run in `NODE_ENV=production`.
- [ ] **Step 3: Add a post-activation verification** that compares the active runtime metadata with the catalog route and workflow contract.
- [ ] **Step 4: Run the command against local Docker** and prove a fresh restart retains the active workflow state; expected result is all allowlisted workflows active and the verifier green.
- [ ] **Step 5: Commit** the explicit dev bootstrap separately from application behavior.

### Task 3: Add a correlated n8n failure/reconciliation path

**Files:**
- Modify: `infra/n8n/workflows/ancfz-v2/01-lead-create.json`
- Modify: `services/api/src/app.ts`
- Modify: `services/api/src/event-bus.ts`
- Test: `services/api/src/v2-provider-evidence-route.test.ts`
- Test: `services/api/src/v2-workflow-bridge.test.ts`
- Create: `infra/n8n/workflows/ancfz-v2/01-lead-create-failure.test.mjs`

**Interfaces:**
- Add a Node internal endpoint `POST /api/v1/internal/workflow-events/fail` protected by the existing n8n internal authentication. It accepts the same correlation tuple as completion (`actionId`, `tenantId`, `sessionId`, `opportunityId`, `catalogVersionId`, `idempotencyKey`, `actionKey`, `actionRevision`, `eventId`, `correlationId`, `attempt`) plus a bounded reason code and requested terminal state.
- The endpoint allows only `failed` or `reconcile_required`, validates the current execution claim and attempt, stores a sanitized outcome, and never accepts provider completion evidence.

- [ ] **Step 1: Write failing Node tests** for valid correlated failure, stale-attempt rejection, tenant mismatch rejection, and idempotent replay.
- [ ] **Step 2: Write the n8n structural test** requiring every Salesforce/readback/evidence side-effect node to route errors to the correlated failure callback without including raw response bodies.
- [ ] **Step 3: Implement the endpoint** by reusing the existing `transitionActionWithExecution`/execution-claim guards and existing deadline recovery; do not weaken the current trusted completion route.
- [ ] **Step 4: Wire the workflow error outputs** for claim, provider create, provider readback, Node evidence verification, attestation, and completion. Use bounded reason codes such as `salesforce_create_failed`, `salesforce_readback_failed`, `provider_evidence_rejected`, and `node_completion_failed`.
- [ ] **Step 5: Preserve the existing deadline sweeper** as a second line of defense for transport loss or n8n process crashes; add an audit event for deadline reconciliation if it is not already emitted.
- [ ] **Step 6: Run focused API and n8n tests** and prove a forced provider failure reaches `reconcile_required` with correlation intact and no false Lead completion.
- [ ] **Step 7: Commit** the failure-path change separately.

### Task 4: Add a safe mock webhook-trigger test harness

**Files:**
- Create: `scripts/mock-salesforce-webhook.mjs`
- Create: `scripts/test-salesforce-lead-webhook.mjs`
- Modify: `package.json`
- Create: `docs/verification/salesforce-lead-webhook-mock-2026-11-09.json`

**Interfaces:**
- The mock provider exposes only local create/readback routes, returns deterministic synthetic Salesforce-style IDs, records request counts in memory, and never calls Salesforce.
- The test harness sends requests to `/webhook/ancfz/v2/lead-create` and records status, n8n route result, provider-call count, Node action state, and sanitized failure reason.

- [ ] **Step 1: Add the no-side-effect cases**: missing webhook auth, invalid workflow contract, stale action correlation, and duplicate replay. Expected result is rejection/reconciliation with zero mock Salesforce create calls where validation should stop execution.
- [ ] **Step 2: Add the happy-path mock case** using a synthetic authorized action and mock provider create/readback. Assert exactly one create call, one readback, one Node evidence verification, and one completed action with `provider_record_verified` evidence.
- [ ] **Step 3: Add provider-failure cases** for create 500, readback mismatch, and Node evidence rejection. Assert no completed action and a bounded `reconcile_required`/`failed` result.
- [ ] **Step 4: Export only redacted evidence**: hashes/digests, status codes, counts, IDs marked synthetic, and state transitions; never endpoint secrets, OAuth tokens, raw documents, or full customer payloads.
- [ ] **Step 5: Run** `npm run test:salesforce:webhook:mock` against local Docker and save the JSON artifact.
- [ ] **Step 6: Commit** the reusable mock test harness and evidence format.

### Task 5: Re-run sandbox smoke and complete acceptance evidence

**Files:**
- Modify: `scripts/live-quote-conversation.mjs` only if it needs to consume the readiness verifier.
- Modify: `docs/current-state.md`
- Create: `docs/verification/salesforce-lead-workflow-acceptance-2026-11-09.json`

- [ ] **Step 1: Start from a clean local Docker restart**, run the explicit dev activation, and verify the runtime contract before sending any customer conversation.
- [ ] **Step 2: Run the existing synthetic quote conversation** with a unique contact identity and confirm Lead completion, Salesforce readback evidence, quote generation/download, and both document attachment readbacks.
- [ ] **Step 3: Query PostgreSQL** for the correlated action, `crm_leads` remote ID, action execution evidence, document statuses, and Salesforce attachment audit events.
- [ ] **Step 4: Run all gates:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:compose`, focused n8n/API tests, and the mock webhook harness.
- [ ] **Step 5: Update `docs/current-state.md`** with exact pass/fail/blocked results and keep the dated evidence redacted.
- [ ] **Step 6: Review the diff and stop before production promotion.**

## Acceptance Criteria

- A fresh local Docker start either verifies the active, credential-bound Salesforce workflow or fails with a precise readiness error before the customer can submit a Lead.
- The published catalog route, n8n runtime route, workflow ID, contract, and Node action binding are identical.
- A successful Lead requires Salesforce create response, Salesforce readback, Node evidence verification, and correlated completion.
- Provider failure, n8n failure, timeout, stale replay, and duplicate replay never produce a completed Lead.
- The mock webhook suite proves both the no-side-effect failure paths and one complete synthetic success path without contacting Salesforce.
- All customer-visible workflow states remain persona-safe and truthful.

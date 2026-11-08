# Quote Generation Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ANCFZ Lead → package → quote flow exactly-once, impossible to bypass through legacy V2 routes, and truthfully verifiable as a development quote workflow while preserving a separate path to future provider-backed production quotes.

**Architecture:** Keep Node as the authority for tenant/session/opportunity/catalog/consent/action state and keep n8n as the execution boundary. The browser sends only a package selection key; Node reloads the pinned approved offering, creates or reuses one selection and one quote-generation action, and the private PDF service remains a development-only renderer. Provider-backed quote generation is a later adapter/readback phase and must not be represented as complete by the local PDF path.

**Tech Stack:** TypeScript/Express, PostgreSQL, Redis Streams, n8n workflow JSON, Next.js chat UI, Python private PDF service, Vitest, Node test runner, pytest.

**Spec:** `docs/superpowers/specs/2026-11-06-lead-package-quote-flow-design.md`

## Global Constraints

- Node is the sole authority for tenant/session scope, catalog publication, opportunity state, consent, action eligibility, idempotency and persistence.
- n8n executes an already-authorized action; it does not choose a package, price, provider or customer intent.
- The local PDF path is development/mock evidence only and must not claim official ANCFZ pricing, Salesforce completion or payment/contract completion.
- Every external write and callback must have idempotency, correlation, authentication and reconciliation behavior.
- The browser must never submit or control price, inclusions, currency, catalog version or quote status.
- Existing public Chat/Admin contracts, migrations, customer records and rollback paths must be preserved until the replacement is verified.
- No production credentials, real charges, signatures or provider activation may be changed without explicit approval.

## Review Focus

- Duplicate clicks, replayed n8n deliveries and concurrent executions must produce one selection, one quote and one PDF artifact; owned by Tasks 2 and 3.
- Legacy `/packages/quotes` callers must not create a V2 quote without the new selection/action gate; owned by Task 1.
- Wrong tenant, session, opportunity, catalog revision, offering, consent state or expired price must fail closed; owned by Tasks 1 and 2.
- Missing, altered or unverifiable PDF bytes must not complete the action or become downloadable; owned by Task 3.
- Missing Lead verification, inactive workflow, disabled local mode and unavailable PDF service must surface a typed pending/failed state without false success; owned by Tasks 3 and 4.

### Task 1: Close the legacy quote-generation bypass

**Files:**
- Modify: `services/api/src/routes/lifecycle.ts:48-50`
- Modify: `services/api/src/business-lifecycle.ts:85-94`
- Modify: `services/api/src/http/schemas.ts:152-155` if the compatibility response needs a typed error contract
- Test: `services/api/src/v2-provider-evidence-route.test.ts` and/or a new focused lifecycle route test beside the existing route tests

**Interfaces:**
- Consumes: the existing V2 session catalog pin, active opportunity, package selection store methods and `package.confirm` action identity.
- Produces: V2 `POST /api/v1/chat/sessions/:id/packages/quotes` either returns the already-created quote for a valid confirmed selection or rejects with `QUOTE_WORKFLOW_REQUIRED`; non-V2 legacy behavior remains unchanged unless an explicit migration removes it.

- [ ] **Step 1: Add failing V2 route tests.** Prove that a pinned V2 session cannot create a quote from only `{ opportunityId, packageOfferingId }`; prove that a quote can be read/reused only when it belongs to the active opportunity, approved offering, granted consent, verified Lead and confirmed package selection.
- [ ] **Step 2: Run the focused route tests and confirm failure.**

  Run: `npm --workspace services/api test -- src/v2-provider-evidence-route.test.ts`

  Expected: the new bypass test fails against the current direct `createApprovedQuote` path.
- [ ] **Step 3: Implement the smallest compatibility gate.** For a V2-pinned session, route quote creation through the existing package-selection/action contract; do not create a new quote in the legacy endpoint. Preserve the old path only for sessions without a V2 catalog pin.
- [ ] **Step 4: Run the focused tests.**

  Expected: the V2 bypass and compatibility tests pass.
- [ ] **Step 5: Commit the route-gate change.**

  Commit message: `fix: close the v2 quote route bypass`

### Task 2: Make package selection and quote creation exactly-once

**Files:**
- Modify: `services/api/src/types.ts` Store interface near package lifecycle methods
- Modify: `services/api/src/store-postgres.ts` package selection/action methods
- Modify: the in-memory test store used by API tests, if it implements the same interface
- Add: `infra/postgres/068-anc-quote-idempotency.sql`
- Modify: `services/api/src/business-lifecycle.ts:119-129`
- Modify: `services/api/src/app.ts:3164-3180`
- Test: `services/api/src/business-lifecycle.test.ts`, `services/api/src/v2-provider-evidence-route.test.ts`, and a focused internal quote-action test

**Interfaces:**
- Consumes: `package.confirm` action idempotency key `package-confirm:${selection.id}`.
- Produces: atomic store operations equivalent to `claimPackageQuoteAction(actionId, tenantId)` and `getOrCreateDevelopmentQuoteForSelection(selectionId, tenantId)`; a duplicate executor receives the completed result or a processing response and does not create another quote.

- [ ] **Step 1: Add failing concurrency/idempotency tests.** Cover duplicate package clicks, two concurrent selection requests, two concurrent n8n calls, replay after completion and replay while processing. Assert one non-rejected selection, one quote, one completed action and one stored PDF artifact.
- [ ] **Step 2: Add the database constraints and transactional primitives.** Add a partial unique index for one active selection per tenant/opportunity/offering and a quote uniqueness key tied to the package selection. Use an atomic state transition from `approved` to `processing`; do not use a read-then-write check as the lock.
- [ ] **Step 3: Implement conflict reloads.** On unique conflicts, reload the existing selection/quote/action and return it. A request that observes `processing` must not perform quote creation or PDF rendering again.
- [ ] **Step 4: Make quote creation selection-scoped.** Lock or atomically upsert by selection identity, validate the pinned offering and price inside that operation, and reuse the existing approved quote on replay.
- [ ] **Step 5: Run focused tests and inspect the database plan.**

  Run: `npm --workspace services/api test -- src/business-lifecycle.test.ts src/v2-provider-evidence-route.test.ts`

  Expected: all existing lifecycle tests plus the new duplicate/concurrency tests pass.
- [ ] **Step 6: Commit the idempotency change.**

  Commit message: `fix: make quote generation exactly once`

### Task 3: Persist and verify quote artifact metadata

**Files:**
- Add: migration columns or a focused artifact table in `infra/postgres/069-anc-quote-artifacts.sql`
- Modify: `services/api/src/types.ts`, `services/api/src/store-postgres.ts`
- Modify: `services/api/src/app.ts:545-564,3175-3181,3567-3580`
- Modify: `apps/web/app/chat-utils.ts` and `apps/web/app/page.tsx` only if the response metadata changes
- Test: API quote-action/download tests and `tools/anc/pdf_service/test_render.py`

**Interfaces:**
- Consumes: verified PDF service response `{ artifactId, sha256, bytes }` and the quote/selection identity.
- Produces: durable quote artifact metadata `{ artifactId, sha256, bytes, mimeType, fileName, storageKey, verifiedAt }`; download verifies the stored bytes against the persisted hash before sending them.

- [ ] **Step 1: Add failing artifact tests.** Cover invalid renderer metadata, byte-length mismatch, SHA-256 mismatch, missing stored bytes, tampered stored bytes, cross-session download and cross-tenant download.
- [ ] **Step 2: Persist artifact metadata with the quote.** Keep the existing private storage key derived from tenant and quote identity; record the verification metadata only after the downloaded bytes pass validation.
- [ ] **Step 3: Make completion conditional on artifact persistence.** If metadata persistence or private storage fails, leave the action non-completed and return a typed failure/reconciliation state.
- [ ] **Step 4: Harden the download route.** Require the session-authorized opportunity and approved quote, verify artifact metadata and stored bytes, then return `application/pdf` with `private, no-store` headers.
- [ ] **Step 5: Run API and PDF tests.**

  Run: `npm --workspace services/api test -- src/v2-provider-evidence-route.test.ts`; `python -m pytest tools/anc/pdf_service/test_render.py -q`

  Expected: PASS, including tamper and authorization failures.
- [ ] **Step 6: Commit the artifact change.**

  Commit message: `feat: persist verified quote artifacts`

### Task 4: Make the local n8n workflow activation explicit and fail closed

**Files:**
- Modify: `infra/n8n/workflows/ancfz-v2/04-package-quote.json` only if the callback/status contract needs correction
- Modify: `infra/n8n/workflows/ancfz-v2-templates.test.mjs`
- Modify: `docker-compose.yml`, `.env.example`, or the local import/activation script as needed
- Add: a small local workflow smoke test under `scripts/` or `infra/n8n/workflows/`
- Update: `docs/current-state.md`

**Interfaces:**
- Consumes: published `package.confirm` binding, `ancfzV2PackageQuoteR1`, `ancfz/v2/package-quote`, `N8N_WEBHOOK_SECRET`, `ANCFZ_LOCAL_QUOTE_WORKFLOW`, `ANCFZ_PDF_API_KEY`.
- Produces: a repeatable local setup that reports inactive/missing workflow configuration instead of silently leaving actions pending.

- [ ] **Step 1: Add a configuration smoke test.** Verify the active local registry has exactly the reviewed package workflow, the webhook path resolves, the internal secret is configured, and the PDF service is reachable with the configured key.
- [ ] **Step 2: Keep repository templates inactive by default.** The source JSON must remain safe to import outside the local ANCFZ profile; activation belongs to explicit local setup.
- [ ] **Step 3: Make failure visible to the action state.** A missing workflow or PDF service must produce `failed` or `reconcile_required` with a typed reason and must never write a completed quote result.
- [ ] **Step 4: Run structural and local smoke tests.**

  Run: `node --test infra/n8n/workflows/ancfz-v2-templates.test.mjs`; `docker compose config --quiet`; the local n8n package webhook smoke command.

  Expected: the structural tests pass and a synthetic action reaches a truthful terminal state.
- [ ] **Step 5: Commit the activation/smoke-test change.**

  Commit message: `test: verify local quote workflow activation`

### Task 5: Re-run the complete development journey

**Files:**
- Add or modify: the existing synthetic acceptance runner under `scripts/` or `tools/qa/`
- Modify: `docs/current-state.md`
- Add: a dated verification artifact under `docs/verification/` if the repository convention requires it

**Interfaces:**
- Consumes: consent button → verified Lead → package cards → package selection → n8n action → verified mock PDF → authorized download.
- Produces: a reproducible pass/fail/blocked report with action ID, selection ID, quote ID and artifact hash redacted to safe references.

- [ ] **Step 1: Add the failing acceptance assertions.** Require exactly one selection, one quote, one completed action and one downloadable PDF; assert that the PDF is labeled development/mock evidence.
- [ ] **Step 2: Replay the journey against clean local state.** Do not treat HTTP 202, n8n execution creation or local file existence as completion; wait for the Node action and artifact verification state.
- [ ] **Step 3: Run negative cases.** Include missing Lead verification, revoked consent, stale package price, duplicate click, replayed n8n delivery, wrong tenant/session and tampered PDF.
- [ ] **Step 4: Run the repository checks.**

  Run: `npm test`; `npm run typecheck`; `npm run lint`; `npm run build`; `node --test infra/n8n/workflows/ancfz-v2-templates.test.mjs`; `python -m pytest tools/anc/pdf_service/test_render.py -q`; Docker health checks.

  Expected: all required checks pass, or the verification report names the exact blocked external dependency.
- [ ] **Step 5: Update the canonical state.** Record local development quote status separately from production provider status; do not mark the seven-stage journey complete.
- [ ] **Step 6: Commit the verification and documentation.**

  Commit message: `docs: record quote workflow verification`

### Task 6: Plan the provider-backed production quote phase separately

**Files:**
- Add: a provider-neutral quote contract beside existing lifecycle provider interfaces
- Add: provider sandbox adapter and readback tests
- Modify: `infra/n8n/workflows/ancfz-v2/04-package-quote.json` only after the provider contract is approved
- Add: provider credentials/configuration documentation without committing secrets
- Update: `docs/current-state.md` and `docs/acceptance.md`

**Interfaces:**
- Consumes: a verified package selection, approved catalog price, explicit quote action authorization and provider-neutral request identity.
- Produces: a provider record reference, provider readback evidence, quote artifact hash and a stage status that distinguishes mock PDF, provider-created quote, provider-verified quote and reconciliation-required.

- [ ] **Step 1: Freeze the provider request/response contract.** Define idempotency key, tenant/session/opportunity/catalog references, package reference, amount/currency, quote status, provider record ID and readback evidence.
- [ ] **Step 2: Add contract tests before an adapter.** Reject amount/currency/package mismatches, missing readback, wrong correlation and replayed callbacks.
- [ ] **Step 3: Implement the sandbox adapter behind configuration.** Keep the local mock path available and do not reuse its evidence tier for provider acceptance.
- [ ] **Step 4: Add n8n provider call and verified readback.** Node remains the final verifier; an n8n 2xx or execution ID alone cannot complete the stage.
- [ ] **Step 5: Run provider sandbox acceptance with synthetic customers.** Record failures as `BLOCKED_EXTERNAL_DEPENDENCY` when credentials or approved provider contracts are unavailable.
- [ ] **Step 6: Do not activate production or claim official quotation completion without explicit approval.**

## Self-Review

- The existing local implementation is preserved; the plan adds only the missing bypass, exactly-once, artifact-integrity and reproducibility work before provider integration.
- Every task has a focused test cycle and names the existing code paths it touches.
- The plan keeps the development quote and provider-backed quote evidence tiers separate.
- Browser UI changes are intentionally limited to response metadata; the current package-card and download UI already exists.
- No task deletes repository workflow templates, historical migrations or customer data.

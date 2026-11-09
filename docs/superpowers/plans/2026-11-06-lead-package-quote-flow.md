# Lead-to-Quote Flow Implementation Plan

> Execute this plan in order. Each task has a focused test cycle before the next task.

**Goal:** Complete the ANCFZ local customer journey from button-only contact consent through package selection, Lead creation, quote generation, and a session-authorized downloadable development PDF.

**Design:** `docs/superpowers/specs/2026-11-06-lead-package-quote-flow-design.md`

## Task 1: Freeze button-only consent and terminal action behavior

**Files:**
- Modify `services/api/src/v2-turn-controller.ts`
- Modify `services/api/src/v2-turn-controller.test.ts`
- Modify `services/api/src/app.ts`
- Modify `apps/web/app/page.tsx`
- Modify `apps/web/app/chat-utils.ts` and its tests

**Steps:**

1. Add a failing V2 regression proving typed consent does not grant contact consent or create a Lead action.
2. Add a failing regression proving a consent card is returned and its explicit server-validated button records consent exactly once.
3. Add a failing regression proving a `reconcile_required` Lead action does not cause a new proposal on unrelated turns; only an explicit retry path may create a new revision.
4. Implement the smallest shared consent-card contract and route through the existing session/tenant authorization boundary.
5. Keep the existing explicit Lead confirmation button as a separate action and remove automatic re-proposal after terminal provider failure.
6. Run the focused tests, then the full API suite.

## Task 2: Return approved package choices as chat cards

**Files:**
- Modify `services/api/src/v2-turn-controller.ts`
- Modify `services/api/src/types.ts` or response-local types as needed
- Modify `apps/web/app/chat-utils.ts`, `apps/web/app/page.tsx`, and UI tests

**Steps:**

1. Add a failing test that an approved package question returns every eligible pinned package with safe display fields and no side effect.
2. Add a failing test that package evidence remains grounded when the model omits the optional package tool.
3. Add a failing test that package cards are absent for an unpinned, unavailable, or unapproved offering.
4. Implement the response contract using existing package store/catalog scope; do not accept browser-supplied price or inclusion text.
5. Render accessible package buttons with one clear selection question while preserving normal persona/TTS prose.
6. Run focused controller and web tests.

## Task 3: Make package selection an idempotent guarded action

**Files:**
- Modify `services/api/src/http/schemas.ts`
- Modify `services/api/src/routes/lifecycle.ts` or add a focused lifecycle route module
- Modify `services/api/src/business-lifecycle.ts`
- Modify `services/api/src/actions.ts` and store implementations only where required
- Add/modify API route tests

**Steps:**

1. Add a failing endpoint test for a valid package-card selection tied to the active session opportunity and pinned catalog.
2. Add failing tests for wrong tenant/session/opportunity, stale package, altered price, missing consent, duplicate click, and selection after a terminal action.
3. Implement a single package-selection action path that persists one proposed/confirmed selection and creates the existing `package.confirm` action with stable idempotency.
4. Ensure the browser sends only an opaque offering ID; Node reloads and validates all package facts.
5. Confirm that package selection is the only event that can start quote generation.

## Task 4: Wire the local package/quote workflow and verified PDF artifact

**Files:**
- Modify `infra/n8n/workflows/ancfz-v2/04-package-quote.json`
- Add/modify a small n8n workflow test
- Modify `services/api/src/app.ts`, `services/api/src/types.ts`, store implementations, and migrations
- Reuse `tools/anc/pdf_service` and add tests for its authenticated artifact read path if needed

**Steps:**

1. Add failing tests for the Node internal quote action boundary: exact action correlation, approved package/price, idempotency, private PDF render, SHA-256 verification, and callback completion.
2. Add failing tests for session-authorized quote download and cross-tenant/session denial.
3. Add the smallest quote-artifact persistence model or quote metadata extension needed to retain artifact ID, hash, MIME type, and safe filename.
4. Implement the internal Node endpoint used by the package/quote workflow to create the approved quote from the pinned package and render the development PDF through the private service.
5. Update the n8n package/quote template to call only this Node boundary, preserve claim/guard/callback correlation, and remove the placeholder provider URL from the local path.
6. Return a quote attachment in the chat response/follow-up only after the artifact is verified and the action is completed.
7. Run the n8n structural tests, focused API tests, and PDF-service tests.

## Task 5: Remove unused local n8n workflows safely

**Files/operations:**
- Use the local n8n SQLite database and API/CLI; do not delete repository templates or historical backups.
- Add a short verification record to `docs/current-state.md`.

**Steps:**

1. Back up the live n8n SQLite database to a timestamped file and record its checksum.
2. Verify that the only workflows needed for this slice are the Lead creation, package/quote preparation, and quote PDF workflow IDs; verify no active workflow references the others.
3. Import/update the reviewed Lead, package/quote, and PDF workflows with stable IDs and required local credentials/configuration.
4. Delete only the other local workflow records after the backup and reference check; do not touch database backups or repository JSON templates.
5. Verify the three webhook paths, active states, workflow IDs, and a synthetic end-to-end run. Any missing provider credential must fail visibly and must not create a false CRM/quote success.

## Task 6: Full verification and handoff

1. Run the full API test suite, typecheck, build, changed-file lint, n8n tests, and PDF tests.
2. Rebuild `api`, `web`, `n8n`, and `ancfz-pdf`; verify service health and the quote download path.
3. Replay a complete synthetic conversation: consent button → Lead button → package cards → package selection → quote workflow → PDF download.
4. Check `git diff --check`, inspect changed files, and update `docs/current-state.md` with exact pass/fail/blocked evidence.
5. Do not commit or push unless separately requested.

## Known limits

- The local PDF is development/mock evidence and does not prove production Salesforce or quote-provider completion.
- The existing Postman CLI is currently unavailable because its bundled `@postman/dataset-engine-sdk` module is missing; report that separately if it remains unresolved.

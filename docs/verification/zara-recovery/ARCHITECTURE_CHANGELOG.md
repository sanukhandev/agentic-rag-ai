# Architecture Changelog — Zara Recovery

## M2/M3/M4 checkpoint — 2026-11-04

- Decoupled optional question validation from factual-answer validation. Malformed optional follow-ups are suppressed; required catalog question identity remains strict.
- Preserved candidate planning when response wording is rejected. Node still validates catalog membership, observed customer signals, confirmation and tool eligibility.
- Expanded bounded grounding repair eligibility from exact prefetch to exact prefetch plus successful correlated read-only tool evidence.
- Added source-excerpt recovery only from already authorized evidence, with citation identity and source version preserved.
- Evaluated claim polarity against the relevant source clause rather than the whole mixed-polarity chunk.
- Preserved the public GPT-first session cursor by avoiding a pre-controller session increment; V2 commit remains the atomic session/intent/message write boundary.
- Added development-only diagnostic-capture wiring to Compose, defaulting to disabled.
- Added contextual knowledge retrieval from prior customer formation turns, without treating context as goal confirmation.

No business-action authorization, tenant scope, provider verification or consent gate was removed.

## M5 checkpoint — 2026-11-04

- Added reviewed ANCFZ natural formation aliases to the source fixture and published development Catalog V2 version 2; old sessions remain pinned.
- Accepted natural scoped confirmation forms including `Yes, let's proceed.` without treating confirmation as action consent.
- Added bounded safe recovery for non-knowledge journey statements whose model citation is invalid; factual knowledge and provider outcomes remain fail-closed.
- Excluded question-only and unpunctuated list fragments from source-excerpt recovery.

The public smoke and 25-turn harness pass. Full stage/provider completion is still unverified.

## M7 preparation checkpoint — 2026-11-04

- Added additive `package_offerings.catalog_v2_version_ref` storage with a tenant-scoped FK and one-catalog-identity check; legacy UUID package rows remain supported.
- Updated PostgreSQL and memory stores plus the V2 trusted package read to filter by the pinned canonical V2 catalog reference.
- Added migration-boundary, memory-store isolation and V2 tool-gateway regression coverage.
- Applied migration 059 to the development PostgreSQL instance and rebuilt the API image successfully.

No official ANCFZ pricebook was fabricated. At this checkpoint the database still had zero V2 offerings; the later M7 checkpoint adds only the existing development-only sandbox fixture under a canonical V2 identity.

## M7 V2 package/lifecycle checkpoint — 2026-11-04

- Added migration 060, which reuses the explicitly development-only values from migration 051 as two canonical V2 `package_offerings` rows (`availability=development_only`, source `sandbox-pricebook-v1`, and exclusions stating that they are not official ANCFZ pricing). No production or live-Salesforce pricebook was created.
- Updated the customer-facing package lifecycle helpers to resolve a session-pinned V2 catalog reference and reject offerings from another catalog revision. V2 package listing, selection and deterministic quote creation now share the same tenant/catalog boundary.
- PostgreSQL verification returned exactly two ANCFZ V2 development offerings, both pinned to `anc:r2:1b7342efc6ed15e10c811dd462e192a08bbdf41ea4c89ba6fac9843974b73a67`.
- The formal customer journey remains unverified: package actions still require an authoritative verified Account, and official pricing/Salesforce provider readback are not available in this environment.

## M6/M7 V2 Account lifecycle checkpoint — 2026-11-04

- Replaced the legacy-only Account conversion lookup at the customer lifecycle boundary with a shared resolver for Catalog V2 tool/workflow bindings while preserving legacy catalog behavior.
- V2 Account proposals now carry the bound workflow key, tool action key and canonical `catalogVersionRef`; disabled or incomplete bindings remain unavailable rather than falling back to a hardcoded route.
- Added a regression using an enabled synthetic V2 binding and a qualified synthetic Lead. The real ANCFZ publication remains disabled because its Salesforce/n8n transport is not configured, so no live Account action is claimed.
- API full suite: 61 files / 485 tests PASS; lint, typecheck, build, Docker health and public V2 package smoke PASS. Azure, Salesforce and full seven-stage execution remain unverified.

## M5 contact-cursor checkpoint — 2026-11-04

- Node maps already-masked `[NAME_n]`, `[EMAIL_n]` and `[PHONE_n]` tokens to the published V2 contact requirement keys, persists them in the User Intent Document and session journey slots, and advances `lead_contact_name` → `lead_contact_channel` → `lead_crm_consent` → `lead_action_confirmation`.
- Explicit contact consent is persisted as a visitor fact and session consent state, but it does not satisfy the separate purpose-specific Salesforce action gate.
- Contact events with a rejected model citation/answer now receive a bounded verified-state acknowledgement instead of the generic knowledge fallback.
- Added V2 controller coverage for masked contact persistence, cursor advancement, consent and no-action behavior; added `let us proceed` confirmation coverage.
- Focused suites: 51/51 tests PASS; API full suite: 59 files / 476 tests PASS; Docker public contact smoke reached `lead_action_confirmation` with no action.

## M5 action-proposal checkpoint — 2026-11-04

- Projected enabled non-read-only Catalog V2 bindings into the planner envelope without making them executable model tools.
- Routed an explicit, consented Lead-submission request through the existing Node `ActionGateway` and V2 action gate.
- The gate requires a confirmed goal, published enabled binding, contact consent, purpose-specific consent and an explicit submission request; it creates an awaiting-confirmation proposal only.
- Added regression coverage for the complete contact-consent → explicit Lead-request boundary. No provider dispatch or completion claim was added.
- API lint, typecheck and full suite: PASS (59 files / 477 tests); model-gateway suite: PASS (38 tests); Docker API/model-gateway build: PASS.

The published ANCFZ bindings remain disabled and the Salesforce workflow remains unverified, so this checkpoint does not establish Lead creation.

## M6 provider-evidence checkpoint — 2026-11-04

- V2 provider contracts now accept the authoritative canonical Catalog V2 reference (`anc:r2:<hash>`) instead of incorrectly requiring a legacy UUID.
- Added the authenticated `/api/v2/internal/provider-evidence/verify` boundary. It validates the pinned tenant/session/opportunity/catalog/action/execution tuple, creates the masked local Lead idempotently, and completes only a deterministic mock record whose expected external reference matches the action idempotency key.
- Salesforce and other non-mock provider types are moved to `reconcile_required` until the configured Node Salesforce readback adapter performs independent readback; no provider assertion is trusted as completion.

## V2 Account callback safety checkpoint — 2026-11-05

- Added a regression proving the legacy internal Account remote callback could otherwise mark a V2 Account verified without the V2 provider-evidence/correlation boundary.
- The callback now fails closed with `V2_PROVIDER_EVIDENCE_REQUIRED` before mutating the Account. This is a safety correction, not a provider-completion claim; OTP verification and the Account/Contact/Opportunity adapter remain unimplemented/unverified.

## V2 Account deterministic provider checkpoint — 2026-11-05

- Added protected development-only OTP issue/verify and `/api/v2/internal/provider-evidence/account`, reusing the typed Account provider request/result, exact action correlation and idempotent deterministic adapter.
- Added an integration regression for verified Lead → qualified Lead → OTP → Account provider readback → lifecycle/document advancement and replay; the route never accepts Salesforce as a mock result.
- Corrected trusted V2 completion handling so the session lifecycle and pinned User Intent Document advance together. Real Salesforce Account/Contact/Opportunity creation and restart-durable OTP remain external/unverified gates.

## V2 package/quote state checkpoint — 2026-11-05

- Added a public-route regression for package proposal, approved deterministic quote creation and package confirmation after the verified Account stage.
- Lifecycle advancement now updates the session projection and the pinned V2 User Intent Document together; the tested transition is `package_selection` → `document_upload`.
- This is a development catalog/quote boundary only. Official ANCFZ pricebook, package-provider readback, payment, document review and contract completion remain unverified.
- Regression coverage proves deterministic mock completion and Salesforce fail-closed behavior. The published ANCFZ Salesforce binding remains disabled.
- API full suite: 61 files / 483 tests PASS; typecheck and lint PASS; API image rebuild PASS; rebuilt container healthy and public health endpoint returned HTTP 200; fresh public 25-turn persistence harness PASS.

## V2 document/SF-02 development checkpoint — 2026-11-05

- Public document configuration and upload now support a session-pinned V2 catalog, resolving either the catalog row UUID or canonical version reference and comparing package scope by canonical reference.
- Added a public-route/worker regression covering upload, authenticated worker claim, OCR/review completion, deterministic SF-02 attachment readback and lifecycle advancement to `payment_invoice`.
- API suite: **61 files / 516 tests PASS**; API typecheck and lint PASS. The result is **DEVELOPMENT MOCK ONLY**; Salesforce SF-02 readback, payment and contract providers remain unverified.

## M5 dispatch-bridge checkpoint — 2026-11-04

- Added catalog-declared V2 n8n transport identity fields and preserved blank values as unbound rather than inventing routes.
- The outbox router and action-claim stores now recognize canonical V2 catalog references; PostgreSQL and memory claims require a published enabled workflow, enabled non-read-only tool, matching n8n workflow identity and durable execution correlation.
- V2 claims return masked approved payloads plus Node-verified authorization flags for the n8n stage guard.
- API suite: 60 files / 480 tests PASS; Python ingestion suite: 35 tests PASS.

The provider configuration remains unavailable, so no Salesforce completion is claimed; the authenticated evidence boundary is implemented in the next checkpoint below.
## 2026-11-04 — natural formation and mixed-evidence recovery

- Published ANCFZ Catalog V2 revision 3 with the reviewed `set up a business` formation alias; existing session/catalog pins remain immutable.
- Kept customer-intent validation, claim grounding, question contracts and action authorization as separate decisions.
- Added query-aware evidence projection for broad formation questions and corrected modal source-language classification so general policy statements are not treated as provider completion.
- Added regression coverage at intent evidence, retrieval, claim provenance, coordinator and migration boundaries.
- Final public five-turn replay passes the historical intent/grounding/refusal behavior; full seven-stage provider journey and formal Azure quality gates remain open.

## 2026-11-04 — trusted evidence projection merge correction

- Evidence merging now treats citation/source/version/authorization identity as the conflict boundary, not query-specific projected text.
- Node-prefetched evidence remains authoritative when the same approved citation is returned by a trusted read-only tool with a narrower or different projection.
- Added regression coverage and verified three fresh Azure-backed public 25-turn runs after rebuild: each returned 25/25 answers and persisted 25 unique customer messages.

## 2026-11-04 — pending confirmation continuity and quoted fact recovery

- Scoped pending-goal decisions now distinguish advisory/requirement interruptions from explicit rejection, correction and confirmation.
- Node preserves the pending goal prompt while accepting only quote-validated, non-sensitive visa/timeline facts; corrections replace the prior fact with `corrected=true`.
- Node-authored correction/recap acknowledgements are used only at the pending-goal boundary when model wording cannot pass the response guard; no action authorization is added.
- Added a redacted objective Azure conversation scorer and public-harness fields for groundedness, citations, action proposals and pending intent.
- Live result: 25/25 transport, 25 durable turns, 0.90 objective score (9/10); fallback absence remains the only failed objective check in the final run.

## Explicit initiation and action-gate recovery checkpoint — 2026-11-04

- Node confirmation eligibility now combines independently observed customer initiation evidence with validated catalog membership; GPT's supporting turn category cannot erase a valid formation intent.
- ANCFZ revision 4 adds reviewed natural initiation aliases and uses the canonical SHA-derived catalog reference; migration 063 repairs the local development pin without changing historical migrations.
- Privacy tokenization accepts the bounded synthetic-test name phrase used by the public journey.
- The final response guard rejects known internal requirement keys, and the tool gateway no longer narrates them as customer-facing evidence.
- Disabled Lead bindings now produce a truthful Node-authored response and preserve the pending state; no provider write is attempted.

## Pending non-action recovery checkpoint — 2026-11-04

- Added the smallest Node-side recovery for non-action preferences independent of goal confirmation: advisor preference, privacy refusal after PII masking, contact preference and unfixed budget.
- These branches preserve the pending goal prompt and cannot confirm a goal, grant action consent or dispatch a workflow.
- Focused controller tests: 41/41. Full API suite: 61 files / 507 tests. Typecheck, lint and Docker API build: PASS.
- Fresh public 25-turn regression: 25/25 transport, 25 durable turns, automated objective score 1.00 (10/10). Human Azure quality and provider completion remain unverified.

## 2026-11-05 — deterministic payment and contract boundary

- Reused the pinned Catalog V2 binding identity for public invoice and contract proposals, and added the missing public payment proposal route with explicit payment confirmation.
- Added protected, correlated provider-evidence routes for invoice issuance, payment settlement and contract signing. Provider type, tenant/session/opportunity/catalog/action identity, execution correlation and stage are checked before any local state update.
- Deterministic development providers update invoice/contract records only after scoped mock readback validation. Non-deterministic/unconfigured providers move to reconciliation and never claim completion.
- Invoice issuance does not advance the lifecycle; verified payment advances `payment_invoice` to `contract`, and verified signing completes the final stage.

## 2026-11-05 — durable Account OTP state

- Added additive PostgreSQL migration `064-v2-otp-challenges.sql` with tenant/session scope, expiry, attempt count, one-time-use state and HMAC digest storage; plaintext OTP values are never persisted.
- The default application path now uses the store-backed OTP service. The existing in-memory service remains available for isolated unit tests and explicit dependency injection.
- Verified service recreation, PostgresStore read/update across separate instances, migration application and full local verification. Live Salesforce OTP delivery and provider verification remain external gates.

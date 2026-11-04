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

No synthetic ANCFZ pricebook was re-enabled: the development database still has zero approved offerings, so pricing and quotation acceptance remain blocked on reviewed authoritative data.

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

## M5 dispatch-bridge checkpoint — 2026-11-04

- Added catalog-declared V2 n8n transport identity fields and preserved blank values as unbound rather than inventing routes.
- The outbox router and action-claim stores now recognize canonical V2 catalog references; PostgreSQL and memory claims require a published enabled workflow, enabled non-read-only tool, matching n8n workflow identity and durable execution correlation.
- V2 claims return masked approved payloads plus Node-verified authorization flags for the n8n stage guard.
- API suite: 60 files / 480 tests PASS; Python ingestion suite: 35 tests PASS.

The trusted provider-evidence endpoint and provider configuration remain unimplemented/unavailable, so no Salesforce completion is claimed.

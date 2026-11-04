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

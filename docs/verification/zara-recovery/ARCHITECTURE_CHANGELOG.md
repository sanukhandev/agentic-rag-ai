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

# V2 conversation-runtime security and performance review

**Baseline:** `b8b516b5f1851a9fd6d021142ecea20f4b975e15` (2026-11-04).

## Classification and scope

No deliberately malicious code was established by the focused source review. Defective or excessive validation is **not evidence of malicious intent**.

The accompanying static scan checks ten specific conversation/runtime modules for dynamic evaluation, process execution imports and probable embedded credential literals. It is a tripwire, **not** a complete malware, npm/PyPI supply-chain, prompt-injection or external-network security assessment. Existing `verify:secrets`, lockfile checks, authenticated gateway authorization and the V2 retirement-safety script remain mandatory.

## Confirmed performance/quality defects

| Observation | Origin | Required action | Classification |
|---|---|---|---|
| Any non-OK model read tool replaces the full turn | `v2-coordinator.ts` | Correlate failed required evidence separately from optional reads; stale scope remains blocking | Logic and performance |
| Source-close lexical support accepts one shared topic word | `model.ts` as previously called by V2 evidence | Replace V2 use with per-source claim support; keep verified entailment path | Grounding defect |
| Requirement may be written for an unconfirmed informational goal | `v2-turn-controller.ts` | Authoritative requirement gate and atomic correction cleanup | State defect |
| V2 package and document readers depend on V1 catalog | `v2-tool-gateway.ts` | Use pinned V2 offering/document policies, return explicit missing-data states | Functional gap |
| Repair can consume extra model calls and discard planning | `v2-coordinator.ts`, `v2-turn-controller.ts` | Track reuse/budgets and separate validated plan from answer | Performance/continuity |

## Verified safe-retirement policy

Do not delete V1 code, original migrations, callback validators, action gates, tenant ACLs or runtime provider evidence based on file name or low test coverage. A removal must include:

1. A static import/dependency graph and runtime route/wiring evidence.
2. Replacement coverage for all supported production endpoints.
3. A passing `scripts/check-v2-retirement-safety.mjs` run.
4. No impact to rollback, historical audit records or schema migration.
5. A separate PR with relevant unit-only validation.

## Performance evidence to collect

Per-turn p50/p95 response latency, planning/retrieval/composition/verification/repair durations, model requests, tool calls, cache hit rate and candidate-to-fallback ratio. Do not optimize away verification or weaken business authorization to save latency.

## Findings not established

No live deployment, dependency-provenance inventory, lockfile advisory scan, credentials rotation, network trace, customer data access or malware removal was performed by this documentation-only workstream. Those require a controlled environment and supporting evidence.

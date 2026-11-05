# Zara Conversation Engine Recovery — Baseline Report

**Date:** 2026-11-04
**Branch:** `fix/zara-conversation-engine-end-to-end-recovery`
**Base/observed HEAD:** `ba1e29f9c79d2ac8214dce0fcd6f95aae7c6563f`
**Environment:** Development only; synthetic/public test tenant data

## Source-control baseline

- Current checkout was clean before this recovery branch was created.
- Remote heads were fetched; only `main` and `feat/gpt-first-langgraph-unit-only` were present.
- Recovery branch was created from the fetched base HEAD in the existing single worktree.

## Static baseline

| Check | Result | Evidence |
| --- | --- | --- |
| Workspace unit tests | PASS | Admin 48, Web 15, API 456, Chat Utils 3, Contracts 3; 525 total, 0 failures |
| V2 runtime safety | PASS | `node scripts/check-v2-runtime-safety.mjs` |
| V2 retirement safety | PASS | 58 migrations, 21 protected modules, 9 approved Python tools |
| Compose verification | PASS | `npm run verify:compose` |
| Secret test suite | PASS | 2/2 tests |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Build | PASS | Admin, Web, API, Chat Utils and Contracts builds completed |

These checks establish a clean code baseline only. They do not establish customer journey acceptance.

## Runtime baseline

`docker compose config --quiet` passed. The development stack had PostgreSQL, Redis, API, model gateway, web, admin, nginx, n8n, event relay, event worker, and ingestion running. The optional `ancfz-pdf` and `mock-payments` containers were restarting; their availability is not treated as verified.

The existing read-only `Diagnose-ZaraV2.ps1` reported:

- V2 enabled for the configured ANCFZ tenant.
- Private model gateway configured.
- Compiled coordinator gate: `trusted-prefetch`.
- Repair and claim diagnostics present in the running API image.
- 8 active public embedded sources, 1,013 active public chunks, 0 revoked sources.

## Public API reproduction

Fresh public sessions were created through `/api/v1/chat/sessions` and turns were sent through `/api/v1/chat/messages` with the returned session token. Responses were redacted to answer/grounding/citation/state metadata.

| Turn | Customer input | Observed result | Runtime evidence |
| --- | --- | --- | --- |
| 1 | `hello` | Zara greeting accepted | `accepted_model_dialogue`, no tools |
| 2 | `Tell me about company formation` | Generic “cannot verify” fallback | Historical/current audit includes `invalid_question` with 4 prefetched excerpts |
| 3 | `How does it work?` | Generic “cannot verify” fallback | Historical/current audit includes `unsupported_claim`, tool retrieval and claim rejection |
| 4 | `I want to start company formation` | Generic “I can help you work through that” response; no pending goal key | `get_missing_requirements` read tool ran; no goal confirmation persisted |
| 5 | `No, not now` after the initiation turn | Same generic response repeated | No pending goal-confirmation record existed to classify the refusal |

Runtime audit rows confirmed the following failure codes without storing raw draft/source text: `invalid_question`, `unsupported_claim`, `claim_source_polarity_mismatch`, `safe_no_evidence_dialogue`, and successful `search_knowledge`/`get_missing_requirements` tool statuses.

## External gates

- Live Azure deployment: configured in the development stack, but no fixed three-run evaluation has been executed for this recovery baseline.
- Salesforce sandbox: not exercised in this baseline; no provider completion is claimed.
- Full seven-stage journey: NOT RUN.
- Browser E2E: NOT RUN.


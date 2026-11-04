# Zara Conversation Engine Recovery — Root-Cause Analysis

## Failure ZARA-001 — formation knowledge answer rejected as `invalid_question`

- **Customer message:** `Tell me about company formation`
- **Expected behavior:** A relevant approved-knowledge answer; an optional follow-up may be suppressed if its metadata is invalid.
- **Actual behavior:** Generic guarded fallback; the public answer incorrectly implied the approved information could not be used.
- **Relevant branch/commit:** `fix/zara-conversation-engine-end-to-end-recovery` at baseline `ba1e29f9c79d2ac8214dce0fcd6f95aae7c6563f`.
- **Failing runtime component:** `services/api/src/v2-response-guard.ts`, then `services/api/src/v2-coordinator.ts`.
- **Actual failure code:** `invalid_question`; final fallback was selected.
- **Root cause (confirmed):** `questionFailure()` ran before evidence validation and returned a rejected whole-response verdict. The coordinator then treated the candidate as unusable instead of independently validating the factual answer and removing only the optional question.
- **Reproduction method:** Fresh public API session; diagnostic audit showed 4 prefetched excerpts and `invalid_question`.
- **Regression test:** `services/api/src/v2-response-guard.test.ts` — malformed optional question is suppressed while the grounded answer survives.
- **Correction:** Optional question validation is now independent; required question identity remains strict. The original question failure is retained as diagnostic metadata.
- **Unit/integration/Docker/Azure result:** Unit PASS; public Docker API PASS after correction; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; full acceptance remains open.

## Failure ZARA-002 — contextual formation follow-up rejected as `unsupported_claim`

- **Customer message:** `How does it work?` after a formation question.
- **Expected behavior:** Continue the formation topic using authorized evidence retrieved during the model tool loop.
- **Actual behavior:** Generic “cannot verify” fallback despite a successful `search_knowledge` call in the recorded trace.
- **Failing runtime component:** `services/api/src/v2-coordinator.ts`; evidence correlation/repair boundary.
- **Actual failure codes:** `unsupported_claim`; historical audit also recorded `claim_source_polarity_mismatch`.
- **Root cause (confirmed):** Grounding repair/independent review was gated by exact Node prefetch (`hasTrustedPrefetch`). Evidence returned by a successful correlated read tool was merged for citation checking but was not eligible for the same bounded repair/review path. The existing per-source polarity logic also evaluates source text at a broader boundary than the individual relevant clause in mixed-polarity excerpts.
- **Reproduction method:** Fresh/public and historical diagnostic rows; `search_knowledge` status `ok`, citations present in candidate trace, final evidence/fallback rejected.
- **Regression test:** `services/api/src/v2-coordinator.test.ts` — successful correlated read-tool evidence is eligible for one bounded repair; `v2-claim-provenance.test.ts` covers mixed-polarity source clauses.
- **Correction:** Trusted evidence now includes exact prefetch plus successful correlated read-tool evidence. Repair is source-bound; a bounded exact excerpt can be returned only when independent review is not active. Source polarity is evaluated against the relevant source clause.
- **Unit/integration/Docker/Azure result:** Focused tests PASS; public Docker contextual follow-up returns grounded cited text on repeated runs; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; retrieval quality and full evaluation remain open.

## Failure ZARA-003 — explicit initiation did not reach goal confirmation

- **Customer message:** `I want to start company formation`
- **Expected behavior:** Node validates observed formation intent and asks for explicit goal confirmation without creating a Lead.
- **Actual behavior:** Generic dialogue; no `pendingIntentKey`, pending requirement, or goal-confirmation record.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` and the final-response dependency in the coordinator.
- **Actual failure code:** Candidate final answer was rejected/replaced as `unsupported_claim`/`safe_no_evidence_dialogue`.
- **Root cause (confirmed):** `modelPlan` was read only when `result.guardReason` was `accepted`, `accepted_model_dialogue`, `accepted_entailment`, or `accepted_knowledge_repair`. A valid model planning proposal contained in the rejected candidate response was therefore discarded before Node catalog/evidence validation. The read tool was allowed to run, but it was not an authorization decision and could not create the goal.
- **Reproduction method:** Fresh public API session; `get_missing_requirements` returned `ok`; no goal confirmation was persisted.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` — rejected final answer with a valid candidate plan still creates a pending confirmation prompt and no action.
- **Correction:** Node now validates the candidate plan independently of final response acceptance and persists only catalog/evidence-validated proposals.
- **Unit/integration/Docker/Azure result:** Unit PASS; public Docker API creates `anc.company_formation` pending confirmation with no action; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; journey completion remains open.

## Failure ZARA-004 — refusal repeated the generic response

- **Customer message:** `No, not now`
- **Expected behavior:** Respect a refusal only if it answers an active confirmation prompt; otherwise continue naturally without inventing a rejection event.
- **Actual behavior:** The previous generic response was repeated.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` state boundary, downstream of ZARA-003.
- **Actual failure code:** `safe_no_evidence_dialogue`; no pending confirmation existed.
- **Root cause (confirmed):** Because the initiation turn did not persist `goalConfirmation.status=pending`, `classifyScopedGoalDecision()` had no scoped prompt to evaluate. The coordinator then produced another generic no-evidence dialogue and the controller persisted no refusal transition.
- **Reproduction method:** Two-turn fresh public API session; both turns returned the same generic response; the intent document had no goal key or confirmation record.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` covers scoped rejection and no action; public Docker API reproduced `No, not now` after the pending prompt.
- **Correction:** The public route no longer increments the session cursor before the atomic V2 turn commit; this preserves the prompt cursor and prevents false `V2_GOAL_CONFIRMATION_STALE` errors.
- **Unit/integration/Docker/Azure result:** Unit PASS; public Docker API PASS with cleared pending prompt and no action; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; full acceptance remains open.

## Additional confirmed baseline gap

The repository documentation explicitly marks the Python↔Node tool loop, final persona composer, full seven-stage provider verification, and live Azure acceptance as incomplete. These are not inferred from the four messages and remain separate acceptance gates after the focused corrections.

## Failure ZARA-005 — correlated package evidence was queried as a UUID source

- **Customer message:** `Show only officially approved package information.`
- **Expected behavior:** A truthful approved-package response or a specific published-data limitation; the public chat request must complete and persist.
- **Actual behavior:** HTTP 400 `INVALID_DATA` after 11 successful public turns in the existing 25-turn harness.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` citation resolution.
- **Actual failure code:** PostgreSQL `22P02`; database log: `invalid input syntax for type uuid: "tool-get_available_packages"`.
- **Root cause (confirmed):** Read-only tool evidence uses synthetic `tool-*` provenance and is trusted through the correlated tool trace. `resolvePublicCitations()` attempted to resolve that synthetic source reference through the PostgreSQL source table, whose identifier is a UUID.
- **Reproduction method:** `python tools/anc/acceptance/api_25_turns.py --api-base http://127.0.0.1:80 --tenant anc --scenarios 1`; first run stopped at turn 12 and PostgreSQL recorded the exact error.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` verifies tool evidence does not call `getSource()`.
- **Correction:** Public-source citation lookup now skips `tool-*` provenance while retaining the trusted tool evidence in the guarded response path.
- **Unit/integration/Docker/Azure result:** Focused controller suite 31/31 PASS; rebuilt Docker API; rerun public harness 25/25 turns and durable history PASS. Live three-run Azure evaluation remains NOT RUN.
- **Regression status:** FIXED for the reproduced public API path.

## Failure ZARA-006 — short structured ingestion evidence was discarded

- **Customer message:** `What is the XLSX plan?`
- **Expected behavior:** The local ingestion acceptance source (`XLSX approved 30`) should produce a grounded answer with its authorized citation.
- **Actual behavior:** `acceptance:local` returned a deterministic ungrounded abstention even though the source was published.
- **Failing runtime component:** `services/api/src/model.ts` deterministic grounded fallback.
- **Actual failure code:** No HTTP error; `grounded=false`, `citations=[]`.
- **Root cause (confirmed):** The fallback only selected prose fragments longer than 24 characters. XLSX extraction preserved the relevant table row as a short line, so no evidence sentence was eligible for composition.
- **Reproduction method:** `npm run acceptance:local`; direct model reproduction with `Plan Price\nXLSX approved 30`.
- **Regression test:** `services/api/src/model.test.ts` verifies a relevant short structured line is cited and returned.
- **Correction:** The deterministic fallback now admits a query-relevant, non-boilerplate structured line of at least 8 characters; unrelated short lines remain excluded.
- **Unit/integration/Docker/Azure result:** Model suite 21/21 PASS; `npm run acceptance:local` PASS. Latest Docker rebuild and live Azure three-run evaluation are pending this checkpoint.
- **Regression status:** FIXED for the local ingestion acceptance path.

## Harness mismatch ZARA-007 — stale combined contact prompt assertion

- **Observed test:** `npm run acceptance:seed`.
- **Expected by old harness:** The name response would ask for `email address or phone` together.
- **Actual contract:** Contact requirements are collected one at a time; the action gate requires both fields.
- **Correction:** `scripts/seed-local.mjs` now accepts either valid first contact prompt, supplies synthetic email and phone in separate turns, and retains the action confirmation/idempotency assertions.
- **Result:** Synthetic tenant A/B acceptance PASS.

## Failure ZARA-008 — confirmation grammar rejected natural approval

- **Customer message:** `Yes, let's proceed.` after a scoped company-formation confirmation prompt.
- **Expected behavior:** Confirm the proposed goal, initialize the authoritative journey, and continue without repeating the prompt.
- **Actual behavior:** The classifier returned `ambiguous`; the prompt was repeated.
- **Failing runtime component:** `services/api/src/conversation-state.ts`.
- **Actual failure code:** `ambiguous` scoped goal decision.
- **Root cause (confirmed):** The confirmation grammar accepted `Yes, proceed.` but not the natural contraction `let's proceed`.
- **Reproduction method:** Fresh public Docker session with `I want to open a company in Ajman.` followed by `Yes, let's proceed.`.
- **Regression test:** `services/api/src/conversation-state.test.ts` covers the exact contraction.
- **Correction:** Added bounded `let's proceed` / `let us proceed` confirmation forms; no consent or side effect is inferred.
- **Result:** Focused coordinator/state suites PASS; public confirmation persists `goalConfirmed=true` and creates no action.

## Failure ZARA-009 — invalid journey citation erased safe continuity

- **Customer message:** `My business is technology consulting.` or `I need two visas.` after confirmed formation.
- **Expected behavior:** Preserve independently verified facts and return a safe persona acknowledgement when a non-knowledge citation is invalid.
- **Actual behavior:** `invalid_citation` could fall through to the generic “cannot verify” response, despite Node persisting the fact.
- **Failing runtime component:** `services/api/src/v2-coordinator.ts`.
- **Actual failure code:** `invalid_citation` / `unsupported_claim` on a non-factual journey statement.
- **Root cause (confirmed):** Factual citation recovery and non-factual journey dialogue shared the same terminal fallback.
- **Reproduction method:** Fresh public Docker session; audit showed a candidate citation while the intent document retained the visitor fact.
- **Regression test:** `services/api/src/v2-coordinator.test.ts` covers an unavailable citation on a verified customer fact.
- **Correction:** Bounded journey-shaped, non-knowledge statements now discard the bad citation and use guarded non-factual acknowledgement; knowledge and provider/action claims remain strict.
- **Result:** Coordinator suite PASS; public smoke returns safe acknowledgements and preserves state.

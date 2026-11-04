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
- **Regression test:** To be added before the correction: cited answer + malformed optional question metadata must return the answer with `nextQuestion=null` and retain `invalid_question` diagnostics.
- **Correction:** Pending in M2.
- **Unit/integration/Docker/Azure result:** Baseline unit PASS; regression NOT RUN; live Docker reproduction FAIL; Azure acceptance NOT RUN.
- **Regression status:** OPEN.

## Failure ZARA-002 — contextual formation follow-up rejected as `unsupported_claim`

- **Customer message:** `How does it work?` after a formation question.
- **Expected behavior:** Continue the formation topic using authorized evidence retrieved during the model tool loop.
- **Actual behavior:** Generic “cannot verify” fallback despite a successful `search_knowledge` call in the recorded trace.
- **Failing runtime component:** `services/api/src/v2-coordinator.ts`; evidence correlation/repair boundary.
- **Actual failure codes:** `unsupported_claim`; historical audit also recorded `claim_source_polarity_mismatch`.
- **Root cause (confirmed):** Grounding repair/independent review was gated by exact Node prefetch (`hasTrustedPrefetch`). Evidence returned by a successful correlated read tool was merged for citation checking but was not eligible for the same bounded repair/review path. The existing per-source polarity logic also evaluates source text at a broader boundary than the individual relevant clause in mixed-polarity excerpts.
- **Reproduction method:** Fresh/public and historical diagnostic rows; `search_knowledge` status `ok`, citations present in candidate trace, final evidence/fallback rejected.
- **Regression test:** To be added before the correction: correlated successful `search_knowledge` evidence must be passed into one no-tool repair attempt and accepted only if the repaired answer cites the exact evidence.
- **Correction:** Pending in M3; source-clause polarity test also required.
- **Unit/integration/Docker/Azure result:** Baseline unit PASS; regression NOT RUN; live Docker reproduction FAIL; Azure acceptance NOT RUN.
- **Regression status:** OPEN.

## Failure ZARA-003 — explicit initiation did not reach goal confirmation

- **Customer message:** `I want to start company formation`
- **Expected behavior:** Node validates observed formation intent and asks for explicit goal confirmation without creating a Lead.
- **Actual behavior:** Generic dialogue; no `pendingIntentKey`, pending requirement, or goal-confirmation record.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` and the final-response dependency in the coordinator.
- **Actual failure code:** Candidate final answer was rejected/replaced as `unsupported_claim`/`safe_no_evidence_dialogue`.
- **Root cause (confirmed):** `modelPlan` was read only when `result.guardReason` was `accepted`, `accepted_model_dialogue`, `accepted_entailment`, or `accepted_knowledge_repair`. A valid model planning proposal contained in the rejected candidate response was therefore discarded before Node catalog/evidence validation. The read tool was allowed to run, but it was not an authorization decision and could not create the goal.
- **Reproduction method:** Fresh public API session; `get_missing_requirements` returned `ok`; no goal confirmation was persisted.
- **Regression test:** To be added before the correction: rejected final answer + valid candidate plan must still create a pending confirmation prompt and no action.
- **Correction:** Pending in M3.
- **Unit/integration/Docker/Azure result:** Baseline unit PASS; regression NOT RUN; live Docker reproduction FAIL; Azure acceptance NOT RUN.
- **Regression status:** OPEN.

## Failure ZARA-004 — refusal repeated the generic response

- **Customer message:** `No, not now`
- **Expected behavior:** Respect a refusal only if it answers an active confirmation prompt; otherwise continue naturally without inventing a rejection event.
- **Actual behavior:** The previous generic response was repeated.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` state boundary, downstream of ZARA-003.
- **Actual failure code:** `safe_no_evidence_dialogue`; no pending confirmation existed.
- **Root cause (confirmed):** Because the initiation turn did not persist `goalConfirmation.status=pending`, `classifyScopedGoalDecision()` had no scoped prompt to evaluate. The coordinator then produced another generic no-evidence dialogue and the controller persisted no refusal transition.
- **Reproduction method:** Two-turn fresh public API session; both turns returned the same generic response; the intent document had no goal key or confirmation record.
- **Regression test:** To be added before the correction: initiation creates a pending prompt; `No, not now` transitions that prompt to rejected without creating an opportunity/action and responds naturally.
- **Correction:** Pending in M5, enabled by the independent-plan fix.
- **Unit/integration/Docker/Azure result:** Baseline unit PASS; regression NOT RUN; live Docker reproduction FAIL; Azure acceptance NOT RUN.
- **Regression status:** OPEN.

## Additional confirmed baseline gap

The repository documentation explicitly marks the Python↔Node tool loop, final persona composer, full seven-stage provider verification, and live Azure acceptance as incomplete. These are not inferred from the four messages and remain separate acceptance gates after the focused corrections.


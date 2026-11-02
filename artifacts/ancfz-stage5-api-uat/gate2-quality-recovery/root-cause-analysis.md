# ANC GPT-5.4 quality recovery — initial root-cause analysis

Date: 2026-11-02 UTC
Branch: `feat/conversation-v2-langgraph-stage5-safe`
Reference evidence: `artifacts/ancfz-stage5-api-uat/gate2-retest/final-acceptance-v2/`

## Baseline

The historical Azure run reports 23 durable model turns, 36 model requests, 14 trusted tool calls, 2 accepted model-authored responses, and 21 rejected turns. The reported overall model acceptance is 2/23 (8.7%). The mock run is 19/23 (82.6%), so the low Azure result is not evidence that the business workflow itself is unable to complete.

## Confirmed root cause: per-turn audit correlation is unsafe

`tools/qa/ancfz-stage5-api-conversation.mjs` queries the latest `v2.model.turn` or `v2.model.error` row by tenant and session only. It does not require the audit row to match the current `clientMessageId`.

`services/api/src/app.ts` writes `v2.model.turn` metadata with `sessionId`, model/tool counters, guard reasons and execution path, but not `clientMessageId`.

The historical redacted transcript contains a `v2Audit` object for all 25 customer turns, while the same report records only 23 durable model-turn events. This is direct evidence that at least two transcript rows can carry stale audit metadata from a prior turn. The report therefore cannot safely associate every displayed guard reason with the customer message that produced it.

Impact: the acceptance percentage is a durable aggregate, but turn-level rejection analysis and customer-question mapping are not reliable until audit rows are correlated to the current request. This is a telemetry/UAT correctness defect, not a reason to relax the response guard.

Smallest fix: persist the existing `clientMessageId` in v2 model audit metadata and add the same value to the runner's latest-audit predicate. Add a regression test at that schema boundary.

## Confirmed diagnostic evidence gap

The historical JSON evidence records delivered responses, final/candidate guard reason labels, citations and some tool summaries. It does not preserve the original GPT candidate text or a claim-level mapping between that candidate and the approved evidence available to Node. The untracked diagnostic artifacts inspected for this run do not add that mapping.

Accordingly:

- The three `model_or_tool_unavailable` candidate outcomes are classified as `MODEL_OR_TOOL_FAILURE` because the telemetry directly records that failure mode.
- The 17 `unsupported_claim` outcomes are classified as `INSUFFICIENT_DIAGNOSTIC_EVIDENCE`; they cannot safely be called true unsupported claims or false-positive rejections from the retained evidence.
- The one `invalid_question` outcome is also `INSUFFICIENT_DIAGNOSTIC_EVIDENCE`; the original question and authoritative pending key are not retained together.
- The two accepted outcomes are not rejection events.

This distinction is intentional. It prevents the recovery from weakening claim validation based on an unreviewable aggregate label.

## Runtime path reviewed

1. Python `BoundedConversationAgent` calls the configured model, executes only the allowlisted read tools, converts approved `search_knowledge` results to `ApprovedEvidenceV2`, and returns the candidate response plus tool traces.
2. Node `V2Coordinator` combines the candidate, tool traces and approved evidence, then calls `guardV2Response`.
3. If the candidate is rejected, the coordinator may use the bounded duplicate-question repair or a safe no-evidence/offline fallback. The delivered response is not equivalent to an accepted GPT response.
4. Node persists the v2 model audit event, but the current event lacks the request correlation field needed by the UAT runner.

## What is not yet established

The retained evidence does not prove whether any of the 17 `unsupported_claim` events was a true hallucination, an evidence-propagation false negative, or a valid claim rejected by policy. No response-guard change is justified until a rerun with correlated audit rows and candidate-level diagnostics supplies that evidence.

## Planned targeted changes

1. Correlate v2 audit events to `clientMessageId` without changing authorization or guard semantics.
2. Add a regression test before implementation.
3. Rerun the bounded Azure scenario and regenerate per-turn metrics in a new evidence directory.
4. Only then make a narrowly scoped evidence/guard/composer change if the new evidence identifies a reproducible false rejection or relevance defect.

## Post-fix findings

The correlated reruns confirmed that the original audit association defect was
real and fixed: the final run has one audit lookup per current
`clientMessageId`, with no stale-row substitution. The trusted evidence path
was also incomplete. Python previously converted only `search_knowledge`
results to model evidence, while Node returned useful scoped data from journey,
requirement, package, document, action and catalog reads without a common
evidence envelope. The focused regression tests reproduced that gap and now
pass after the small shared `toolEvidence` conversion was added.

The final Azure rerun at the committed fix SHA recorded 23 model turns, 36
requests, 17 trusted tool calls, 16 persisted tool-read events and 3 accepted
model-authored responses (13.04%). Candidate reasons were 3 accepted, 15
`unsupported_claim` and 5 `model_or_tool_unavailable`; the delivered guard
reasons were 3 accepted, 14 `unsupported_claim`, 1
`safe_no_evidence_dialogue` and 5 unavailable. There
were no provider error events. The original candidate text is still not part of
the retained redacted evidence, so the 15 candidate unsupported-claim events
remain `INSUFFICIENT_DIAGNOSTIC_EVIDENCE`, not proven hallucinations. The 5
unavailable outcomes are directly classified as model/tool failures.

The changes preserve fail-closed response validation. They do not make model
citation IDs authoritative, allow customer facts to prove provider outcomes,
or bypass consent and action authorization. The Azure dialogue target remains
failed; the mock workflow and security gates remain passing.

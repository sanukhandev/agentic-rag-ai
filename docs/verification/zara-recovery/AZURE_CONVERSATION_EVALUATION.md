# Azure Conversation Evaluation

**Status:** FAIL — transport and persistence pass, conversation-quality gate does not.

- Development model gateway reports `MODEL_MODE=azure`.
- Three independent live public runs were executed against the configured Azure gateway:
  - `artifacts/ancfz/azure-eval-run-1.json` — session `d1d7eec3-170f-4162-b73a-4546bba17655`, 25/25 HTTP and durable turns.
  - `artifacts/ancfz/azure-eval-run-2.json` — session `f18aa3a-1...`, 25/25 HTTP and durable turns.
  - `artifacts/ancfz/azure-eval-run-3.json` — session `92f2e75f...`, 25/25 HTTP and durable turns.
- All three runs showed the same quality failure before the recovery changes: generic fallbacks, context drift, and no confirmed goal progression. Therefore the mandatory per-run `>=90%` quality gate is **FAIL**, not averaged or reclassified as a pass.
- The post-fix Docker five-turn replay passes the critical intent/refusal behavior and returns grounded cited formation text.
- Fresh post-fix public Azure-backed persistence runs now pass independently:
  - `artifacts/ancfz/azure-eval-final-run-1.json` — 25/25 HTTP answers, 25 durable user messages.
  - `artifacts/ancfz/azure-eval-final-run-2.json` — 25/25 HTTP answers, 25 durable user messages.
  - `artifacts/ancfz/azure-eval-final-run-3.json` — 25/25 HTTP answers, 25 durable user messages.
- The intermediate post-fix run exposed `V2_EVIDENCE_CONFLICT` at turn 21 when prefetch and a trusted tool returned different text projections for the same citation. The merge-boundary fix was rebuilt and the three final runs passed afterward.
- These artifacts prove live Azure transport, guarded response completion and persistence; the harness does not capture a frozen conversation-quality rubric, token usage or latency, so the mandatory per-run `>=90%` quality gate remains **UNVERIFIED**, not a claimed pass.

## Objective scorer and pending-goal recovery rerun

The public harness now records redacted answer digests, grounded/citation flags, action-proposal flags and pending intent state. The scorer is objective transport/state evidence, not a human persona-quality substitute.

- Final artifact: `artifacts/ancfz/azure-eval-final-correction-detector.json` and `artifacts/ancfz/azure-eval-final-correction-detector-scored.json`.
- Result: 25/25 HTTP answers, 25 durable user messages, 0.90 automated objective score (9/10 checks).
- PASS: transport, grounded formation answer, formation context, correction retention, recap facts, no unrequested action, no internal payload leak, no false provider completion, durable history.
- FAIL: fallback-cascade absence; three generic fallback responses remained in this stochastic run, on package information/adviser/privacy turns.
- Human persona quality review: `NOT_RUN`.
- Salesforce/provider completion: `NOT_VERIFIED_BY_THIS_HARNESS`.

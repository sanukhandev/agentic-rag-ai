# Azure Conversation Evaluation

**Status:** FAIL — transport and persistence pass, conversation-quality gate does not.

- Development model gateway reports `MODEL_MODE=azure`.
- Three independent live public runs were executed against the configured Azure gateway:
  - `artifacts/ancfz/azure-eval-run-1.json` — session `d1d7eec3-170f-4162-b73a-4546bba17655`, 25/25 HTTP and durable turns.
  - `artifacts/ancfz/azure-eval-run-2.json` — session `f18aa3a-1...`, 25/25 HTTP and durable turns.
  - `artifacts/ancfz/azure-eval-run-3.json` — session `92f2e75f...`, 25/25 HTTP and durable turns.
- All three runs showed the same quality failure before the recovery changes: generic fallbacks, context drift, and no confirmed goal progression. Therefore the mandatory per-run `>=90%` quality gate is **FAIL**, not averaged or reclassified as a pass.
- The post-fix Docker five-turn replay now passes the critical intent/refusal behavior and returns grounded cited formation text, but a fresh three-run Azure quality evaluation after the final fix has not yet been completed.
- Token/latency metrics and a formal frozen-dataset rubric were not captured by the existing harness; no numeric quality score is claimed.

# ANC Azure GPT-5.4 quality recovery report

Date: 2026-11-02 UTC
Branch: `feat/conversation-v2-langgraph-stage5-safe`
Execution source SHA recorded by the runner: `eace2f75929a1084054a0ed19f6c507cd70301a1`
Reproducible committed source SHA: `cd11c8eee7c559e8ed95b774d125d0908b705edf`
Deployment: `gpt-5.4`
Result: **`GATE_2_GPT54_DIALOGUE_FAILED`**

## Before versus final

| Metric | Historical baseline | Final bounded rerun |
|---|---:|---:|
| Durable model turns | 23 | 23 |
| Model requests | 36 | 36 |
| Trusted tool calls | 14 | 17 |
| Accepted model-authored responses | 2 | 3 |
| Overall acceptance | 2/23 = 8.7% | 3/23 = 13.04% |
| Eligible dialogue acceptance | Not measured | Not measured |
| Candidate `unsupported_claim` | 17 | 15 |
| Model/tool unavailable | 3 | 5 |
| Provider errors | Not separated | 0 |
| Security regression | 9/9 | 9/9 |

The 80% acceptance target was not met. Eligible-dialogue acceptance is not
reported because the redacted retained evidence has no original candidate text
or claim-to-evidence mapping. Excluding difficult turns after the fact would
make the metric misleading.

## What was verified

- Real Azure calls were made through the isolated LangGraph gateway with
  deployment `gpt-5.4`; no credentials were written to artifacts.
- The 25-turn scenario completed 30/31 assertions. The only failure was the
  model-authored acceptance threshold.
- Trusted read evidence is now bounded and source-versioned for journey state,
  requirements, packages, document requirements, action status and the intent
  catalog. The response guard remains the final authority.
- Durable lifecycle state was correct: Stages 1–5 completed, last completed
  stage `document_upload`, current/next stage `billing_invoice`.
- Local document upload/OCR and deterministic SF-02 mock evidence were
  verified separately. No payment, invoice or contract action ran.
- The separate mock suite passed 39/39 assertions and the security suite passed
  9/9.

## Rejection interpretation

The final run had 15 candidate `unsupported_claim` labels, but the source did
not retain candidate prose. They are therefore `INSUFFICIENT_DIAGNOSTIC_EVIDENCE`,
not confirmed hallucinations and not confirmed false positives. Five
`model_or_tool_unavailable` outcomes are directly classified as model/tool
failures. No unsupported consequential claim or fabricated provider success was
delivered in the retained transcript.

See `root-cause-analysis.md` and
`candidate-rejection-classification.json` for the per-run diagnostic boundary.

## Remaining blockers

1. Improve candidate-level Azure dialogue acceptance while preserving the
   guard; the observed final rate is 13.04%.
2. Retain bounded, redacted candidate/claim diagnostics in a future run so
   unsupported-claim outcomes can be classified rather than guessed.
3. Full repository Python has three unrelated failures: one workflow fixture
   expectation and two missing `bs4` ingestion dependencies.
4. Salesforce sandbox is not configured; only `SF02_MOCK_VERIFIED` is proven.

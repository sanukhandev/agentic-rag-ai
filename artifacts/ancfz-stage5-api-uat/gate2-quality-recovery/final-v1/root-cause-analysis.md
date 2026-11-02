# ANC Gate 2 quality recovery — root-cause analysis

Official final Azure run: `azure-retest-v13`, 2026-11-02, commit `b935dd0`,
deployment `gpt-5.4`, 23 model turns, 21 accepted model-authored responses.

The earlier low rate was not evidence of 17 hallucinations. The retained
turn-correlated diagnostics show a mixture of guard false positives,
recoverable formatting errors, unsupported model claims, and model/tool
failures. The final run contains no delivered unsupported consequential claim.

Final rejected candidates:

- Turn 19 — `OUTPUT_FORMAT_ERROR`: the candidate exposed `[ID_1]` as a stage
  placeholder in customer-visible text. Node rejected it; no raw candidate was
  delivered.
- Turn 22 — `QUESTION_POLICY_MISMATCH`: the candidate was a bounded uncertainty
  response with a safe package-review offer, but that exact harmless wording was
  outside the constrained no-evidence allowlist. Node delivered a safe fallback.

The v10–v12 runs also established the repaired causes: duplicate trailing
questions, case-sensitive question matching, missing bounded vocabulary for
verified fact corrections, contact-detail prefacing, stage placeholders, and
missing trailing-question formatting. Unknown citations, unsupported prices or
policies, provider-completion claims, invalid questions and tool failures remain
fail-closed.

Historical candidate text that was not retained is classified as
`INSUFFICIENT_DIAGNOSTIC_EVIDENCE`; it is not reclassified retrospectively.

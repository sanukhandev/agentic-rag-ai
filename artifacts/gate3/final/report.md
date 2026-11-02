# Gate 3 final integration report

## Verdict

**GATE_3_PARTIALLY_VERIFIED**

The new branch is safe and isolated from PR #126. Deterministic mock lifecycle, security, restart/replay and document/SF-02 mock evidence passed. The protected real-Azure conversation gate did not preserve the Gate 2 baseline, so production acceptance is blocked.

Implementation commit before evidence packaging: `a4d4fdd22ccbf47fe20fafebf12799a8d8b66cf8`.

## Protected Azure quality

Deployment: `gpt-5.4`. Required result: `21/23` on all three runs, with all 21 previously accepted case identities preserved.

- Official run 1: `18/23`, failed.
- Official run 2: `15/23`, failed.
- Official run 3: `15/23`, failed.

The retained diagnostics show a mixture of safe uncertainty/customer-fact candidates rejected by the guard, missing/insufficiently propagated evidence references, model/tool-unavailable turns, and output-format placeholders. The available redacted evidence is insufficient to label every rejected candidate a confirmed hallucination. No unsupported consequential claim was delivered in these runs.

## Reliability and lifecycle

The disposable UAT stack passed 34/34 restart/replay checks. It restarted API, model gateway, event worker, event relay and Redis while retaining the session. It verified exactly one synthetic Lead, one Account, one document, completed OCR, one verified deterministic SF-02 receipt, idempotent message/document/action/callback retries, forged callback rejection and cross-tenant rejection.

The mock conversation UAT passed 39/39 assertions. Durable lifecycle evidence is:

`lead_generation=completed → lead_qualification=completed → account_creation=completed → package_selection=completed → document_upload=completed → billing_invoice=awaiting_customer → contract=not_started`.

The last completed stage is `document_upload`; the active/next stage is `billing_invoice`. No payment, invoice or contract side effect was executed.

## Regression and security

Node: 373 passed, 12 skipped. Python model gateway: 84 passed. Python ingestion: 30 passed. Typecheck, lint, build, Compose validation and secret checks passed. Security regression passed 9/9. The independent unseen deterministic evaluation passed 40/40 (34 eligible dialogue cases and 6 security refusals); it is not an Azure quality score.

## External blockers

Salesforce Lead/Account sandbox verification is `SALESFORCE_SANDBOX_BLOCKED`. SF-02 Salesforce sandbox verification is `SF02_SANDBOX_BLOCKED`. Only the deterministic mock provider was used; production Salesforce was not contacted.

## Changes

- Added immutable Gate 2 baseline with fixture hashes and 23 exact message identities.
- Added protected comparator and regression tests enforcing 21/23 plus paired-case preservation.
- Corrected the stale n8n IF-branch test assertion.
- Added restart/replay UAT runner, independent 40-case deterministic evaluator and Gate 3 reports.

The Gate 2 conversation implementation itself was not modified in this branch after the protected baseline. The Azure failures must be resolved and requalified before merging this branch or declaring conversational release readiness.

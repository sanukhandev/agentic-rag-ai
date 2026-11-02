# ANC quality recovery regression summary

Execution date: 2026-11-02 UTC
Branch: `feat/conversation-v2-langgraph-stage5-safe`
Fix commits: `eace2f75929a1084054a0ed19f6c507cd70301a1`, `cd11c8eee7c559e8ed95b774d125d0908b705edf`

## Passed

| Check | Result |
|---|---:|
| Node API full suite | 356 passed, 12 skipped |
| Focused v2 coordinator/guard/evidence/tool/persona tests | passed |
| Python model-gateway suite | 32 passed |
| Root TypeScript typecheck | passed |
| API lint | passed |
| Root build | passed |
| Secret checks | 2 passed |
| Isolated Compose validation | passed |
| Mock conversational UAT | 39/39 assertions; 25 meaningful happy-path turns |
| Public HTTP security regression | 9/9 |
| Azure API UAT assertions | 30/31; one intentional quality-gate failure |

## Azure execution

The isolated `anc-mock-uat` stack was rebuilt with `MODEL_MODE=azure` and
`LANGGRAPH_CONVERSATION_ENABLED=true`. Readiness reported the configured
deployment `gpt-5.4`; the API remained bound to `127.0.0.1:4100`. The final
bounded run recorded 23 durable model turns, 36 requests and 17 trusted tool
calls. It did not meet the 80% model-authored acceptance threshold.

## Full repository Python result

`python -m pytest -q` was also run. Three unrelated tests failed and were not
changed:

- `tools/anc/test_workflows.py::test_unlinked_leads_create_and_linked_leads_reconcile`
  has a fixture expectation for `Remote CRM Create Lead` while the current
  fixture contains `Reconcile Existing CRM Lead`.
- Two `tools/ingestion/test_ingestion.py` tests cannot import `bs4` in the
  current environment.

These failures are outside the Conversation Engine v2 quality-recovery diff.

## Safety

Only the disposable `anc-mock-uat` project was used. No operational database,
volume, production endpoint, payment, invoice or contract workflow was
modified. Existing historical artifacts and unrelated untracked files were
preserved.

# Gate 3 test summary

- Node workspace tests: 373 passed, 12 skipped.
- Python model gateway: 84 passed.
- Python ingestion: 30 passed.
- Typecheck, lint, build, Compose and secret checks: passed.
- Mock Conversation Engine v2 UAT: 39/39 assertions.
- Security regression: 9/9.
- Restart/replay UAT: 34/34.
- Unseen deterministic evaluation: 40/40 (34 eligible dialogue, 6 security refusals).
- Official Azure protected runs: 0/3 passed; results were 18/23, 15/23 and 15/23.

The mock and reliability results do not replace the failed protected Azure quality gate.

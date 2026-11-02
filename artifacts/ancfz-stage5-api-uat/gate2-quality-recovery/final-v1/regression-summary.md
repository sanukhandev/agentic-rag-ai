# Regression summary

- Node API: **373 passed, 12 skipped** (385 total).
- Focused v2 Node tests: **58 passed**.
- Python model-gateway tests: **37 passed**.
- API typecheck: passed.
- API lint: passed.
- Isolated Compose config validation: passed.
- Docker rebuild: passed; API/model gateway healthy.
- Full repository Python run with `PYTHONPATH=services/model-gateway`:
  **81 passed, 3 failed**. The failures are unrelated to this recovery:
  one workflow fixture expectation and two ingestion tests requiring the
  undeclared `bs4` package.
- Mock HTTP UAT: **39/39 assertions passed**.
- Azure HTTP UAT: **31/31 workflow assertions passed; fixed dialogue gate
  21/23**.

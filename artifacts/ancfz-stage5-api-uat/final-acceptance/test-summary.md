# ANC final integration UAT

- Mock conversation: **PASSED** (39/39 assertions, 25 meaningful turns).
- Security HTTP regression: **PASSED** (9/9).
- Azure GPT-5.4: **FAILED_GPT54_DIALOGUE_ACCEPTANCE** (33 model requests, 0 accepted model-authored responses, 19 safe no-evidence fallbacks).
- SF-02 deterministic mock: **SF02_MOCK_VERIFIED**.
- Salesforce sandbox: **SF02_SANDBOX_BLOCKED_NOT_CONFIGURED**.
- Node API: **341 passed / 12 skipped**; Python gateway: **31 passed**.

The operational database and Docker project were not touched; this evidence is from the isolated disposable UAT stack.

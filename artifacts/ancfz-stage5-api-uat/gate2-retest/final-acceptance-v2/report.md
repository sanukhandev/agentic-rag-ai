# ANC final quality UAT

- Verdict: **PARTIALLY_VERIFIED_BLOCKERS_REMAIN**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `fd2168342787f372df020497234aa435613ab9e3`
- Mock Stage 1–5: **PASSED**; last completed **document_upload**, current active **billing_invoice**, next pending **billing_invoice**.
- Qualification: software consulting and AI services / LLC / 3 visas / next month.
- Mock evidence: 39/39 assertions, 19/23 model-authored mock turns accepted, local upload/OCR and SF-02 mock verified.
- Azure GPT-5.4: **GATE_2_GPT54_DIALOGUE_FAILED**; 2/23 accepted (8.7%), 36 requests, 14 trusted tool calls.
- Security: **GATE_1_SECURITY_VERIFIED** (9/9 selected checks).
- SF-02 sandbox: **SF02_SANDBOX_BLOCKED_NOT_CONFIGURED**.

The operational database and Docker projects outside `anc-mock-uat` were not touched.

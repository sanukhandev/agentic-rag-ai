# ANC final integration UAT

- Status: **PARTIALLY_VERIFIED_BLOCKERS_REMAIN**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `709e3e2060aaf5b16aeccb8db238df2bf82bfdde`
- Mock Stage 1–5: **PASSED**; last completed stage **document_upload**, active stage **billing_invoice**.
- Qualification: software consulting and AI services / LLC / 3 visas / next month.
- Mock model/tool evidence: 22 model turns, 22 trusted tool calls, 22 safe no-evidence fallbacks, 0 accepted model-dialogue responses, zero observed repeated or unsupported-claim incidents.
- SF-02 mock: **VERIFIED** with durable receipt evidence.
- Azure GPT-5.4: **FAILED_GPT54_DIALOGUE_ACCEPTANCE**; Azure requests completed, but no model-authored response passed the response guard; observed replies used safe_no_evidence_dialogue.
- Salesforce sandbox: **BLOCKED_NOT_CONFIGURED**.

## Gates

- GATE_1_SECURITY_VERIFIED
- FAILED_GPT54_DIALOGUE_ACCEPTANCE
- GATE_3_LIFECYCLE_VERIFIED
- GATE_4_SF02_MOCK_VERIFIED
- SF02_SANDBOX_BLOCKED_NOT_CONFIGURED

See the redacted transcripts and machine-readable evidence in this directory.

# ANC Stage 5 API UAT

- Status: **PASSED**
- Mode: **mock**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `2ab683171d5c4e5a8b8068d4c0e0a08376bc43eb`
- Tenant: `anc` (synthetic-only)
- Scenarios: A-happy-path=PASSED, B-empty-rag=PASSED, C-security-recovery=PASSED
- Assertions: 34/34 passed
- Primary customer turns: 26
- Final verified stage: **document_upload**
- Document collection reached: **true**
- Actual document upload/OCR verified: **true**
- SF-02 attachment verified: **false**
- Persisted stage statuses: contract=not_started, billing_invoice=awaiting_customer, document_upload=completed, lead_generation=completed, account_creation=completed, package_selection=completed, lead_qualification=completed
- Session-scoped model/tool evidence: v2.model.turn=23, v2.tool.read=22

Known blockers:

- SF-02 external attachment was not claimed; only local OCR completion was tested.
- Azure GPT integration mode was not executed in deterministic mock mode.

# ANC Conversation Engine v2 Hardening UAT

- Status: **PARTIALLY VERIFIED — BLOCKERS REMAIN**
- Mode: **mock**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `3d7b3e5a30d850a78b2aff15aa64db2985cb17c0`
- Tenant: `anc` (synthetic-only)
- Scenarios: A-happy-path=PASSED, B-empty-rag=PASSED, C-security-recovery=PASSED
- Assertions: 39/39 passed
- Primary customer turns: 25
- Last completed stage: **document_upload**
- Current active stage: **billing_invoice**
- Next pending stage: **billing_invoice**
- Intentional stop stage: **document_upload**
- Document collection reached: **true**
- Actual document upload/OCR verified: **true**
- SF-02 attachment verified: **true**
- Persisted stage statuses: contract=not_started, billing_invoice=awaiting_customer, document_upload=completed, lead_generation=completed, account_creation=completed, package_selection=completed, lead_qualification=completed
- Session-scoped model/tool evidence: v2.model.turn=22, v2.tool.read=22
- Execution metrics: model turns=22, model requests=44, trusted tool calls=22, tool reads=22, provider errors=0, guard reasons={"safe_no_evidence_dialogue":22}, latency avg/max=220/325ms

Known blockers:

- Azure GPT-5.4 integration mode was not executed in deterministic mock mode.

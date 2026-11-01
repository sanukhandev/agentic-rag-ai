# ANC Conversation Engine v2 Hardening UAT

- Status: **PASSED**
- Mode: **azure**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `fcbbcc655ce64380bdc1b4f78fd692caa4967109`
- Tenant: `anc` (synthetic-only)
- Scenarios: E-real-gpt-5.4=PASSED
- Assertions: 30/30 passed
- Primary customer turns: 25
- Last completed stage: **document_upload**
- Current active stage: **billing_invoice**
- Next pending stage: **billing_invoice**
- Intentional stop stage: **document_upload**
- Document collection reached: **true**
- Actual document upload/OCR verified: **true**
- SF-02 attachment verified: **true**
- Persisted stage statuses: contract=not_started, billing_invoice=awaiting_customer, document_upload=completed, lead_generation=completed, account_creation=completed, package_selection=completed, lead_qualification=completed
- Session-scoped model/tool evidence: v2.model.turn=19, v2.tool.read=33
- Execution metrics: model turns=19, model requests=33, trusted tool calls=33, tool reads=33, provider errors=0, guard reasons={"safe_no_evidence_dialogue":19}, latency avg/max=2962/5490ms

Known blockers:



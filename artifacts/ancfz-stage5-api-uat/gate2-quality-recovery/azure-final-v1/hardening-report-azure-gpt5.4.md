# ANC Conversation Engine v2 Hardening UAT

- Status: **FAILED**
- Mode: **azure**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `eace2f75929a1084054a0ed19f6c507cd70301a1`
- Tenant: `anc` (synthetic-only)
- Scenarios: E-real-gpt-5.4=PASSED
- Assertions: 30/31 passed
- Primary customer turns: 25
- Last completed stage: **document_upload**
- Current active stage: **billing_invoice**
- Next pending stage: **billing_invoice**
- Intentional stop stage: **document_upload**
- Document collection reached: **true**
- Actual document upload/OCR verified: **true**
- SF-02 attachment verified: **true**
- Persisted stage statuses: contract=not_started, billing_invoice=awaiting_customer, document_upload=completed, lead_generation=completed, account_creation=completed, package_selection=completed, lead_qualification=completed
- Session-scoped model/tool evidence: v2.model.turn=23, v2.tool.read=16
- Execution metrics: model turns=23, model requests=36, trusted tool calls=17, tool reads=16, provider errors=0, guard reasons={"accepted":3,"model_or_tool_unavailable":5,"safe_no_evidence_dialogue":1,"unsupported_claim":14}, candidate guard reasons={"accepted":3,"model_or_tool_unavailable":5,"unsupported_claim":15}, model-authored accepted=3, latency avg/max=3671/7579ms

Known blockers:

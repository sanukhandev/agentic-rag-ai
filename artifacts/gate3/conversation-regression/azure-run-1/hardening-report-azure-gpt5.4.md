# ANC Conversation Engine v2 Hardening UAT

- Status: **FAILED**
- Mode: **azure**
- Branch/commit: `feat/gate3-salesforce-sf02-reliability` / `e8e1af1f908db728c848b884bf6f18404db796ed`
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
- Session-scoped model/tool evidence: v2.model.turn=23, v2.tool.read=18
- Execution metrics: model turns=23, model requests=35, trusted tool calls=18, tool reads=18, provider errors=0, guard reasons={"accepted":15,"accepted_model_dialogue":3,"safe_no_evidence_dialogue":1,"unsupported_claim":4}, candidate guard reasons={"accepted":18,"unsupported_claim":5}, model-authored accepted=18, latency avg/max=3814/10765ms

Known blockers:

# ANC Conversation Engine v2 Hardening UAT

- Status: **PARTIALLY VERIFIED — BLOCKERS REMAIN**
- Mode: **mock**
- Branch/commit: `feat/conversation-v2-langgraph-stage5-safe` / `eace2f75929a1084054a0ed19f6c507cd70301a1`
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
- Session-scoped model/tool evidence: v2.model.turn=23, v2.tool.read=22
- Execution metrics: model turns=23, model requests=46, trusted tool calls=23, tool reads=22, provider errors=0, guard reasons={"accepted":19,"model_or_tool_unavailable":1,"safe_no_evidence_dialogue":1,"unsupported_claim":2}, candidate guard reasons={"accepted":19,"model_or_tool_unavailable":1,"unsupported_claim":3}, model-authored accepted=19, latency avg/max=245/407ms

Known blockers:

- Azure GPT-5.4 integration mode was not executed in deterministic mock mode.

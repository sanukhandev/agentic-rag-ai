# Agentic RAG AI final acceptance report

Tested code commit: `a3ec1eeafc26b502fb48c77f9536789165e3281a`; Docker API image: `sha256:bce5673e5053472d597fbc008c51e8682c2c4089fb19161077b33e9acf381679`.

Targeted live regression passed on ANC session `f93cfd4d-f7ba-4155-996d-54b1960d41c8`: “i would like to start a IT service company” preserved setup context, and “what all packages” returned the approved Sandbox Basic and Sandbox Growth options with AED 2,500.00 and AED 4,500.00 respectively, followed by one contextual question.

## A. Architecture implemented

The API now runs a bounded, typed agent-tool loop for tenant-scoped opportunity, catalog, knowledge, package, pricing, CRM, document, invoice and contract reads. Read-only model planning is separated from deterministic authorization and side effects; durable lifecycle state, idempotency and verified callbacks remain backend-owned.

## B. Business lifecycle

- Lead qualification and consent: implemented and tested.
- Lead reconciliation: existing-identity path implemented; execution 1488 was diagnosed as `LEAD_ALREADY_LINKED` and reconciliation is covered by tests.
- Conditional Account/Contact/Opportunity conversion: catalog and workflow contracts implemented, but remote completion is not verified because `REMOTE_CRM_ACCOUNT_URL` is unset.
- Package discovery, eligibility, approved sandbox pricebook and explicit selection: implemented and tested internally.
- Document requirements, upload/state contracts and OCR callback handling: implemented and tested internally; external OCR completion is not independently verified.
- Invoice and contract state machines/workflows: implemented and tested internally; provider completion is not claimed because `BILLING_INVOICE_URL` and `CONTRACT_PROVIDER_URL` are unset.

## C. Conversation quality

Run `f52f8203-b955-40d6-8de6-a4490f2beb63` executed 205 customer messages and 205 assistant responses across scenarios A–H. All 631 harness assertions passed, including HTTP success, contextual follow-up coverage, generic-fallback rejection and scenario isolation checks. A browser smoke check verified Zara’s answer and source rendering through the Docker-served web UI.

## D. RAG validation

The live regression for “pricing and timelines for the same” returned the approved sandbox package prices, explicitly stated that no approved timeline was available, retained the active qualification requirement and ended with one contextual question. Responses used tenant-filtered approved evidence; ungrounded commercial claims were not accepted.

## E. External integrations

n8n workflow contract tests passed for Account conversion, invoice and contract workflows. The previously observed execution 1488 failure was reproduced and classified as an existing Lead-link conflict. Salesforce Account conversion, billing and contract provider outcomes remain unverified because their configured endpoints are empty.

## F. Test results

- API/PostgreSQL Docker suite: 277 passed, 1 Redis-gated test skipped.
- Focused app suite: 45 passed.
- API typecheck: passed.
- Agent/RAG model and tool tests: passed.
- n8n workflow contract tests: 3 passed.
- Live conversation harness: 8 scenarios, 205 customer turns, 631 assertions passed.
- Browser smoke: passed.

## G. Remaining failures

The exact operator dependencies are configured remote Salesforce Account conversion credentials/endpoint, a sandbox billing endpoint, and a sandbox contract provider endpoint. Until those are supplied and their authoritative callbacks are verified, the full external lifecycle cannot be claimed.

## H. Final verdict

`CONVERSATION VERIFIED — EXTERNAL GATES REMAIN`

The agentic conversation, tenant-scoped retrieval, catalog tooling, Lead reconciliation path and internal lifecycle state machines are verified. The missing provider endpoints prevent a truthful claim of complete sandbox Account → invoice → contract completion.

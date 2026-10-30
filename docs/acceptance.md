# Active acceptance — one ANCFZ seven-stage journey

This is the active business acceptance contract, effective 2026-10-30. **Do not run a mandatory 25-turn or 200-message benchmark.** Those historical requirements are superseded. Targeted unit, integration and security tests still apply.

## Acceptance run

Command: `npm run qa:ancfz-single-journey`.

Start with one unique synthetic ANCFZ customer, one application session, one business opportunity, one pinned catalog and a correctly scoped Foundry v6 candidate conversation. Avoid duplicate Salesforce identities between runs. Confirm the actual candidate served each tool-calling request and the v4 stable serving selector remained unchanged.

Drive the existing Node Chat API, use reported pending requirements rather than fabricated assistant text, and handle confirmations/uploads through their existing authorized endpoints. Record redacted actual `function_call`, `call_id`, `function_call_output`, tool timing, session/opportunity hashes and provider callback evidence.

Exercise one approved knowledge interruption, one fact correction, one duplicate-message retry, one API restart/recovery and one delayed callback where available. Verify these cannot reset the journey or authorize stale/wrong-opportunity actions.

## Ordered stage gates

| Stage | Minimal trusted evidence |
| --- | --- |
| Lead Generation | Validated contact, scoped consent, proper ActionRequest; **remote Salesforce Lead ID + verified callback** to claim remote completion |
| Lead Qualification | Catalog-required facts and verified qualification decision with provenance |
| Account Creation | Successful qualification, applicable customer confirmation/email verification, reconciled Salesforce Account/Contact/Opportunity |
| Package Selection | Eligible catalog package, approved quote and confirmed selection revision |
| Document Upload | Upload consent, safe storage, OCR/review where required and SF-02 Salesforce attachment confirmation |
| Payment Details & Invoice | Approved quote, verified invoice artifact/provider acknowledgment; real/mock payment states differentiated |
| Contract | Approved template/parties and verified provider signing evidence, not just draft/URL |

A tool call, model statement, HTTP response or completed n8n execution does not fulfill an external stage without provider proof. If a provider is unavailable, stop at the **first true blocker**, preserve state and record exactly what was missing; never jump forward.

## Security/compatibility gates

Preserve Admin API and Chat API contracts, strict tenant isolation, PII masking, catalog version pinning, consent, action identity, CAS/idempotency and callback signatures. Reject unknown/malformed tool calls, forged scope, repeated calls, ungrounded citations and tool-output exfiltration. Keep Hosted OpenAPI disabled for the v6 candidate and keep the stable v4 selector unchanged until promotion is separately approved.

Run actual available workspace typecheck/lint/build/test, Compose security checks, PostgreSQL/Redis integration, tool dispatcher and journey-security regression tests. Record true PASS/FAIL/SKIP/BLOCKED counts; tests unavailable for credentials/providers are BLOCKED, never PASS.

## Current evidence and verdict

The latest documented v6 run: **13 customer messages, 13 assistant messages, 22 passed assertions, 0 failed**, with a real read-only function call, one ActionRequest and an unresolved Salesforce Lead remote acknowledgment. End stage: `lead_generation`.

Current verdict: **CONVERSATION AND TOOL CALLS VERIFIED — INTEGRATIONS BLOCKED**.

Evidence: `verification/ancfz-single-journey-tool-calling.md`, `verification/ancfz-stage-verification-matrix.md`, and local `artifacts/ancfz-single-journey/` run records. Reassess only after new dated provider evidence.

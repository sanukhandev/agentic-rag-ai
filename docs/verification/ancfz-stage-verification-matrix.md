# ANCFZ seven-stage provider-verification matrix

**Most recent focused single-journey status (2026-10-30): CONVERSATION AND TOOL CALLS VERIFIED — INTEGRATIONS BLOCKED.** This matrix separates the current *one-session run* from earlier independent sandbox and unit checks. It does not aggregate separate runs into a fictional complete journey.

| Stage | Local capability / evidence | Latest single-journey proof | Required external evidence | Verdict for single journey |
| --- | --- | --- | --- | --- |
| 1. Lead Generation | Validated contact, consent, catalog action gate, ActionRequest, local n8n dispatch and outbox | 13-turn run created action; `reconcile_required`, no verified remote Lead | Salesforce Lead ID, matching original action/opportunity and authenticated reconciliation | **BLOCKED** |
| 2. Lead Qualification | Published catalog, factual provenance, continuity and qualification gates tested separately | Not reached as completed stage | Complete catalog-required qualification facts and verified decision | **NOT REACHED** |
| 3. Account Creation | Conditional action and provider workflow scaffolding | Not reached | Qualified verified Lead, required confirmation, Account/Contact/Opportunity association | **NOT REACHED** |
| 4. Package Selection | Package/catalog/quote contracts and guarded routes | Not reached | Eligible package, accepted quote and selection revision | **NOT REACHED** |
| 5. Document Upload | Upload, consent, OCR/review and SF-02 code paths | Not reached | Reviewed processing and provider-verified Salesforce attachment | **NOT REACHED** |
| 6. Payment Details & Invoice | Invoice/billing workflow contracts and development mock | Not reached | Authoritative invoice artifact and separately verified payment/mock status | **NOT REACHED** |
| 7. Contract | Draft/confirmation/status integration boundary | Not reached | Provider contract status and signed evidence if represented as signed | **NOT REACHED** |

## Evidence rules

- The real v6 candidate produced a `get_journey_state` `function_call`/`function_call_output`; serving traffic remained pinned to v4. Read-only function calling does not authorize business writes.
- Earlier isolated Salesforce sandbox or static workflow results may be useful **historical evidence**; do not treat them as completion of this specific session/opportunity.
- An HTTP 200/202, n8n success, local Lead ID, generated PDF, `mock_paid` or signing URL is not equivalent to a verified external completion.
- Do not invent Salesforce IDs, bill customers or perform legally binding signatures in test runs.
- Full run detail: [`ancfz-single-journey-tool-calling.md`](ancfz-single-journey-tool-calling.md).

# Intent Catalog Validation

**Tenant:** ANCFZ (`anc`)

## Published inventory observed 2026-11-04

- Published V2 catalog: version 1
- Catalog reference: `anc:r2:494ca3636d66414ae7869a9717758a900994d34a792a2906a31610ef0991e5bc`
- Business goals: 1
- Requirement policies: 22
- Tool bindings: 17
- Published persona selected by the session: Zara, version 1

## Runtime checks

- Natural initiation phrases reach an unconfirmed `anc.company_formation` proposal: PASS (unit and public API smoke).
- Information-only turns create no confirmed goal: PASS in unit coverage.
- Goal confirmation does not create action consent: PASS in unit coverage.
- Refusal clears the pending confirmation and creates no action: PASS in unit and public API smoke.
- Full catalog workbook review, republishing and seven-stage acceptance: NOT RUN.

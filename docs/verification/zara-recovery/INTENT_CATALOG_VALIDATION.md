# Intent Catalog Validation

**Tenant:** ANCFZ (`anc`)

## Published inventory observed 2026-11-04

- Historical draft: version 1, `anc:r2:494ca3636d66414ae7869a9717758a900994d34a792a2906a31610ef0991e5bc`.
- Current development publication: version 2, `anc:r2:1b7342efc6ed15e10c811dd462e192a08bbdf41ea4c89ba6fac9843974b73a67`.
- Business goals: 1
- Requirement policies: 22
- Tool bindings: 17
- Published persona selected by the session: Zara, version 1

## Runtime checks

- Natural initiation phrases reach an unconfirmed `anc.company_formation` proposal: PASS (unit and public API smoke).
- Information-only turns create no confirmed goal: PASS in unit coverage.
- Goal confirmation does not create action consent: PASS in unit coverage.
- Refusal clears the pending confirmation and creates no action: PASS in unit and public API smoke.
- `Yes, let's proceed.` confirms the scoped goal: PASS in unit and public API smoke.
- Business activity, visa count and timeline facts survive the confirmation turn: PASS in public intent-document inspection.
- Full catalog workbook review, republishing and seven-stage acceptance: NOT RUN.

## Known catalog/data blocker

ANCFZ `package_offerings` currently contains zero rows in the development database. Package selection and formal quotation therefore remain correctly blocked; no prices or package entitlements were invented.

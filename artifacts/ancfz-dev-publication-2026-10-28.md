# ANCFZ development publication

Published locally on 2026-10-28 to tenant `anc`.

- Catalog version: `3`
- Catalog id: `e11aa14f-7e3b-4971-940b-312f33eef7de`
- Status: `published`
- Source: `ANCFZ_Intent_Catalog_Executable_Proposal_2026-10-28.xlsx`
- Executable journey requirements: `10`
- Journey transitions: `2`
- Workspace slot: `workspace_preference`
- Previous version `2` was retained as `draft`; active journeys remain pinned to their original catalog version.

The catalog was inserted and published in one PostgreSQL transaction using row locks and the existing tenant/version uniqueness constraints. The local API was restarted and readiness remained healthy.

The RAG source was not re-approved. It remains active for development retrieval but contains pending-business-validation content and conflicting commercial claims; the API therefore remains fail-closed for unsupported or conflicting pricing and eligibility statements.

No Salesforce, n8n, OCR, or identity-document side effect was triggered by publication.

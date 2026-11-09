# Zara Recovery Checkpoint — Paused 2026-11-05

## Repository state

- Working branch: `fix/zara-conversation-engine-end-to-end-recovery`
- Checkpoint source HEAD before this checkpoint: `0a2212b95b338dff96b8077c4ec92d102b3924cc`
- Acceptance tenant: `anc` / ANCFZ development sandbox
- Status: paused at the user's request; not ready for final acceptance

## Verified progress

- GPT-first grounded chat and ANCFZ company-formation goal confirmation work on fresh sessions.
- Confirmed goals and conversation state persist in PostgreSQL.
- Ten synthetic Lead runs created Salesforce sandbox Leads and recorded the remote Lead IDs in the local CRM table.
- Salesforce sandbox OAuth, Lead readback, Lead Description update, Attachment creation/readback, and provider relationship readback were verified with synthetic records.
- The Salesforce Lead provider now records the verified remote Lead key in the local CRM record.
- n8n Account workflow JSON was imported and its composite Account/Contact/Opportunity request plus exact readback validation were structurally checked.
- Focused Salesforce provider tests passed 10/10; n8n structural tests passed 2/2.
- The last complete API suite before the final provider/configuration edits passed 538/538. It must be rerun when work resumes.

## Remaining work when resumed

1. Publish a new immutable V2 catalog revision enabling the reviewed Account, package and document bindings. Existing `anc:r5` remains intentionally disabled for document intake.
2. Add three development-only, clearly labelled package offerings scoped to the new catalog revision and requiring the synthetic identity document.
3. Wire the V2 document event route to the authenticated ingestion worker. The current `document.sf02.upload` template still contains a placeholder provider route and must not be activated as-is.
4. Activate and execute the n8n Account workflow only after its managed Salesforce OAuth credential binding and Node authorization are confirmed; verify Account, Contact and Opportunity readback through the public workflow path.
5. Run a fresh API journey: chat goal confirmation → Lead creation/readback → qualification/account gate → package/quote → consented document upload → OCR worker result → local summary → Salesforce Attachment and Description readback.
6. Rerun the complete API regression suite, typecheck, lint, Docker health checks, and update the acceptance reports with actual results.

## Known non-completion evidence

- Current published catalog `anc:r5` returns disabled document configuration and the public upload path rejects the request with `DOCUMENT_REQUIREMENT_NOT_ACTIVE`.
- The current public document journey has therefore not yet proven upload, OCR, local persistence, Salesforce Attachment, and Salesforce Description synchronization as one end-to-end flow.
- Azure live evaluation, browser E2E, final PR, remote push, and final acceptance remain unverified.

## Resume rule

Use a new session pinned to the next published catalog revision. Do not repin existing sessions or weaken document, consent, tenant, provider-readback, or action-authorization gates.

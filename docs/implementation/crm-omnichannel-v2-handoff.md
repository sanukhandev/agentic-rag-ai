# CRM / Omnichannel Conversation V2 — Codex Handoff

**Tracking:** https://github.com/sanukhandev/agentic-rag-ai/issues/45  
**Branch:** `feature/crm-omnichannel-conversation-v2`  
**Baseline:** `main`  
**Initial fixture:** `anc-test` (ANCFZ), not a hardcoded product dependency.

## Implementation contract

Read `AGENTS.md`, actual code, existing migrations and issues #14, #37, #39, #40, #41. Continue in this branch. Track 10 workstreams on issue #45; post results after each phase. Do not open a ready-to-review PR until actual verification passes.

Required changes:
1. Durable server-side conversation state and `pendingPrompt`; "yes", "no", "sure", "I confirm", or a single-word answer must resolve against the question last asked. Summaries preserve confirmed slot values, outstanding intents, consent and document status. UI postbacks enter as normal message events.
2. Published tenant RAG + versioned intent catalogs, not hardcoded logic, control factual responses, disambiguation, required slots, workflow binding, document order and CRM mappings.
3. Every CRM write is gated on validated name, E.164 phone, email, explicit scoped consent, resolved published actionable intent and approved workflow. Use `crm` + `externalCRMId` existing reference semantics and configured Salesforce summary field. No provider object/field name assumptions.
4. Small n8n workflows: contact lookup, upsert, summary sync, controlled document OCR request, per-intent actions and reconciliation. Salesforce secrets only through n8n encrypted Credentials, not new env vars or source. **Security ADR required:** Salesforce n8n node's minimal PII egress conflicts with current AGENTS.md no-raw-PII-to-n8n rule; never silently weaken security.
5. Safe tenant-scoped local-disk attachments, Python/Tesseract OCR, typed normalized fields and provenance, one required document requested at a time, private structured storage and approved compact CRM summary update.
6. Web plus channel-neutral verified adapters for WhatsApp, Instagram and Telegram. No fake live integrations without actual provider credentials.
7. Generate source-traceable ANCFZ Markdown training ZIP, updated intent workbook and detailed training content catalog workbook from actual approved source data.

## Local Windows source inputs
- `C:\Users\SanuKarimullaKhan\Downloads\OneDrive_1_21-10-2026.zip`
- `C:\Users\SanuKarimullaKhan\Downloads\ANCFZ_Intent_Catalog_Converted.xlsx`

These are **not in this GitHub repo**. Local Codex must verify their existence and source contents; do not invent records, fees, policies, content catalog rows, or generated artifacts.

## Quality gates
Actual API, migration, Python/OCR, catalog-import, isolated n8n, two-tenant, idempotency and Playwright/browser E2E tests. Verify missing-contact/consent => zero Salesforce writes; qualified consented request => exactly one idempotent write; short answers preserve prompt state; ordered docs and OCR feed only validated summary facts. Run project build/lint/typecheck/tests and preserve exact evidence. Record mock vs live provider tests separately.

**No claims of implementation or passing tests until execution evidence exists.** If a genuine external credential/approval blocker remains, preserve commits and issue notes; keep #45 open and do not claim completion.

The full standalone Codex prompt is provided in the accompanying user-delivered `CODEX_MASTER_PROMPT_AGENTIC_RAG_CRM_V2.md`; this handoff is a repo-local index, not proof of implementation.

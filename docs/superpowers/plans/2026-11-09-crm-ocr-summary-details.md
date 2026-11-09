# CRM OCR Details and Clean Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show useful OCR-exported details and clean, concise requirements in the authorized Admin CRM record without sending identity OCR to AI or Salesforce.

**Architecture:** Node remains the privacy and authorization boundary. The model receives only the existing metadata-only document summary plus normalized masked requirements. After the model response is validated, Node appends a separately generated Admin-only OCR section from stored masked document summaries and rehydrates only known tokens for the authenticated CRM response. Salesforce continues to receive document metadata only.

**Tech Stack:** TypeScript/Express, Vitest, Angular, PostgreSQL/MemoryStore, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-09-crm-ocr-summary-design.md`

## Global Constraints

- Node is the sole authority for Admin authorization, privacy-token validation, formatting, and persistence.
- Python receives bounded masked CRM context only; identity-document OCR text and bytes never cross the Node-to-Python boundary.
- Salesforce-facing descriptions remain metadata-only.
- Unknown legacy privacy placeholders are redacted as `[REDACTED]`; they are never rehydrated or sent to a model.
- Public/customer document responses remain summary-free.

## Review Focus

- Repeated greetings and duplicate user turns: one concise requirement remains.
- OCR summaries containing known and unknown privacy placeholders: known values rehydrate only for Admin; unknown values become `[REDACTED]`.
- Identity OCR content: visible only in the authorized Admin CRM response, absent from model requests and Salesforce descriptions.
- Pending/failed documents: no false OCR details are shown.
- Legacy leads with stale summaries: AI summarize succeeds from current safe state.

---

### Task 1: Normalize requirements and build Admin OCR detail formatting

**Files:**
- Modify: `services/api/src/document-intake.ts`
- Test: `services/api/src/document-intake.test.ts`

**Interfaces:**
- Produce `normalizeCrmRequirement(text: string): string | null` for deterministic user-turn cleanup.
- Produce `composeAdminDocumentDetails(documents, rehydrate): string` for bounded Admin-only OCR details.
- Keep `composeDocumentSummary(lead, documents)` model-safe and metadata-only for documents.

- [x] Write failing tests for greeting removal, whitespace cleanup, duplicate requirement removal, and bounded output.
- [x] Write failing tests for Admin OCR details containing completed document metadata and exported summary, with unknown placeholders redacted and pending/failed documents excluded.
- [x] Run the focused document tests and confirm the new expectations fail.
- [x] Implement the smallest normalization and Admin-detail helpers; preserve existing file/storage behavior.
- [x] Run focused document tests and confirm they pass.

### Task 2: Include Admin OCR details in the CRM summary safely

**Files:**
- Modify: `services/api/src/app.ts`
- Test: `services/api/src/crm-summary-route.test.ts`

**Interfaces:**
- Consume `composeDocumentSummary` for model input and `composeAdminDocumentDetails` for the authenticated Admin output.
- Persist a formatted summary containing the AI sections plus a deterministic Supporting Documents section.

- [x] Add a failing route test with repeated conversational greetings, a completed OCR summary, known token values, and one stale unknown token.
- [x] Assert the model stub receives normalized requirements and no OCR exported text.
- [x] Assert the returned/persisted Admin summary contains OCR details, rehydrates known values, redacts the stale token, and deduplicates requirements.
- [x] Implement the route composition order: safe model input → model validation → Admin OCR section → final token validation → persistence.
- [x] Run the focused route/document tests and confirm they pass.

### Task 3: Render OCR details and clean summary content in Admin CRM

**Files:**
- Modify: `apps/admin/src/app/types/admin.types.ts`
- Modify: `apps/admin/src/app/components/crm/crm.component.ts`

**Interfaces:**
- Extend `SupportingDocument` with optional `requirementKey` and `expectedDocumentType` fields already returned by the Admin API.
- Render the protected `document.summary` under each completed document as “OCR details”; keep Download unchanged.

- [x] Update the template to show a readable OCR details block only when `document.summary` exists, with a pending/failed state otherwise.
- [x] Keep the summary specification readable as normal text while retaining section breaks and existing status/actions.
- [x] Run Admin typecheck/build and confirm the template compiles.

### Task 4: Verify and document the complete local flow

**Files:**
- Modify: `docs/current-state.md`
- Modify: `docs/verification/ai-summary-fix-2026-11-09.json`

- [x] Run API focused tests, full workspace tests, typecheck, lint, and build.
- [x] Rebuild local Docker Compose with mock model mode and verify API/web/admin readiness.
- [x] Probe the model gateway and Node adapter with synthetic masked data, asserting no OCR text crosses the model boundary.
- [x] Record the measured results and privacy boundary in the verification artifact.
- [x] Run `git diff --check` and verify the working tree contains only this scoped change.

## Completion Criteria

- Admin CRM summaries show OCR-exported details for completed documents.
- Requirements are concise, deduplicated, and no longer a raw pasted conversation.
- Known Admin privacy tokens rehydrate; unknown legacy tokens are visibly redacted.
- AI input and Salesforce descriptions remain free of raw OCR details.
- Full tests, builds, and local Docker readiness pass.

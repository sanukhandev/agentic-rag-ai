# CODEX MASTER EXECUTION PROMPT
## Agentic RAG AI — Multi-Tenant Conversational CRM, Intent Routing, Document OCR and Omnichannel Reliability
**Project:** `sanukhandev/agentic-rag-ai`
**GitHub tracking issue:** https://github.com/sanukhandev/agentic-rag-ai/issues/45
**Implementation branch (already created):** `feature/crm-omnichannel-conversation-v2`
**Base branch:** `main`
**Initial tenant fixture:** `anc-test` (ANCFZ)
**Run mode:** Execute in the local Windows development environment that has access to the two source files below.

---

## 0. ROLE AND EXECUTION CONTRACT

You are the autonomous lead engineer, software architect, QA engineer, security reviewer, data engineer and release engineer for this change. **Implement the system**, not just a design document. Continue executing successive workstreams, repairing failing tests and documenting progress until all feasible deliverables and gates are completed. Do not stop at a plan, proof of concept, placeholder, green unit tests alone, or a partial workflow export.

**Non-negotiable honesty and safety:** Never fabricate source content, credentials, live Salesforce results, browser screenshots, imported n8n workflow IDs, test runs or verification results. If an external credential or security approval is genuinely missing, complete all executable local work with explicit mocks, label the exact blocked live gate, keep the issue open, and do not declare the overall work complete or open the final ready-for-review PR contrary to the quality gate. Never circumvent security requirements to fulfill a "never stop" instruction.

**Before changes:**
1. Read `AGENTS.md`, `docs/README.md`, actual code, migrations, repo tests and applicable architecture/security docs. `AGENTS.md` describes some historical *planned* contracts; verify current implementation.
2. Fetch `origin`; switch to existing `feature/crm-omnichannel-conversation-v2`. Verify it is based on `main`. Do **not** implement on `main` or overwrite others' commits.
3. Inspect GitHub issue **#45** and existing work **#14, #34–#41**. Integrate with existing intent catalog, action gateway and lead workflows instead of creating duplicate subsystems.
4. Record baseline state (git status, branch, dependencies, migrations, available test commands, working API/UI, intended compatibility, any existing pending PRs).
5. Create a detailed checklist with traceable subissues or linked checklist items against #45; **reuse** existing overlapping issue IDs rather than duplicating them. Comment on #45 at kickoff, on completion/blocker for each phase, and before PR. Each update must include changed files, test evidence, blockers and next step.
6. Keep incremental, reviewable commits on the feature branch. Prefer typed services and migrations over business logic in controller components or n8n Code nodes.

### Local input files (verify exact existence before extraction)
- `C:\Users\SanuKarimullaKhan\Downloads\OneDrive_1_21-10-2026.zip`
- `C:\Users\SanuKarimullaKhan\Downloads\ANCFZ_Intent_Catalog_Converted.xlsx`

These inputs are NOT implicitly present in GitHub/CI. Do not invent their contents if inaccessible. Check ZIP contents, file sizes, formats, hashes, malware/path-traversal risks, duplicate or stale sources, and Excel sheets/header definitions before mapping. These files define ANCFZ *fixture data*, not global behavior. **Do not publish private inputs, contact details, credential material, or unapproved source facts.**

## 1. GOAL AND INVARIANTS

Upgrade the product into a **generic, multi-tenant, channel-neutral, source-grounded AI conversation platform** whose behavior is controlled by **published tenant RAG content plus the versioned intent catalog**.

For the first tenant, `anc-test`, use approved ANCFZ sources and the supplied workbook to:
- Maintain persona, memory, customer context, outstanding prompts and conversation continuity.
- Understand intent progressively; summarize and re-evaluate as new answers arrive; ask the next **single** useful question until ambiguity and mandatory slots are resolved.
- Collect and validate customer **name, phone, email**, and separate **explicit CRM data-processing consent** for CRM actions. Where the approved policy requires final action confirmation, collect that separately from consent.
- **Never send a contact to Salesforce until all required validated contact details and valid consent are present** and the appropriate tenant/workflow policy allows the action.
- Match existing contacts safely before create/upsert; sync subsequent valid information, intent and compact CRM summary without duplicate records.
- Where an intent requires documents, request one approved required document at a time; stage files securely on local disk; process via Python/Tesseract as appropriate; normalize typed fields and provenance; store approved structured data privately; update the configured CRM `summary` field with concise document/conversation findings. Never assume a physical Salesforce field API name.
- Bind each eligible intent to a **small, dedicated n8n workflow**. Keep validation, authorization, session state and policy decisions in Node rather than using one giant n8n state machine.
- Support web today and a stable adapter contract for WhatsApp, Instagram and Telegram. Plain-language "yes"/"sure"/"I confirm"/"no"/single-word and optional postback responses must produce equivalent conversation events.
- Preserve strict tenant isolation, approved knowledge-only factual answers, idempotency, auditability, privacy, denial/withdrawal handling and reliable recovery from failures.

`anc-test` is configuration + fixture, **never** a hardcoded path, enum, provider assumption, database filter, workflow name or UI condition.

## 2. TARGET ARCHITECTURE

```
Web / WhatsApp / Instagram / Telegram
           |
  Verified channel adapter / canonical message event
           |
      Node API boundary
  - resolved tenant/channel identity
  - auth + rate limiting + input validation
  - durable session + current pending question
  - privacy-safe rolling summary + event log
  - approved retrieval + catalog intent resolver
  - required slot/document/consent validation
  - action registry + transactions + idempotency
           |
     action outbox / worker
           |
   allowlisted n8n workflow (one bounded concern)
           |
  Salesforce nodes with n8n stored credentials
           |
  tokenized CRM reference, status and audit to Node

Upload -> Node tenant-scoped private disk storage -> controlled Python worker
       -> safe OCR/text extraction -> normalized field values with provenance
       -> private DB + validated concise CRM summary sync via n8n
```

**Published RAG sources** are factual knowledge; **published intent catalogs** are routing/collection policy. Neither source text nor model predictions may grant permissions, override consent or execute external actions. Model outputs are proposals that must pass deterministic server-side constraints.

### Critical privacy boundary / ADR required
Current `AGENTS.md` forbids raw customer PII in n8n. Salesforce contact upsert using **only n8n Salesforce OAuth credentials** implies at least minimal name/email/phone must be available to the Salesforce node. This is an architecture/security conflict, **not** a reason to silently leak plaintext in all workflow payloads.

Implement and review a specific ADR before live execution:
- Preferred narrow egress: Backend holds PII and reversible tokens in the trusted boundary. n8n receives opaque tenant/action/token IDs; an authenticated **short-lived, action-scoped** internal endpoint returns only the minimum required fields to a locked-down Salesforce node immediately before submission.
- Restrict allowed workflow IDs, internal network access and token lifetime; ensure n8n execution data, manual executions, node error text, webhook responses, logs, diagnostics and retries do **not** retain raw PII. Disable/limit execution-data saving according to actual n8n capabilities; document residual exposure and operational controls.
- Use encrypted **n8n Credentials** for Salesforce OAuth and other n8n provider connectors. **No new Salesforce/Meta/Telegram integration secrets in `.env`, source, Excel, workflow JSON, frontend bundles, GitHub Actions output or documentation.** Keep existing infrastructure secrets (DB/model/worker authentication) on the repository's approved server-side secret mechanism; do not break unrelated application configuration.
- Do not make raw contact details available to generative prompts. If this architecture cannot meet the product privacy requirement, keep live Salesforce sync gated pending explicit security approval; finish stubbed and contract-tested code.
- Never allow n8n to select arbitrary SQL, invoke arbitrary Python/filesystem commands, or directly override consent/state.

## 3. DURABLE CONVERSATION ORCHESTRATION — FIX THE SHORT ANSWER BUG

Implement or repair a server-owned, persisted, **per-tenant and per-session** conversation state machine. Suggested conceptual states (adapt existing schema rather than duplicating):
`DISCOVERY -> INTENT_CLARIFICATION -> SLOT_COLLECTION -> CONTACT_COLLECTION -> CONSENT_PENDING -> DOCUMENT_COLLECTION -> ACTION_CONFIRMATION -> QUEUED -> SUCCEEDED | RECONCILE_REQUIRED | FAILED`.

State must store: verified `tenantId`, `sessionId`, `channel`, principal/channel identity binding, published catalog version, candidate intents and evidence, selected intent, resolved/invalid/missing slots, masked customer profile, consent evidence/version, required document progress, `pendingPrompt` (id/type/slot/intent/expected input/correlation), `lastAssistantQuestion`, summary revision, message sequence/version, workflow/action status, relevant CRM reference IDs.

**Handle each inbound message in this order:**
1. Verify channel webhook/signature or authenticated web session; resolve tenant from trusted server-side configuration, not an unchecked payload.
2. Deduplicate by channel + inbound message ID; append ordered event with optimistic locking or transaction/version enforcement.
3. If a pending prompt exists, parse the answer **against that prompt first**. A single word, "yes", "no", button postback, answer in another language or a short name/number must not become an unrelated intent.
4. Normalize multilingual affirmations/denials conservatively; examples: `yes`, `yep`, `sure`, `okay`, `ok`, `i confirm`, `agree`, `please do`, `no`, `nope`, `not now`, `cancel`, `stop`. Recognize *meaning in context*, including negation, and handle unsure/conflicting responses by asking clarification. **Consent requires an affirmative response to the actual consent question; "yes" to another question cannot grant consent.**
5. Validate answer as the expected slot/confirmation/doc choice. On invalid input, ask a focused re-prompt while retaining state, never resetting the flow.
6. Update deterministic, privacy-safe rolling summary plus unresolved facts and last question. Preserve past confirmed answers and correct explicit updates; use structured state as authority over prose memory.
7. Re-evaluate candidate intents with catalog signals, negative signals, relations and ambiguity thresholds. Use the configured clarification prompts; do not invent unsupported intents or bound workflows.
8. Choose the next single question from catalog collection order / document order / consent or confirmation gates; otherwise provide grounded answer using approved knowledge.
9. Persist assistant reply, `pendingPrompt`, state and a new revision together; do not send a response that is not committed.
10. Never execute an action merely from a model/tool suggestion, a short acknowledgement, a stale catalog version or a UI button label.

**Regression cases:**
- Assistant: "Are you planning to register a new company?" User: "yes" -> active company-formation journey, not a new generic `yes` intent.
- Assistant: "What is your name?" User: "Sanu" -> `name` slot, not greeting.
- Assistant: "May I store these contact details in the CRM?" User: "sure" -> consent only for that scoped prompt and published policy.
- Assistant: "Do you already have a licence?" User: "no" -> negative answer to that slot, not rejection of the entire conversation.
- Assistant: "Should I submit your request?" User: "not yet" -> no workflow.
- New session with only "yes" and no pending prompt -> neutral clarification; no consent or workflow.
- Parallel inbound messages, retries, session reconnects, out-of-order events and channel postbacks -> deterministic deduplication and no lost pending prompt.

A chat UI can optionally display buttons, but clicking one **must send a regular canonical message event** back to the same chat API with its `replyToPromptId`, typed response and audit metadata. There is no privileged shortcut around Node validation.

## 4. VALIDATE CONTACT AND EXISTING CRM STATE

Implement **separate gates**, configured by the published catalog/workflow binding:
- **Contact completeness:** nonempty normalized person name, syntactically valid email, phone normalized to E.164 using a validated country context, required consent flag/version/time/source. Distinguish collected from validated or verified; do not overclaim email/phone verification.
- **Intent readiness:** one active published intent chosen, required slots validated, optional configurable confidence/ambiguity policy, no negation preventing action.
- **Document readiness:** each required document supplied, safe-scan/extraction completed as required, user correction/confirmation where low OCR confidence, approved field mapping and provenance.
- **Action readiness:** all relevant gates, fresh catalog/workflow binding, tenant-scoped authorization, optional explicit submit confirmation and durable idempotency record.
- **CRM identity readiness:** provider + tenant + trusted channel identity + `externalCRMId`/`crm` mapping. Avoid double creation on retry. Never treat guessed external CRM ID or unverified same-name match as account authorization.

Respect actual DB schema; retain or migrate existing **`externalCRMId`** and **`crm`** reference columns, plus the existing CRM `summary` concept. Do not silently rename/break them. If the actual names differ, write a backward-compatible mapping/migration.

Salesforce provider must be catalog/configurable, including chosen object (`Lead`, `Contact`, or other supported object), logical field mappings, uniqueness/dedupe strategy and actual configurable API field for summary; **do not assume `Summary__c` exists**. Query metadata or documented tenant mapping and fail closed on missing configured fields. Store provider record ID on success and reconcile idempotently on unknown timeout outcomes. Authorize cross-channel record linking using verified identity/OTP or existing trusted binding; never reveal CRM PII merely because an incoming user typed a matching phone/email.

**Required behavior:** incomplete contact, missing consent or unresolved intent -> no Salesforce write. Existing valid record -> safe update when authorized; otherwise create once. Expired consent/revocation -> suppress further writes, honor appropriate deletion/retention policy. Failed/ambiguous write -> reconcile before retry.

## 5. CATALOGS, TRAINING AND VERSIONED PUBLISH

### 5.1 Inspect supplied XLSX and keep import compatibility
Preserve supported columns/sheets, validation constraints, stable keys, published versions, existing workflow bindings, import/export semantics and backwards-compatible APIs.

Where unsupported, add **versioned extension sheets or equivalent normalized models**:
- `Intents`: tenant, intent key, description, classification/priority, activation policy, published status, clarification prompt, success criteria.
- `Signals`: positive, negative, synonymous, multilingual and short-answer/contextual examples; optional weights.
- `Slots`: logical field, display prompt, validation, normalization, collection order, required/conditional required, sensitive flag, channel rules.
- `Relations`: exclusions, disambiguation, dependencies, parent/child intents.
- `WorkflowBindings`: **approved workflow key**, action type, active status, required slots, consent gate, confirmation gate, retry policy, version.
- `DocumentRequirements`: intent, document type, conditions, collection order, mime/size caps, OCR/extraction schema, review requirement, optionality.
- `CRMFieldMappings`: generic logical field -> provider/object/API field, operation, validation, sensitivity, summary inclusion rules; map actual `crm` and `externalCRMId`.
- `ChannelCapabilities`: button allowed, upload capabilities, text fallback, max message/file size, verification requirements.
- `TestUtterances`: expected intent, expected prompt, allowed action, negative/ambiguous cases, channel, expected slots.
- `CatalogManifest`: schema version, tenant, approved published version, source hash/provenance, validation report.

Treat these as suggested extension names and **adapt to the existing importer contract**. Fail atomically with sheet/row/column validation errors; no macro execution, formula injection, untrusted external links or auto-publishing. Explicit review -> publish -> pin active version -> rollback. Newly imported drafts cannot authorize operations.

### 5.2 Generate actual ANCFZ source-derived training package
Read and validate the ZIP's real contents. Extract authorized business facts into **clear Markdown** organized by topical intent/source provenance rather than arbitrary unsourced AI-generated marketing text. Use categories supported by actual source documents (e.g. company setup, licences, visas, office solutions, process, fees only if proven); do not fabricate claims.

Each Markdown file needs YAML front matter or equivalent metadata:
`tenantId`, `sourceId`, `originalSourcePath`, `sourceHash`, `title`, `topic/intentKeys`, `audience`, `approvalStatus`, `effectiveDate` (only if known), `language`, `contentVersion`, `lastReviewed`, citation pointer/page when available.

Include a source inventory, manifest, readme, missing/contradictory fact report, extracted-content traceability and safe example conversations. Mark unverifiable items for human review rather than publishing them.

**Deliverables (exact filenames may follow repo conventions):**
- `artifacts/anc-test/anc-test-rag-training-package.zip` (Markdown sources + manifest + readme + validation notes)
- `artifacts/anc-test/ANCFZ_Intent_Catalog_Updated.xlsx`
- `artifacts/anc-test/ANCFZ_Training_Content_Catalog.xlsx`
- `artifacts/anc-test/source-validation-report.md`
- `artifacts/anc-test/intent-test-cases.json`

The **training content catalog workbook** is detailed and import/review-friendly: source ID, original file path, type, title, topic, intent association, Markdown output path, content hash, chunk count, source page/section, language, trust/visibility, PII screening, approval status, duplicate detection, stale/contradictory source flags, published version and notes. Add validation summary and import instructions. The workbook is stored locally and usable for a controlled VM upload/import; **do not train/publish to a live VM until explicit approval/credentials and the existing publish workflow allow it.**

Verify ZIP integrity, workbook validity with actual importer dry-run, links between catalog and Markdown files, all workflow keys, data completeness and error reports. Use real ANCFZ content only.

## 6. DOCUMENT INTAKE, OCR, NORMALIZATION AND CRM SUMMARY

- Derive **ordered** required-document lists from the active intent catalog. Ask for exactly one next document; honor user-provided earlier docs and conditional exemptions.
- API provides authenticated, tenant-bound upload session/attachment token and canonical document event. Do not trust client file names, MIME headers, paths, `tenantId`, `sessionId` or user-supplied `externalCRMId`.
- Initially store encrypted/private (where practical with documented key management) staged files on **local disk**, not a public static path or object storage. Configurable data root and quota; random opaque path + tenant/session isolation; restrictive file permissions; size/page/mime allowlist and file signature checking; zip-slip/zip-bomb/PDF limits; malware hook/scanning or fail-closed per policy; retention TTL, secure cleanup and audit metadata. Never put paths/raw documents in LLM prompts/logs.
- Use controlled asynchronous Python worker in `tools/ingestion` or established project extraction location. Tesseract OCR for image-based PDFs/images; native extract for digital PDF/text, DOCX and XLSX where applicable; preprocess only if needed. Explicit dependency checks for `tesseract` binary + language packs; deterministic fixtures, subprocess timeouts and resource caps.
- Normalize to typed, catalog-defined document schemas; each field records `value`, `sourceDocumentId`, `page/region`, `method`, `confidence/status`, `reviewState`. Handle low confidence, date formatting, bilingual/multilingual content, document mismatch and multi-page output; never hallucinate absent fields.
- Keep authoritative structured extraction and provenance in protected DB records. Update **a configurable CRM summary field** with a bounded, human-readable, privacy-minimized conversation/intent/doc-status synopsis and relevant verified extracted facts; do not dump raw OCR, base64, full passport/ID data or unapproved sensitive information into a text field.
- CRM summary must support merge/versioning to prevent lost updates from parallel messages/docs; use idempotent sync with chunk/length limits and reconcile when Salesforce rejects mappings/limits.
- An informational intent should not require contact/docs unless the published catalog explicitly and lawfully requires them.

## 7. SMALL, SAFE n8n WORKFLOWS

n8n owns external orchestration and n8n-stored provider credentials. Node owns permissions, intent resolution, slot completeness, consent, private data storage and state.

Export **separate, importable JSON workflows** (names can be aligned to repo conventions):
1. `CRM-01 - Contact Lookup` — trusted provider-scoped lookup, no write.
2. `CRM-02 - Contact Upsert` — required validated fields + consent + replay protection -> create/update + externalCRMId.
3. `CRM-03 - Summary Sync` — update configured Salesforce summary field for an existing, authorized external record.
4. `DOC-01 - Document Processing Request` — request/retrieve status of an internal limited OCR job (actual Python extraction stays in controlled worker).
5. `INTENT-<key> - <action>` — one small workflow per actionable **published and supported** ANCFZ intent; share reusable internal APIs/subworkflows without constructing a giant switchboard.
6. Optional `CRM-04 - Reconciliation` — reconcile timeout/unknown outcomes before retried writes.

Each workflow validates contract version, tenant, session/action relationship, selected published intent, active allowlisted binding, auth, idempotency/correlation IDs and necessary preconditions. Protect webhook endpoints, use narrow internal service credentials in **n8n Credentials**, and prevent client-direct workflow invocation. Do not embed secrets or real PII in workflow exports, fixtures or Git.

Keep CRM workflows independent from channel presentation. Workflow JSON must pass import validation and run against a safe mock Salesforce service. Use actual Salesforce only if credential/approval gates pass; record true external object IDs (redacted) and real run evidence only when tested. Never invent n8n workflow IDs. Update the published `WorkflowBindings` **only after** real workflow IDs have been created/verified and importer accepts the binding.

## 8. OMNICHANNEL API CONTRACT

Create/extend a single canonical inbound message DTO; adapt to existing API versioning:
`tenantResolvedByServer`, `sessionId`, `channel`, `externalMessageId`, `channelUserId` (trusted, protected), `type: text|postback|attachment`, `text`, `replyToPromptId`, `postbackValue`, `attachments`, `receivedAt`, `correlationId`.

Implement:
- Channel adapter registry: web; WhatsApp/Instagram/Telegram as pluggable independently verified adapters, behind a generic interface.
- Each adapter normalizes text, payload-only button responses, common affirmations and attachment references into the **same** conversation handler.
- Outgoing channel renderers can use buttons when supported, otherwise text questions; action always round-trips as a normal message to the API with state linkage.
- Tenant/channel mapping uses signed/verified account-to-tenant config; no user-selected arbitrary tenant. Verify Meta/Telegram signatures/tokens where actual credentials exist; when unavailable, add mocks/contract tests, **not** pretend live integrations.
- Preserve single conversational thread across API requests and reconnects; validate replay/out-of-order, rate limits, locale/language and channel-specific upload restrictions.
- APIs and DB remain generic for future tenants, CRM providers and channels; no ANCFZ-only switch-case.

## 9. REQUIRED TEST PLAN

Use existing test frameworks and add missing tests. **Run actual commands and record output**, not just generate test code.

**Unit/contract**
- Affirmations/denials in context and without context; ambiguous, changed-answer and negative consent cases.
- Persistence of pending question/summary across messages, processes and retries.
- Intent scoring, negative signals, ambiguous intents, current published version and stale binding rejection.
- Email/phone/name validation, consent audit, workflow readiness and no-PII logging.
- OCR extraction/normalization/low-confidence cases; zip traversal, unsafe attachment and size-limit rejection.
- Existing record lookup vs create, same external ID, duplicate action, CRM summary max-length/truncation and field-mapping errors.
- Payload validation for every exported n8n workflow.

**Integration**
- Two synthetic tenants with overlapping intent IDs and similar data cannot access each other's catalog, sessions, files, workflows, CRM records or summaries.
- Same contact submits from two messages/channels without duplicate Salesforce create; unknown timeout enters reconciliation state.
- Missing email/phone/name/consent -> **0** Salesforce write calls; fully validated, consented, action-ready request -> **1** approved call.
- Document upload -> private disk -> Python Tesseract -> normalized fields -> safe summary update through mock Salesforce.
- Unsupported/unpublished intent, invalid workflow binding, prompt injection from source/doc, revocation, partial network failure and replay all fail safely.
- Excel import dry-run, publish, rollback, manifest/source hashes, training ZIP integrity.

**Browser E2E**
Use Playwright (or repository-established browser E2E framework) against the real local web + API services. Verify on desktop and mobile viewport:
1. Fresh chat and persona from `anc-test` configuration.
2. Clarification conversation where a short "yes" correctly answers the previous question.
3. Name/phone/email collection, invalid input correction, consent refusal then valid scoped consent.
4. Intent selected from *published* catalog, document requested in order, file upload and processing state.
5. Confirmation/postback sends a normal message event to the API.
6. Mock Salesforce receives a single write only after all conditions; CRM reference + summary appear in authorized views.
7. Resume session after refresh and keep pending prompt.
8. Negative tests: no pending prompt + "yes", another tenant attempt, no-consent submission, duplicate button click, stalled OCR and CRM timeout.

Run repo's **real** applicable `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, migration/dry-run commands, Python tests/type checks, workflow import validation, browser E2E and Docker smoke checks, plus security/secret scan. Adapt only to scripts that actually exist; do not report missing ones as passed.

Write `docs/verification/crm-omnichannel-v2-report.md` with each test/command, exact result, environment, screenshots or links (with redactions), mock vs real provider classification, blockers, remaining risks and rollback demonstration.

## 10. DELIVERY SEQUENCE (EXECUTE, DON'T ONLY PLAN)

**Phase 1 — Repo audit and traceability**
- Baseline, code/schema architecture assessment, ADR for CRM PII boundary, linked subtasks, test matrix, source inventory.
- Post progress to issue #45.

**Phase 2 — Contracts, schema and state engine**
- Canonical messages, durable pending prompts, memory/summary, consent/contact/CRM references, migrations, backward compatibility, automated tests.
- Post evidence.

**Phase 3 — Catalog and content**
- Inspect original Excel/ZIP, versioned mapping, training Markdown ZIP, intent XLSX, content catalog XLSX, import dry-run and test fixtures.
- Post artifact manifests, hashes (not private data) and evidence.

**Phase 4 — Document pipeline**
- Scoped local disk storage, Python/Tesseract adapters, typed extraction, per-intent ordered docs, human review, retention and summary mapping.
- Post evidence.

**Phase 5 — n8n and CRM**
- Dedicated workflow JSONs, n8n Credentials wiring guides, mock Salesforce, exact versioned binding keys, secure identity/PII transfer decision and idempotent sync/reconcile.
- Post evidence; do not claim live connected Salesforce without a real tested connection.

**Phase 6 — Channels and UX**
- Web/adapter consistency, button vs plain text handling, retry/duplicate prevention, proper upload and question UI.
- Post evidence.

**Phase 7 — E2E, hardening and release**
- Clean migrations, builds, lint, typecheck, unit/integration/API/Playwright/browser tests, two-tenant and security tests, n8n workflow import tests, regression fixes, docs.
- Push commits to `feature/crm-omnichannel-conversation-v2`.
- Attach completed checklist, branch/commit hashes, source-derived artifact inventory, mock/live test distinction, security/rollback notes to issue #45.
- **Only if all required executable gates truly pass and critical security decisions are resolved:** open a PR into `main`, reference `Closes #45` plus linked subissues, request review and post PR URL on #45. Don't merge automatically.
- If a hard external dependency remains, do not falsely mark complete; keep #45 open, log the precise blocker, preserve implementation/commits/tests and clearly describe remaining live acceptance.

## 11. CODE REVIEW AND COMPLETION CRITERIA

This is **complete** only when:
- [ ] Generic multi-tenant code (no hardcoded `anc-test` outside fixtures) and privacy-source policy remain intact.
- [ ] Every actionable intent is catalog-published, validated, authorized, consented and correctly bound before n8n.
- [ ] `yes/no/sure/one-word` responses reliably answer pending prompts across sessions/reconnects/channels.
- [ ] Salesforce writes are exactly-once in effect, fully gated; existing `crm`/`externalCRMId` references and summary are safely used.
- [ ] Document-required intents collect one file at a time; safe private disk handling, OCR, normalization, provenance, review and bounded CRM summary work.
- [ ] Small n8n workflows are exported, importable, tested, and use **n8n Credentials**, not environment-based Salesforce secrets.
- [ ] ANCFZ training ZIP, updated intent workbook and detailed VM-ready content catalog workbook are generated from the **actual** supplied files, source-traceable and validated.
- [ ] Actual browser, API, workflow, OCR, two-tenant, failure and security tests are recorded as passed.
- [ ] Docs/ADR/migration/rollback and GitHub issue comments are current; code is committed to feature branch and PR is opened **only after acceptance**.

**At each execution checkpoint, summarize:** finished, working tree/commit, tests run with real results, next tasks and true blockers. Keep going automatically through the next feasible phase. Do not stop to ask routine implementation questions; choose backwards-compatible defaults and document them. **Do not make silent security or policy decisions** that require owner approval.

**Begin immediately with the repository audit and the exact two Windows inputs.**

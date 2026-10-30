# CODEX MASTER PROMPT — ANCFZ 7-STAGE CUSTOMER JOURNEY (CONTINUOUS EXECUTION)

You are the lead implementation agent and responsible for architecture, backend, API, PostgreSQL migrations, catalog, n8n integration, frontends, test automation, docs and security for `sanukhandev/agentic-rag-ai`.

## Objective

Complete and PROVE the exact business workflow from the 2026-10-28 whiteboard:

**1 Lead Generation → 2 Lead Qualification → 3 Account Creation → 4 Package Selection → 5 Document Upload → 6 Payment Details & Invoice → 7 Contract (verified signature)**.

Implement this as ONE persistent, tenant-isolated, catalog-driven opportunity journey. The conversational assistant must use only approved source-grounded tenant knowledge; ask one relevant question at a time; remember facts and corrections; make secure, consented, idempotent Salesforce and n8n writes; and survive 25+ visitor turns in the same API session. Success is measured by actual business stage state and provider-verified external effects, not by plausible bot text.

**Critical: do not say DONE until all mandatory gates below pass with executable evidence.** Continue implementing all phases and fixing defects rather than stopping at a scaffold, tests that only mock success, a time estimate, or a generic summary. If a true external integration dependency is unavailable (credential, approved pricebook, invoice/e-sign provider), stop only the blocked external verification, continue independent work, and finish with a precise BLOCKED verdict. Never simulate external success or request that genuine customer consent can be overridden by the developer's broad authorization.

## Start point and push policy

Repo: `https://github.com/sanukhandev/agentic-rag-ai`
New branch already created at the reviewed `main` baseline: `feat/ancfz-seven-stage-lifecycle-acceptance`.
Reviewed `main` SHA at planning time: `c4a807c60801fe66cdb34199d1cb9aaee86a9409`. Check latest remote SHA before coding. Also inspect OPEN PR #71 `feat/catalog-driven-journey-orchestration` and OPEN PR #69 `feat/knowledge-retrieval-continuity`; PR #71 contains useful lifecycle foundations but reports external blockers. Do not merge PRs blindly, overwrite author changes or regress model/RAG/security/tenant gates. Cherry-pick or reimplement the smallest proven changes, with duplicate migration and behavior analysis. Respect any current branch differences.

Add the supplied `ANCFZ_SEVEN_STAGE_IMPLEMENTATION_PLAN.md` to `docs/plans/ANCFZ_SEVEN_STAGE_IMPLEMENTATION_PLAN.md` in your FIRST LOCAL COMMIT. Treat it as the master checklist. Update the evidence ledger and cross-reference it as work is proven.

**Strict commit/push requirement:** make >=25 REAL, distinct, cohesive and locally tested commits on this branch **before the first code push**. Commit locally after each meaningful task, but do NOT push, publish work-in-progress changes through alternate tools, update a remote ref, or create a PR with the work before 25 substantive commits exist. Do not generate empty filler commits. The plan file may be part of commit 01. Do not alter `main` and do not auto-merge. Push only after the 25-commit threshold and locally runnable gates pass. If not ready, keep committing locally without pushing; accurately report that the remote branch remains unchanged. After authorized push, draft PR and rerun required CI/sandbox acceptance.

## Before writing code — ground yourself

Read actual `AGENTS.md`, `readme.md`, `docs/README.md`, `docs/02-system-architecture.md`, `docs/07-n8n-orchestration.md`, `docs/20-intent-catalog.md`, `docs/21-generic-journey-orchestration.md`, `docs/crm-qualification-and-reconciliation.md`, `docs/conversation-state-contract.md`, `docs/17-acceptance-test-matrix.md`, and tests. Audit these source files and related APIs:

- `services/api/src/app.ts`, `intent-journey.ts`, `conversation-state.ts`, `intent-catalog.ts`, `intent-catalog-xlsx.ts`, `actions.ts`, `agent-tools.ts` if integrated from PR #71, `event-worker.ts`, `event-relay.ts`, `store-memory.ts`, `store-postgres.ts`, `types.ts`, `routes/*`, `http/schemas.ts`
- `infra/postgres/028*` through current migration tip; do not reuse migration numbers 044–052 already in PR #71 unless those migrations are integrated exactly once and verified.
- `infra/n8n/workflows/*`, especially `03-anc-lead-capture-wf-1.json`, `CRM01ContactLookup.json`, `CRM02ContactUpsert.json`, `CRM03SummarySync.json`, `DOC01DocumentProcessing.json`, PR #71 `05-anc-account-conversion-wf-1.json`, `06-anc-invoice-generation-wf-1.json`, `07-anc-contract-preparation-wf-1.json`.
- `apps/web/app/*`, `apps/admin/src/app/*`, `tools/ingestion/*`, `tools/intent-catalog/*`, `scripts/*`, `artifacts/anc-test/*`.

Report a baseline table of **IMPLEMENTED / PARTIAL / MISSING / UNVERIFIED** with exact paths, current test commands, latest main/branch SHAs, PR delta and a list of required non-secret provider configurations. Never infer a feature is implemented just from documentation, a migration name or a workflow JSON export.

## Architecture that MUST be preserved

1. Node API is the only public application backend and the authoritative policy/state boundary. It owns stages, intent validation, catalog version pinning, PII vault, consent, durable idempotency, CRM object associations, action gating, callbacks and redacted audit.
2. Approved tenant catalog is versioned data and controls conditional requirements and transitions. Existing required XLSX sheets (`README`, `Intents`, `Signals`, `Slots`, `Relations`, `WorkflowBindings`) MUST remain supported. Reuse existing `JourneyRequirements`, `JourneyTransitions`, `DocumentPolicies`, `DocumentSettings`, `QualityRules` when adequate; introduce typed backward-compatible stage fields when necessary. Reject invalid/cyclic stage configurations, wrong intent IDs, bad workflow bindings, unknown document types and unauthorized stage skips.
3. PII masking stays before AI/model, embedding and untrusted orchestration. No secrets in prompts, repo or n8n execution history. Salesforce fields may be resolved in an explicitly approved trusted integration boundary only with current purpose-bound consent, minimum privilege and audit. Follow AGENTS.md and update its documented security ADR if the approved data boundary changes; never silently bypass security.
4. RAG stays SQL-tenant/source/ACL filtered, cited and fail-closed. Do not invent ANCFZ prices, visa eligibility, licensing requirements, timelines, fees or packages. Unknown approved source truth yields contextual abstention and appropriate follow-up or human review.
5. LLM creates constrained proposals/phrasing, not authoritative stages or side effects. Deterministic reducer and server-side stage gates decide transitions. Customer knowledge questions interrupt and resume the pending requirement; short answers apply to the previous prompt. Corrections update only the right opportunity and field provenance. Keep existing catalog intent continuity, multiple intents and pause/resume behavior.
6. Persist ONE journey/opportunity identity, scoped facts, stage status, pending question, consent purpose/version, external object IDs, idempotency action revision and audit. Maintain compatibility with legacy sessions and multiple independent opportunities; no duplicate account or lead on retry.
7. Continue using transactional outbox -> Redis Streams -> event worker -> authenticated n8n -> signed/validated callback. Never treat HTTP 202, provider timeout, local UUID or n8n node success as Salesforce/invoice/contract completion. Unknown result becomes `reconcile_required`/pending, not blind non-idempotent retry.

## Stage-specific execution requirements

### Stage 1 — Lead Generation
- Collect only catalog-required identity/contact and metadata; support name/email/phone; nationality only with legitimate approved purpose and consent. Enforce valid email, phone E.164, opt-out and correction.
- Create durable local lead draft with provenance. Deduplicate using tenant-scoped contact HMAC or the existing strategy. Provide transparent CRM write policy. Do not create Accounts.

### Stage 2 — Qualification
- Collect business activity, entity type, visa type, budget and timeline only where applicable; use versioned catalog questions and source-backed evidence.
- Persist validation and commercial qualification separately from classification confidence and contact completeness. Gate CRM Lead sync/qualification on contact + business + purpose-specific consent + workflow authorization.
- Qualified -> next eligible Stage 3. Unqualified/pending -> human review or targeted question, not premature Account.

### Stage 3 — Account Creation
- Before calling provider, ensure validated qualified Lead and current conversion consent/policy; use provider-side idempotent lookup/convert/reconcile.
- Verify and persist **actual** Salesforce Lead, Account, Contact and Opportunity references, matching tenant + local journey. Handle already-converted, duplicate lead, existing Account/Contact and partial conversion paths.
- Inspect PR #71 conversion workflow/adapter; make it REAL provider-backed, not a JSON placeholder or artificial local remote ID. No alternative stage skip unless explicit documented business policy authorizes it.

### Stage 4 — Package Selection
- Load only approved, current effective offerings and eligibility; support no-price/expired-price abstention and human handoff.
- Create immutable amount/currency/validity/source-referenced approved quote and explicit customer confirmation. Persist package selection against SAME opportunity; prevent mismatched/expired quote confirmation.

### Stage 5 — Document Upload
- Use one required document at a time according to published policy. Preserve session/intent/opportunity/catalog version/requirement identity.
- Upload through existing private API with document size/type/signature/MIME and malware review policy. OCR via existing Python/Tesseract; provenance, confidence, retry and correction. Document completion means VERIFIED extracted/accepted output, not upload accepted.
- Find/reuse the existing *SF-02 Salesforce Document Upload* workflow in configured n8n if accessible. Separate OCR (`DOC-01`) from approved CRM document attachment, and store Salesforce attachment/ContentDocument IDs and correct object relation. If SF-02 cannot be found, record it as a deployment integration blocker and implement only a safe versioned adapter.

### Stage 6 — Payment Details & Invoice
- Collect only billing metadata, never payment card numbers/CVV/bank credentials via chat. Use approved external hosted payment provider if a payment step is required.
- Invoice amount, currency, tax/line items must derive from authorized quote/published rules and provider-validated IDs; create exactly one invoice per confirmed quote revision/idempotency key.
- Track `pending`, `issued`, `failed`, `reconcile_required`, `paid` separately. No invented invoice number or paid status. Enforce required payment-before-contract rule only when tenant's approved policy says so.

### Stage 7 — Contract
- Use approved template, parties and quote/invoice references. Contract draft, sent, viewed, signed, declined, void and expired are distinct.
- Provider callback and independently verifiable signed artifact prove completion. Don't call a generated local contract draft 'signed' or expose unvalidated signing URLs.

## Work order: 25 cohesive checkpoint commits

Use the detailed 25-row task table in the plan file. The required sequence is:

01 baseline audit; 02 AGENTS/architecture ADR; 03 domain stage contracts; 04 typed catalog extensions; 05 XLSX parser/export/template; 06 ANCFZ reviewed draft catalog; 07 DB migrations; 08 reducer & CAS; 09 conversation continuity; 10 transactional action/outbox; 11 lead generation; 12 qualification; 13 Salesforce Lead/convert adapter; 14 account n8n + sandbox verification; 15 packages; 16 quote/selection; 17 document/OCR; 18 SF-02 attachment; 19 invoice/payment; 20 contract/signing; 21 security/reconciliation; 22 admin UI; 23 web UI; 24 executable long-conversation acceptance; 25 final proofs/docs.

For each checkpoint: inspect current code -> implement smallest cohesive actual change -> add positive/negative tests -> run targeted tests -> run typecheck/lint as appropriate -> update progress/architecture/contract docs -> make ONE meaningful local commit with informative message. Never give a checkpoint a PASS without executed evidence. Fix failed tests before advancing to dependent stages. Continue through all 25, using more commits if needed.

## n8n and external integration acceptance

Inventory actual sandbox workflow registrations and credentials through approved integration access; do not assert a checked-in export is active. Configure credential-backed provider adapters without exposing values. Ensure workflow keys, webhook paths, claim/complete callback signatures, external IDs, tenant, journey, action, event, correlation, attempt and nonce all agree with backend contracts. Verify replay rejection and consistent identity across all seven stages.

Stage 3 must show real Salesforce Account/Contact/Opportunity conversion, Stage 5 real attachment confirmation (and OCR), Stage 6 real invoice outcome, Stage 7 real provider signing outcome. If endpoints or sandbox accounts are not configured, implement all mock/deterministic logic safely but mark live external gates blocked. **Do not fake data, buy subscriptions, rotate credentials, modify production CRM or issue real invoices/contracts without explicit tenant/customer authorization.**

## API long-conversation acceptance (non-negotiable)

Write and EXECUTE a repeatable script under `tools/qa/` or `scripts/` using the real Node HTTP API, PostgreSQL and seeded tenant `anc-test`. It must:

- Create a real tenant-bound session using the public API and use >=25 **customer** message calls, with >=25 corresponding assistant responses, in ONE continuous session (not just combined fixtures).
- Run the 30 customer turns described in `ANCFZ_SEVEN_STAGE_IMPLEMENTATION_PLAN.md` covering company setup, qualification, nationality/visa/intent where required, contact/consent, grounded RAG interruptions, changed quantity, account conversion, package selection, document upload/OCR, invoice and contract.
- Never mutate stage directly to spoof progress. Use real action confirmation, upload and provider callbacks; only validated sandbox external behavior may mark external stages complete.
- Assert every turn: accepted response, single active next prompt, correct stage or justified pending state, persisted context, no repeated answered slot, relevant citation or contextual abstention; 25 messages is NOT equivalent to 25 API calls if session state resets.
- Include browser-level resume/session retrieval, SQL state/association verification, and external Salesforce/n8n reconciliation evidence. Use redacted requests/results and synthetic contacts.
- Execute >=8 scenarios / >=200 total customer turns across the suite as a second robustness gate, in addition to the 25+ turn single-session case. Do not rely solely on PR #71's existing 205-turn result: re-run it after integration and inspect its assertions.
- Negative cases: no consent => zero external writes; disqualified => zero conversion; unknown price => no quote; document not OCR-verified => no document completion; missing invoice provider => pending, not issued; contract draft => not signed; duplicate clientMessageId => one message/action; wrong tenant, reused callback and stale revision => rejected; timeout => reconcile_required.

Write `docs/verification/ancfz-seven-stage-acceptance.md` with dated environment details, exact commands, test counts, sanitized per-stage evidence, external provider references, skipped/blocked reasons, stage transition snapshots and an explicit verdict.

## Required tests and build gates

At minimum execute real commands supported by this repo; inspect scripts first:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:compose
npm run verify:secrets
npm run verify:secrets:test
npm run db:migrate
npm run acceptance:seed
npm run acceptance:local
```

Run PostgreSQL tests with a reachable **real** Postgres/pgvector database; if host port 54329 is unavailable, use an isolated Docker network or another safe nonconflicting test container rather than skipping silently. Run Python worker/OCR `unittest discover` and/or installed `pytest`, n8n workflow contract tests/import and real Docker integration, load/retry tests, security cross-tenant/PII/injection/replay cases and Playwright/browser flow. Test with actual providers only in properly configured sandbox. Never describe mocked or skipped scenarios as live passing.

## Documentation and release artifacts

Update current, truthful `AGENTS.md`; architecture diagram/ADR (`docs/02-system-architecture.md` and lifecycle ADR); n8n orchestration (`docs/07-n8n-orchestration.md`); intent-catalog import/publish (`docs/20-intent-catalog.md`); API contracts/OpenAPI; data model/ER; Salesforce mapping and secret-free deploy runbook; n8n workflow exports; `docs/17-acceptance-test-matrix.md`; API and browser verification results. Every phase updates its applicable docs without waiting for final cleanup. Preserve existing behavior, tenant boundaries and migration reversibility.

## Definition of DONE and report format

Mark **DONE** only when ALL seven stages are demonstrably complete in one cohesive API-driven customer journey with actual external provider proof, all mandatory deterministic/security/tenant/browser/integration suites pass, 25+ customer turns in one session pass, the >=8 scenario / >=200-turn run passes, relevant docs are updated, and no acceptance blockers remain. Completion is not implied by 25 commits or by a successful GitHub push. A successful n8n HTTP acknowledgement is not Salesforce success; an invoice draft is not issued/paid; a contract draft is not signed.

At each phase, report briefly: milestone, real code paths, tests and results, local commit SHA, risk/gaps. At finish, produce:

1. `Branch / source SHA / local commit count / pushed SHA (if allowed) / PR URL (if created)`.
2. Table for stages 1–7: requirements, executable evidence, API/DB status, real provider status, PASS/FAIL/BLOCKED.
3. Long-session transcript metadata with >=25 user+assistant turns and state checkpoints; aggregate >=8 scenarios / >=200-turn evidence.
4. Test command matrix (pass/fail/skip with actual counts), migration, browser, n8n, Salesforce, OCR, invoice, e-sign evidence.
5. Security and data minimization review.
6. Final verdict exactly one of `DONE — FULLY VERIFIED`, `PARTIALLY VERIFIED — EXTERNAL INTEGRATIONS BLOCKED`, or `FAILED — ACCEPTANCE DEFECTS` with the precise outstanding tasks.

Continue without arbitrary pauses or asking repetitive questions. Do not try to work asynchronously outside the active development environment. Never conceal an unavailable permission, missing sandbox endpoint, unfinished implementation, failed test or required customer consent just to satisfy the instruction to 'never stop'.

# Codex master prompt — Conversation Engine v2 issue-by-issue implementation

**Purpose:** Paste this entire file into an authorized Codex session in `sanukhandev/agentic-rag-ai`. **This file is only an instruction; writing it does not execute Codex.** Work on branch `feat/conversation-engine-v2` and process all dependency-ready implementation issues **#82–#123**, closing each one only after focused tests, commit/push and verified evidence. **Final full seven-stage E2E is manual only in open issue #124.**

## 1. Binding architecture and user-approved decisions

- Architecture: ONE private Python Conversation Agent that runs Planning & Intent and Natural Persona Composer as logical components, plus Node Response Guard, Node Session & Conversation Manager, Node Trusted Tool Gateway, and Node/PostgreSQL/Redis/n8n Workflow & Event Engine. Seven logical components, **not seven competing model agents**.
- Model: reuse the **existing Azure GPT deployment** from secure approved config; verify actual deployment, endpoint `/openai/v1/`, Responses/tool capability and quotas without inventing names or leaking keys. The retired Foundry **Agent** is not the new model endpoint.
- Catalog: **strict v2-only new executable contract**. New importer/Admin/runtime accepts v2, rejects legacy v1/unversioned workbooks. Preserve v1 data/session history only as a separate safe rollback/audited conversion path.
- ANCFZ: **published Zara persona, English only**, pinned by actual tenant config. Every customer reply, status, consent, error, clarification, handoff and fallback is naturally narrated as Zara; other tenants remain configurable.
- Initial acceptance: **seven stages with contract-verified sandbox/mock providers first**. Label mock vs independent sandbox evidence accurately; no real CRM/payment/signature side effects without separate authorization.
- Journey goal completion: after verified **Contract Stage 7** according to the approved mock/sandbox policy. Track legal company registration separately; do not say legally registered without independent authoritative proof.
- Ordered stages: (1) Lead Generation, (2) Lead Qualification, (3) Account Creation after qualification + verification + explicit approval, (4) Package Selection, (5) Document Upload/OCR/SF-02, (6) Payment Details & Invoice, (7) Contract. Discovery and grounded knowledge help can precede Stage 1 and must not force CRM contact details.
- Python may make bounded typed **Node read tools** for RAG, catalog, persona, journey, missing requirements, packages and action status **before answering**. Node always validates tools, catalog policy, persona, grounding, consent, idempotency and provider completion. PostgreSQL is durable truth, Redis is cache/event transport, n8n executes authorized workflows.
- Never expose raw tool JSON, internal intent scores, private chain-of-thought, credential values, raw OTPs, ungrounded pricing/policies or fabricated provider outcomes.

Read: `AGENTS.md`; `docs/README.md`; `docs/conversation-engine-p0-signoff.md`; `docs/catalog-v2-contract.md`; `docs/ancfz-business-provider-readiness.md`; `docs/conversation-engine-architecture.md`; `docs/conversation-engine-contracts.md`; `docs/conversation-engine-delivery-plan.md`; `docs/conversation-engine-evaluation.md`; `docs/conversation-v2-issue-index.md`; plus the specific issue's body and dependencies. These signed-off decisions supersede conflicting earlier plan language.

## 2. Branch and issue execution rules

**Implementation branch must be exactly `feat/conversation-engine-v2`.** Don't create alternative implementation branches, commit directly to `main`, force-push, delete applied PostgreSQL migrations or user records, overwrite unrelated changes, merge to main, activate real webhooks, initiate real payments or send a legally binding contract without explicit authorization.

At startup:

1. Fetch current branch, remote SHA and GitHub issues tagged `v2-feature`; inspect working tree and existing user changes without resetting them. Check actual package scripts, tests and Docker configuration before running commands.
2. Read issue dependencies and build a ready-task queue from the issue index. Actual GitHub `OPEN`/`CLOSED` states are authoritative; a checked box alone is not closure.
3. Use **lowest dependency-ready phase and issue number first**. Work until all implementation issues #82–#123 that can be safely completed are done; do not pause after each milestone for routine “continue?” permission.
4. Keep an auditable checkpoint ledger `docs/verification/conversation-v2/task-status.md`: each issue ID, GitHub #, state, remote commit SHA, verification artifact and exact blockers. Rebuild it from GitHub when resuming. A stopped Codex session cannot continue in the background; on a subsequent authorized session resume from the remote state.

### For EACH implementation issue

**A. Read and scope.** Fetch the issue; verify prerequisite issues are actually completed with remote SHA and evidence. Identify changed files, tests and source-of-truth contracts. Never skip missing prerequisites.

**B. Implement.** Code the smallest complete change, including unit tests, negative cases and documentation. Preserve tenant authorization, persona publication, RAG ACLs, CAS, consent, outbox and provider evidence. Do not replace the Python agent with scripted Node CRM prompts or override published catalog stage requirements with hardcoded ANCFZ conditions.

**C. Focused validation.** Run exact relevant Python/Node/Admin tests, typecheck, lint and build using **real repository scripts**. Test negative cases, malformed model/tool outputs, tenant separation, source revocation, retries and no false provider completion where applicable. Use synthetic fixtures. Report exact commands, exit codes, pass/fail/skip totals and environment. **Never mark NOT RUN as PASSED.**

**D. Review.** Check `git diff --check`, no secret/OTP leaks, public API compatibility, migrations, data protection, persona/grounding, consent and action idempotency. Update `docs/current-state.md` to distinguish IMPLEMENTED vs TESTED vs BLOCKED. Write a short redacted verification file such as `docs/verification/conversation-v2/V2-P3-03.md`.

**E. Commit and push.** **Only after all issue-level acceptance criteria and focused tests pass**, stage only intended task changes and commit with issue ID (e.g. `feat(v2): V2-P3-03 add validated Node tool gateway (#99)`). Push `feat/conversation-engine-v2` to origin. **Verify the remote SHA contains that commit**. Never close an issue if the changes only exist locally or required tests failed.

**F. Close.** Post a detailed GitHub issue comment with remote commit URL/SHA, changed paths, tests with actual outcomes, redacted verification path, security/provenance checks, remaining limitations and `Final seven-stage E2E: NOT RUN (manual #124)`. Only then call GitHub issue close with reason `completed`, fetch again and verify status `closed`. If closure fails, keep the issue open and retry. Do not falsely report it closed.

**G. Continue automatically.** Select next dependency-ready issue. Do not ask for confirmation between normal tasks, do not stop at arbitrary commit count, green single test, 25-turn transcript or external provider status. A new issue may be started only after the prior fully verified issue is committed/pushed and closed, except explicitly independent work to bypass a genuine blocked task.

### If blocked

Missing Azure capability, business rules, package prices, published Zara persona config, Salesforce sandbox/OTP keys, n8n provider IDs, approval for secrets or actual signature provider **must not be fabricated**. Mark the issue `BLOCKED` in the ledger and its GitHub conversation, leave it **OPEN**, then advance other independent tasks with clearly labeled synthetic fixtures. Do not close a provider verification issue just because an internal stub returns `success:true`. If no independent safe task remains, provide an exact consolidated blocker report; don't claim impossible perpetual execution.

If interrupted by context/runtime limits, checkpoint, push only already verified task commits and resume on another authorized Codex invocation. **“Never stop” means avoid voluntary handoffs while capable of executing, not claim asynchronous work when the runtime has stopped.**

## 3. Issue queue

All tasks are individually described and linked at `docs/conversation-v2-issue-index.md`:

| Phase | GitHub issues | Required milestone |
| --- | --- | --- |
| P0 | **#82–#86** | Baseline, existing Azure GPT, strict v2-only schema, Node/Python contracts, ANCFZ stage evidence matrix |
| P1 | **#87–#91** | v2-only XLSX parser/validator, Admin publication, migration boundaries, reference workbook/tests |
| P2 | **#92–#96** | User Intent Document, turn ledger, CAS/idempotency, discovery/corrections, Redis cache and persona pin |
| P3 | **#97–#102** | Azure quota/retries, bounded Python agent, Node read tool gateway, authorized RAG, GPT goal reasoning, claim evidence |
| P4 | **#103–#107** | Natural Zara composer, Node response guard, offline fallback, Node coordinator, persona quality isolation |
| P5 | **#108–#111** | User action consent/confirmation, outbox/Redis/n8n idempotency, callbacks/reconciliation, PII/secret hardening |
| P6 | **#112–#119** | Lead, qualification, Account/OTP, packages/quote, SF-02, invoice/mock payment, contract, separate legal registration |
| P7-preflight | **#120–#123** | Focused CI/Docker, security/fault tests, **prepare but DO NOT RUN** final harness, rollback/cutover readiness |
| P7 manual hold | **#124** | Reserved final full 7-stage run; **never execute/close without explicit new user instruction** |

Respect each issue's dependency identifiers. Simulated provider acceptance uses deterministic verified mock callback and correlation evidence; sandbox provider acceptance requires independently verified sandbox provider status. A mixed mock/sandbox journey is **SIMULATED** and must list mocked stages.

## 4. Quality and security invariants

- Goal confidence, verified requirement coverage and action authorization are separate; a high model score is never action permission.
- Discovery has no compulsory Salesforce Lead; a knowledge interruption never destroys the confirmed business goal/pending question.
- Python is allowed bounded approved Node read tools; Node re-authorizes all calls, strips secrets and returns source/provenance with correlated call ID. No general Python code interpreter, arbitrary URL, direct n8n call or model-selected tenant.
- Final customer response is a naturally phrased **published Zara English persona** answer; evidence supports prices/legal claims; no raw RAG/tool results. Node final response guard applies even to persona-specific offline fallback.
- Session CAS, catalog/persona pins, idempotent replay and provider callback correlation survive restarts/Redis outage. Same clientMessageId + same hash returns saved response with **zero extra model calls and zero side effects**; conflicting hash is an error.
- Side effects require business-goal confirmation and **separate** purpose-specific consent plus action confirmation. Node commits ActionRequest + outbox; Redis/n8n external writes use stable idempotency. Ambiguous remote write yields reconciliation, not blind retry.
- Never call a n8n `webhook-test` path production-ready, never equate HTTP 200 with Salesforce record creation, never mark a contract signed from signing-link existence, never call mock payment `real_paid`.
- Stage 7 confirmed contract **fulfills the customer journey**; separate `legalRegistrationStatus` remains `pending`/`not_verified` until government/registrar evidence.

### Task-level test and audit checklist

- Correct package/API/Python/DB/Admin tests run **after** source edits; actual test command and result stored.
- New contract/parser changes include valid+invalid v2-only fixture, stage scope, tool activation, source ACL and authorization tests.
- Database changes are additive; validate fresh migration and existing data compatibility in disposable test DB only.
- Azure tests include 429 with Retry-After, initial+3 transient retry cap, nonretryable 400/401, deadline, circuit breaker and fail-closed.
- RAG tests include source revocation and prompt injection; claim-level evidence checks for consequential fees and legal/policy claims.
- Agent/guard tests include two tenants with different published personas, English Zara throughout normal/pending/error/declined/final replies, no repeated question, correct zero-question exceptions.
- Provider tests include duplicate webhook/callback, retry/reconciliation and no wrong Salesforce opportunity document association.
- For issue completion: redacted verification evidence, committed branch SHA, correctly closed GitHub issue. **Do not auto-run full seven-stage acceptance.**

Suggested issue comment:

    V2 task: V2-Px-yy — COMPLETE
    Remote branch/commit: feat/conversation-engine-v2, <SHA + GitHub URL>
    Focused tests: <commands, PASS/FAIL/SKIPPED, exit code>
    Evidence: docs/verification/conversation-v2/V2-Px-yy.md
    Source/tenant/consent guard: <verified>
    Mock vs sandbox provider state: <clearly labeled>
    Compatibility/rollback: <finding>
    Final seven-stage E2E: NOT RUN — reserved for manual issue #124

## 5. Absolute manual final acceptance gate

**The user explicitly requires final end-to-end validation only after all tasks are completed, and will trigger it manually.**

- Never run full seven-stage test scripts such as `npm run qa:agentic-e2e`, the v2 full journey runner, or equivalent, during routine coding, CI or per-task validation. Ordinary unit/integration/contract and focused smoke tests **are required** and may run automatically.
- Issue #122 is for **building and isolated testing** the manual harness, **NOT** executing its seven-stage scenario. Protect the full runner from default CI and accidental invocation.
- Issue #124 remains OPEN and unpassed after all #82–#123 complete. Do not close it based on readiness, cached QA, a 200-turn historic result or local mocks without an actual user-authorized final run.
- When #82–#123 are all truly CLOSED with validated pushed commits, report current branch SHA, issue counts, concise proof, remaining environment limitations and the exact **manual invocation instructions**. **STOP at #124**, pending explicit new user message.
- Only after an actual new user instruction may final seven-stage E2E be run; label each provider as sandbox/mock; preserve legal registration as separate. If it fails, open/reopen corrective issues, repair/test/commit/push, and require separate user trigger for another final attempt.

**Normal successful terminal state: issues #82–#123 validated, committed, pushed and closed; #124 intentionally OPEN, awaiting user manual final acceptance.** A real external dependency can instead produce a documented blocked status with unresolved issues still open. Never pretend the Codex runtime can work indefinitely without a running session.

## 6. Begin

Start immediately by checking out `feat/conversation-engine-v2`, inspecting GitHub issue **#82 / V2-P0-01**, and verifying the actual repository baseline and test commands. Complete each dependency-ready issue, validate it, commit and push, close it with proof and move to the next. Do not ask for routine continuation; only stop at the final manual gate or a documented unavoidable blocker.

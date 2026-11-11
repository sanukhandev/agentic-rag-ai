# Stabilize ANCFZ Conversation Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the V2 conversation path reliably answer package/quote questions, preserve package choices across turns, and avoid generic fallback loops while retaining grounding, consent, and side-effect safeguards.

**Architecture:** Fix the shared Node routing/state boundary first, then align the catalog tool names passed to Python with the names Node can execute. Keep the response guard fail-closed, but make package evidence and pending offers explicit enough that valid customer turns are not discarded. Treat the contact-token issue as a test-fixture contract defect, not as permission to weaken production PII handling.

**Tech Stack:** TypeScript/Node API, Python model gateway, PostgreSQL catalog/session state, Docker Compose, Vitest, pytest, and the existing 15-use-case runner.

**Spec:** `docs/conversation-engine-architecture.md`, `docs/conversation-engine-contracts.md`, `docs/conversation-engine-evaluation.md`, `docs/persona-response-contract.md`, `docs/agent-tool-loop.md`, `docs/intent-taxonomy.md`, `docs/conversation-planner.md`.

## Global Constraints

- ANCFZ is the only acceptance tenant for this phase; shared code must remain tenant-neutral.
- PostgreSQL is source of truth; Redis remains cache/lock only.
- Every factual business answer must use approved evidence or an approved persona fallback.
- Node alone authorizes tools and side effects; model confidence is never consent or completion.
- Preserve existing uncommitted changes, migrations, customer records, and rollback paths.
- Use synthetic sessions only; do not call real CRM, n8n, payment, signature, or provider systems.
- Do not weaken PII masking/token validation to accommodate an invalid test token.

## Review Focus

- A customer says `Growth`, `I will go with Growth`, or `compare Growth and Premium`; the next turn must retain package context and not fall into generic dialogue. Test in the package offer/state task.
- A customer asks for a `quote` or `quotation`; the request must preload approved pricing/package evidence. Test in the routing task.
- A published catalog binding is named `package.read_available` while the executable tool is `get_available_packages`; the model envelope and Node authorization must use one unambiguous contract. Test in the tool-contract task.
- A package-specific answer is rejected as `policy_denied`; the guard must distinguish conflicting evidence from a valid single-package read without weakening unsupported-claim checks. Test in the guard task.
- Contact fixtures use `[EMAIL]`/`[PHONE]` while production masking emits suffixed tokens; the runner must use the real token contract and assert extracted state. Test in the runner/fixture task.

## Scope and existing files

Modify only the shared conversation path and its direct tests/configuration:

- `services/api/src/conversation/turn-controller.ts` — package routing, evidence preload, and durable package offer state.
- `services/api/src/conversation/turn-controller.test.ts` and `services/api/src/conversation/conversation-quality.test.ts` — routing and turn-level regressions.
- `services/api/src/conversation/tool-policy.ts` — single mapping between catalog binding keys and executable V2 tool names.
- `services/api/src/conversation/tool-policy.test.ts`, `services/api/src/python-model/contracts.test.ts`, and coordinator/tool-loop tests — contract coverage.
- `services/api/src/conversation/evidence.ts`, `services/api/src/conversation/evidence.test.ts`, `services/api/src/conversation/coordinator.test.ts` — package grounding/guard behavior.
- `services/api/src/model.ts`, `services/api/src/model.test.ts`, and `scripts/live-session-hardening.mjs` — only the test token contract; production extraction remains strict.
- `docs/current-state.md` — record measured results and remaining gaps.
- The published ANCFZ catalog/package rows — update only through the existing reviewed Admin/import path after source and validation tests pass; do not issue ad-hoc SQL writes.

Do not change the generic fallback wording, response guard policy, or action authorization merely to improve transcript appearance. Those are enforcement boundaries and must be changed only when a focused test proves the current rule is incorrect.

### Task 0: Freeze the reproducible baseline

**Files:**
- Read: `artifacts/ancfz/15-use-case-conversations-2026-11-10.json`
- Read: `artifacts/ancfz/15-use-case-db-transcript-2026-11-10.json`
- Read: `artifacts/ancfz/15-use-case-conversation-review-2026-11-10.md`
- Modify: `docs/current-state.md`

**Interfaces:**
- Consumes: the existing 15-use-case run and DB audit results.
- Produces: a fixed baseline of 94 user turns, 50 `safe_no_evidence_dialogue` turns, 19 duplicate answer digests, 0 actions/CRM leads, and the five confirmed failure classes above.

- [ ] Record the baseline counts and the current branch/working-tree state in the dated current-state section if they are not already present.
- [ ] Add a read-only diagnostic query/script note that reports, per turn, `candidateGuardReason`, `guardReason`, tool names/statuses, evidence count, pending offer, and pending requirement without exposing secrets or raw PII.
- [ ] Run the baseline query against the existing captured session window and confirm the counts before implementation.

Expected result: a reviewer can compare every later run against the same transcript and DB measurements.

### Task 1: Make package and quote turns reach approved evidence

**Files:**
- Modify: `services/api/src/conversation/turn-controller.ts:150-151, 310-340`
- Test: `services/api/src/conversation/turn-controller.test.ts`
- Test: `services/api/src/conversation/conversation-quality.test.ts`

**Interfaces:**
- Consumes: `isV2PackageQuestion(message)`, `listApprovedV2PackageEvidence`, `listApprovedV2PackageOptions`, `authorizedV2ReadToolsForTurn`.
- Produces: deterministic package-intent coverage for package names, selection/comparison language, and quote requests while preserving the existing `knowledge`/visa distinction.

- [ ] Add failing tests for `Growth`, `I will go with Growth`, `compare Growth and Premium`, `what is the quote`, and `quotation for two visas`; assert package routing is enabled and the package read tool is authorized.
- [ ] Add negative tests for `how many visas do I need?`, `what visa requirements apply?`, and ordinary greeting/recap turns; assert package routing is not enabled unless package context is actually requested.
- [ ] Run the focused tests and confirm the new cases fail before implementation.
- [ ] Extend the shared package-intent predicate with quote/quotation and package-selection/comparison semantics. Use the published package keys/names where available so natural package names are not treated as arbitrary keywords.
- [ ] Ensure the preflight path loads both approved package evidence and package options for those turns, including a bare package-name follow-up after a package list.
- [ ] Re-run the focused tests and confirm unrelated knowledge routing still passes.

Acceptance: every package/quote input in the 15-use-case set has either approved package evidence or an explicit, auditable unavailable state; it must not silently enter the generic no-evidence path.

### Task 2: Persist and resolve package selections as a real conversational offer

**Files:**
- Modify: `services/api/src/conversation/turn-controller.ts:168-173, 887-913`
- Modify only if required by the existing state contract: `services/api/src/conversation-state.ts`
- Test: `services/api/src/conversation/turn-controller.test.ts`
- Test: `services/api/src/model.test.ts`
- Test: `services/api/src/conversation-state.test.ts` if state merge behavior changes

**Interfaces:**
- Consumes: `V2PackageOption`, `FollowUpOfferOption`, `PendingFollowUpOffer`, `classifyOfferReplyDeterministically`.
- Produces: a persisted offer whose option keys are stable package keys and whose retrieval hints identify the selected package.

- [ ] Add a failing controller test: package-list response persists a non-expired pending offer containing Starter/Growth/Premium options and a subsequent `I will go with Growth` resolves `package_growth` (or the chosen canonical package key) without generic fallback.
- [ ] Add a failing test that the selected package is scoped to the pinned tenant/catalog version and cannot be accepted after the offer expires or the intent changes.
- [ ] Run the focused tests and confirm the current package-list behavior leaves `pendingPromptId`/offer state empty.
- [ ] Add the smallest package-offer builder near the existing follow-up persistence path. It must derive labels and retrieval hints from approved `V2PackageOption` rows, preserve token checks, and never create a write/action authorization.
- [ ] Persist this offer when package options are delivered, while retaining model-provided follow-up options for non-package turns.
- [ ] Feed the accepted package option back into `contextualizedQuery`/approved evidence so the next answer is about the selected package rather than the whole catalog.
- [ ] Keep `packageSelectionReady` unchanged: package selection is not CRM/action readiness, consent, or workflow confirmation.
- [ ] Run the focused tests and the existing state-merge tests.

Acceptance: the case-6 sequence `What packages do you have?` → `I will go with Growth` → `What is included?` retains Growth context and returns only grounded Growth information.

### Task 3: Unify catalog binding keys and executable tool names

**Files:**
- Modify: `services/api/src/conversation/tool-policy.ts`
- Modify: `services/api/src/conversation/turn-controller.ts:382-384`
- Test: `services/api/src/conversation/tool-policy.test.ts`
- Test: `services/api/src/python-model/contracts.test.ts`
- Test: `services/api/src/conversation/coordinator.test.ts` and `services/api/src/conversation/tool-gateway.unit.test.ts` where the envelope/tool scope is asserted
- Read/adjust only if contract serialization requires it: `services/model-gateway/gateway/persona_composer.py`, `services/model-gateway/gateway/v2_contracts.py`

**Interfaces:**
- Consumes: catalog binding keys such as `knowledge.search` and `package.read_available`.
- Produces: model `enabledReadToolKeys` and signed `toolAllowlist` containing executable names such as `search_knowledge` and `get_available_packages`, with one shared mapping.

- [ ] Add a failing test asserting an enabled catalog binding for `package.read_available` produces `get_available_packages` in both the envelope metadata and signed tool allowlist.
- [ ] Add a failing test asserting disabled or unrelated bindings do not authorize that executable tool.
- [ ] Run the focused contract/policy tests and capture the current mismatch.
- [ ] Export/reuse the existing binding-to-tool mapping rather than duplicating string maps in the controller.
- [ ] Populate `catalogV2.enabledReadToolKeys` from the validated executable tool names, not raw catalog binding keys; keep action keys separate and unchanged.
- [ ] Preserve fail-closed validation in `validateToolRequest`; never make the executor accept both aliases without an explicit canonicalization boundary and tests.
- [ ] Run the model-gateway contract tests and a tool-loop test that actually executes `get_available_packages`.

Acceptance: the planner can propose only names that Node can validate and execute, and a catalog binding cannot accidentally grant an unimplemented or side-effecting tool.

### Task 4: Isolate and correct the package-specific `policy_denied` path

**Files:**
- Test first: `services/api/src/conversation/evidence.test.ts`
- Test first: `services/api/src/conversation/coordinator.test.ts`
- Modify only after the failing test identifies the incorrect rule: `services/api/src/conversation/evidence.ts` and/or `services/api/src/conversation/coordinator.ts`

**Interfaces:**
- Consumes: approved package evidence, tool trace source refs, candidate citations, and response guard verdicts.
- Produces: either an accepted grounded answer for one package or a truthful approved fallback when evidence conflicts/unavailable.

- [ ] Create a minimal fixture reproducing case 10: Growth-specific approved evidence, the candidate’s three citations, `candidateGuardReason=policy_denied`, and the final zero-citation fallback.
- [ ] Assert which exact guard rule rejects it; do not infer the rule from the final text. Preserve diagnostic candidate data in the test fixture only, without logging secrets.
- [ ] Add a passing test for a single-package Growth answer with one package evidence source and a failing/abstention test for conflicting package prices or mixed package citations.
- [ ] Implement the smallest correction at the rejecting layer. If the candidate is valid, constrain the evidence set to the selected package; if the candidate is invalid, retain the denial and improve only the approved fallback’s specificity.
- [ ] Verify that unsupported claims, conflicting prices, invalid citations, and provider-success claims remain denied.

Acceptance: case 10 no longer fails because a valid single-package answer is over-rejected, and unsafe/conflicting answers remain blocked.

### Task 5: Repair the synthetic contact fixture contract

**Files:**
- Modify: `scripts/live-session-hardening.mjs` use-case messages only
- Test: `services/api/src/model.test.ts`
- Optional test: runner-level assertion in `scripts/live-session-hardening.mjs` or a small existing runner test

**Interfaces:**
- Consumes: production token format `[NAME_n]`, `[EMAIL_n]`, `[PHONE_n]`.
- Produces: synthetic transcripts that exercise the real PII extraction path and DB state assertions for name/email/phone/consent.

- [ ] Add/retain unit tests proving suffixed placeholders are extracted and unsuffixed placeholders are not silently treated as production tokens.
- [ ] Replace runner literals `[EMAIL]` and `[PHONE]` with suffixed masked tokens and keep all values synthetic.
- [ ] Add a run assertion that contact cases persist the expected masked channel fact and consent state before reporting a conversational pass.
- [ ] Do not change `extractLeadData` to accept the invalid unsuffixed format unless a separate approved token-contract migration is requested.

Acceptance: contact/consent failures in cases 3, 11, and related journeys represent conversation behavior rather than a harness-format mismatch.

### Task 6: Validate the published catalog and update it through the supported path

**Files:**
- Read/validate: published ANCFZ V2 catalog rows for the pinned version `anc:r12:f9a46f1822603a66c0c98a94876b2fe1cb4ff3d42894f44b8816e686da935751`
- Modify through existing importer/Admin workflow only: reviewed catalog source and resulting published version
- Test: `tools/ingestion/test_catalog_v2.py` and the existing catalog validation suite
- Modify: `docs/current-state.md`

**Interfaces:**
- Consumes: catalog signals, knowledge topics, requirement policies, tool bindings, and approved package rows.
- Produces: a new reviewed/published version only if the source is changed and validation passes.

- [ ] Confirm the current catalog lacks direct aliases for quote/quotation, package names, and natural selection phrases; record the evidence before changing source data.
- [ ] Add only the minimum catalog aliases/topics needed after deterministic routing is covered: package names, quote/quotation, and approved comparison/selection expressions. Keep goal confirmation separate from package selection.
- [ ] Validate importer output, duplicate keys, supported language, tool bindings, and published package rows before publication.
- [ ] Publish via the existing Admin/import path in the local synthetic environment; never update production or use ad-hoc SQL.
- [ ] Re-pin only newly created synthetic test sessions; do not rewrite historical transcripts.

Acceptance: the published catalog and package rows provide the evidence and signals the runtime expects, with a new immutable catalog reference and a documented rollback to the previous reference.

### Task 7: Run the full verification and produce the review report

**Files:**
- Read: all changed files and the generated artifacts
- Create: `artifacts/ancfz/15-use-case-conversation-review-<timestamp>.md`
- Modify: `docs/current-state.md`

**Interfaces:**
- Consumes: focused regression results, unit/integration suites, local Docker services, and the updated published synthetic catalog.
- Produces: reproducible transcript/DB evidence and a pass/fail report.

- [ ] Run focused Node tests for controller, model, policy, evidence, coordinator, tool gateway, and state persistence.
- [ ] Run Python gateway tests, ingestion tests, TypeScript typecheck/lint/build, root tests, Compose/security checks, and the existing Docker health checks.
- [ ] Run all 15 use cases with the corrected synthetic tokens and zero turn delay.
- [ ] Query PostgreSQL read-only for sessions, messages, intent turns, tool traces, pending offers, guard reasons, action requests, CRM leads, and catalog version references.
- [ ] Report both quality and safety metrics: generic fallback count, duplicate digests, package-selection success, grounded package answers, contact extraction, `policy_denied` count, unsupported-claim denials, actions, and CRM leads.
- [ ] Review every transcript manually for one purposeful follow-up, no repeated generic loop, no unsupported business facts, no leaked internal metadata, and persona/language consistency.
- [ ] Update `docs/current-state.md` with exact commands, dates, artifact links, measured pass/fail results, and any remaining blocked issue.
- [ ] Stop before commit/push and present the report for review; do not merge or promote anything.

## Exit criteria

The fix is ready for review only when:

1. The package-list → package-selection → package-detail sequence passes with durable state in PostgreSQL.
2. Quote/quotation and natural package names reach approved package evidence.
3. The model/tool envelope uses executable tool names consistently and tool authorization remains fail-closed.
4. The reproduced package-specific `policy_denied` case is either correctly accepted or correctly abstained for a demonstrated evidence reason.
5. Contact/consent cases use valid synthetic tokens and their DB facts are verified.
6. All existing automated suites remain green and the 15-use-case report shows no new safety regressions.

No implementation should start until this plan is reviewed, because the current branch already contains uncommitted changes and the catalog publication step changes external local state.

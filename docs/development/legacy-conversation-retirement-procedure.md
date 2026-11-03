# Safe retirement of V1 conversation code — integration-owner procedure

Applies to the **future deletion PR only**, not `chore/v2-legacy-cleanup-prep`. Start from the **integrated** GPT-first target, not from an isolated development branch. Read `docs/engineering/legacy-conversation-retirement-inventory.md` for per-function classifications, callers, replacements and blocking gates.

## Ordered cutover and removal

1. **Integrate prerequisites.** Merge the Business Goal confirmation and seven-stage action-gate branches by their respective owners; settle overlapping contracts and tests. Confirm a published Catalog V2, confirmed-goal persistence, opportunity/session revision handling, tenant guardrails, callback reconciliation and purpose-specific action consent. This preparation branch deliberately does not alter any of those modules.
2. **Prove the GPT-first entry boundary.** Enumerate every caller of `createApp` and `POST /api/v1/chat/messages`, including multi-tenant feature flags, offline model fallback, actions/follow-ups, Admin and channel clients. Test V2-only chat dispatch, exactly-once turns, replay, failure-closed behavior, tenant/pinned-persona isolation and no automatic business writes. Do not remove rollback in this step.
3. **Collapse duplicate generation.** In a *separate* production refactor, retire the embedded V2-in-legacy drafting block and old planner branch only after the single GPT-first controller is verified to cover their cases. Preserve routes for session history, documents, confirmation, reconciliation, Admin and callback processing. Do not delete `app.ts`.
4. **Migrate non-chat model hooks.** Reconciliation follow-up and CRM summary are separate `model.draft`/`model.summarize` consumers; explicitly migrate or retain them. Maintain authorization and customer-visible persona response guard. Do not infer that migrating chat messages retires every `ChatModel` method.
5. **Approve rollback retirement.** Obtain integration/deployment owner decision, rollback drill evidence and configuration inventory: `CONVERSATION_ENGINE_V2_ENABLED`, `CONVERSATION_ENGINE_V2_TENANTS`, `CHAT_MODEL_PROVIDER`, `PYTHON_MODEL_URL`, container overlay and any external V1 model clients. Until this gate, retain `pythonChatModelFromEnv`, adapter and Python V1 routes.
6. **Retire adapter + V1 Python endpoints.** Once references are zero, remove V1 Node factory/import/adapter and Python `/internal/v1/model/{plan,normalize}` route functions and old Pydantic contracts. Retain shared FastAPI app, Azure API client, auth, health, reliability limits, Python V2 graph/agent and read-only tool definitions.
7. **Trim V1-only helpers, scripts and tests last.** Do a symbol-level call graph for `model.ts`, `conversation-state.ts`, `intent-catalog.ts` and `agent-tools.ts`. Delete only unused exports/functions; preserve V2-shared normalization/requirements and security. Keep relevant unit tests and dated verification evidence. Evaluate dev scripts, fixtures, Docker overlays and package commands independently; delete no applied SQL migration.
8. **Final static/runtime review.** Update the guard's permitted V1-import exception only when rollback is explicitly retired; never weaken protected-module or migration baselines. Review security, secret scan, test scope and tenant policies. Open a separate final deletion PR and obtain owner review before merging.

## Static checks added by the preparation branch

Run `node scripts/check-v2-retirement-safety.mjs` and `node --test scripts/check-v2-retirement-safety.test.mjs` (Node 22+, offline). The guard checks: baseline **57** SQL migration filenames, **21** critical V2 source modules, unexpected new imports of `chat-model-adapter` outside the existing `index.ts` rollback allowance, calls to legacy planners from the two GPT-first routing modules, unapproved Python function-tool definitions / bypass of tool allowlisting, and obvious Python DB/direct-write capabilities. It scans code and files **without modifying them**.

The guard is a **lightweight tripwire, not a full dependency graph, parser, permission audit or proof of absence**. It deliberately does not delete files or block the still-active V1 rollback. Code search and peer review remain mandatory, especially for dynamic imports, Python aliases/multiline expressions and external callers.

## Unit-only validation contract

PR checks on the integration branch use **unit tests, typecheck, lint, build, static secret checks, and this offline guard with its isolated unit tests**. Forbidden in this validation job: Docker/Compose integration, database migrations or live DB, E2E/25–200-turn harness, live Azure, n8n/provider execution, external HTTP tests. Passing this job means static/unit readiness, **not** live seven-stage completion or conversation-quality acceptance.

## Final integration-owner merge checklist

- [ ] Both parallel branches integrated; no production-code diffs in the preparation PR.
- [ ] All changed files are permitted: `docs/development/**`, `docs/engineering/**`, `scripts/*` static tool/tests, and the specified CI workflow only.
- [ ] `git diff --name-status` confirms no modified/deleted migration, controller, provider, store, gateway or agent runtime file.
- [ ] Inventory and candidate ledger have current import/caller/entry-point/rollback evidence at integration tip (refresh if divergent).
- [ ] The CI job contains **only** unit/typecheck/lint/build/static checks and runs on PRs targeting `feat/gpt-first-langgraph-unit-only`.
- [ ] Offline guard and isolated unit tests pass; `npm run test:unit`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:secrets` and Python unit tests report exact outcomes.
- [ ] Tenant/session, RAG, vector DB, Redis/outbox, callback reconciliation, opportunity lifecycle, consent and action confirmation are unchanged.
- [ ] Deletion remains blocked until confirmation, action gates, rollback approval, and V2 consumer migration are proven. A **separate** retirement PR performs any actual deletion.
## Integration tip recheck — 2026-11-03

- PRs #129, #130 and #131 have merged into `feat/gpt-first-langgraph-unit-only`; goal-confirmation persistence and deterministic action boundaries now exist.
- Added the applied/additive migration `057-v2-business-goal-confirmation.sql` to the static deletion-protection baseline. Migration 055–057 remain mandatory.
- GPT-first traffic routes via `runGPTFirstChatTurn`, but `app.ts` still contains the explicitly enabled legacy rollback planner and an older embedded V2 block. Both remain referenced; **this note does not authorize deleting them**.
- Verified Node code bootstraps a confirmed V2 journey and checks persisted purpose consent at the public action confirmation boundary. Real provider execution, failure recovery, and live rollout parity are **not** established by these unit tests.
- Removal of the old V1 adapter and endpoints remains blocked until the deployment owner approves rollback retirement and equivalent tenant/feature-flag recovery behavior is demonstrated. The next deletion PR must prove every remaining import/caller is migrated.
- Unit-only CI and static guard passing is not live acceptance evidence.


## Integration checkpoint — 2026-11-03

The prerequisite child PRs are now merged into `feat/gpt-first-langgraph-unit-only`:
- #129 static retirement inventory and unit-only CI
- #130 scoped Business Goal confirmation with atomic message/intent persistence
- #131 seven-stage authorization, provider correlation and production-mock denial

The integration branch additionally initializes a scoped Stage-1 journey **only after** durable customer confirmation; validates public action-confirmation requests against the canonical V2 catalog, persisted stage, opportunity and independent purpose-scoped consent; and rejects terminal callback completion without a trusted provider readback. Canonical V2 catalog references are stored separately from legacy UUID columns via additive migration 058 for actions, executions, CRM Leads and supporting documents.

**Runtime-retirement gates are not all satisfied.** V2 provider-record completion and atomic stage transitions are not yet wired to a trusted Node provider adapter, and a complete purpose-specific V2 consent/authorization UX is not implemented. Model-proposed actions remain advisory and no V2 operation is automatically dispatched. The V1 adapter and embedded legacy conversation planner still serve an explicit rollback/disabled-tenant path. Removing them without a deployment rollout inventory, verified fallback coverage and owner-approved rollback retirement would break supported behavior.

**Executed cleanup:** dependency inventory, static tripwires, protected migration list extended to 058, and unit-only CI. **Intentionally deferred:** deleting V1 planner/adapter/routes, shared helpers or legacy unit tests. The PR stays draft; do not classify unit-only validation as real Azure conversation quality, Salesforce provider acceptance, or seven-stage production completion.

**Next safe retirement gate:** produce an import/caller graph at the final integrated tip, verify all tenant routing/configuration and non-chat model consumers, and obtain approved rollback retirement with an alternative recovery mechanism. Only then make deletion changes in a separate reviewable PR.

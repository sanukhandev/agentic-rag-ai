# Code Cleanup and Security Refactor Plan

Branch: `chore/codebase-cleanup-solid-security`

Status: audit complete; Phase 1 is complete on this branch. Phases 2–6 remain planned.

## Guardrails

- Preserve public API routes, response contracts, tenant isolation, PII masking, consent gates, n8n action authorization, OCR, and the existing lead-capture workflow.
- Do not reset data, change database semantics, expose new listeners, or alter unrelated tenants.
- Do not refactor by behavior inference. Each moved function keeps its validation, error handling, and tests.
- Keep each phase independently buildable and reversible. No broad formatting-only rewrite.

## Baseline evidence

Run on `origin/main` before cleanup:

- `npm test`: 126 passed, 1 intentional skip.
- `npm run typecheck`: passed for admin, web, API, and contracts.
- `npm run lint`: passed for the API workspace. Admin and web do not currently define lint scripts.
- `npm run verify:secrets:test`: passed.
- `npm run verify:secrets`: passed; 208 files scanned for high-confidence patterns.
- `npm run verify:compose`: passed; local-only service bindings and pinned n8n digest verified.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- TypeScript with `noUnusedLocals`, `noUnusedParameters`, and `allowUnreachableCode=false` found no unreachable statements, but did find the unused symbols listed below.

## Confirmed cleanup findings

### Dead or unused code

These are safe first-pass candidates because static analysis found no reads:

- `services/api/src/cache.ts:54`: `RedisCache` stores `url` as a parameter property but only needs the constructor argument to create the client.
- `apps/web/app/page.tsx`: unused `ChatCitation` import, `isAdminTestingMode` state/setter, `voiceListening` state/setter, and `voiceTurnRef`.
- `apps/web/app/chat-utils.test.ts`: unused `formatInlineMarkdown` import.
- `apps/web/app/chat-utils.ts`: `formatNaturalAbstention` accepts `agentName` but never reads it.
- `apps/admin/src/app/components/customer-chat/customer-chat.component.ts`: unused `SafeHtml` type import and unused `ChangeDetectorRef` injection.
- `apps/admin/src/app/components/customer-chat/customer-chat-utils.ts`: `formatNaturalAbstention` accepts `agentName` but never reads it.

The `admin`/`debug` query flag is currently write-only in the web app. Removing it is a behavior change if an undocumented consumer depends on it, so the first cleanup should either remove the flag and document that decision or make the mode visible and tested; it must not remain as dead state.

### Duplicate implementation

`apps/admin/src/app/components/customer-chat/customer-chat-utils.ts` and `apps/web/app/chat-utils.ts` independently implement tenant slug validation/resolution, HTML escaping, inline markdown rendering, block markdown rendering, and abstention handling. The two implementations already differ in fallback copy and diagnostics/types.

Planned fix: create one small dependency-free shared package for pure chat presentation utilities. Keep app-only state, Angular sanitization, React rendering, and diagnostics in their owning applications. Add shared unit tests before deleting either copy.

Do not merge the API memory and PostgreSQL stores into one class. Their duplication is an intentional adapter boundary; first reduce it only through shared types, mapping tests, or repository interfaces if a measured defect appears.

## Refactor sequence

### Phase 1 — safe dead-code cleanup

1. Remove the confirmed unused imports, fields, state, and parameters.
2. Update all local callers and tests.
3. Enable the stricter TypeScript checks in CI as an audit gate, without changing runtime behavior.

Checks: workspace typecheck, tests, API lint, and `allowUnreachableCode=false`/unused checks.

#### Completed on this branch

- Removed confirmed unused React/Angular imports, state, refs, and the unused Redis constructor property.
- Removed the unused `agentName` argument from abstention helpers and updated all callers/tests.
- Removed the web-only write-only `admin`/`debug` query-state path; the authenticated admin diagnostics mode remains in the Angular admin app.
- Re-ran the strict unused/unreachable audit: all TypeScript workspaces pass.
- Re-ran regression tests: 126 passed, 1 intentional skip; all workspace builds pass.

### Phase 2 — shared pure UI utilities

1. Add a minimal `packages/chat-utils` package only for browser-safe pure functions and types.
2. Move tenant slug validation/resolution, escaping, markdown formatting, and natural abstention normalization.
3. Preserve the current public behavior with characterization tests, including malicious HTML, tenant traversal strings, markdown lists/code, and abstention variants.
4. Import the package from both admin and web; remove the two copies.

No DOM, Angular, React, `window`, API, or secret access belongs in this package.

### Phase 3 — backend code split by responsibility

`services/api/src/app.ts` is the primary SRP target. Split only after Phase 1 tests are green:

- `schemas/`: Zod boundary schemas and shared parsers.
- `middleware/`: auth, channel authentication, rate limiting, request IDs, origin enforcement, and error mapping.
- `routes/health.ts`, `routes/auth.ts`, `routes/admin.ts`, `routes/chat.ts`, `routes/workflows.ts`, and `routes/documents.ts`.
- `application/`: chat orchestration, lead/catalog policy, document intake, workflow authorization.
- `adapters/`: model, embeddings, n8n, cache, and persistence adapters.
- `createApp` remains the composition root and owns dependency injection.

Each route module receives an explicit typed context. Route handlers remain thin; SQL stays in repositories; external side effects remain behind allowlisted adapters. No endpoint names or response shapes change.

### Phase 4 — admin and web component split

- Extract the large web `page.tsx` into session/config/chat-actions/document-upload hooks and presentational components.
- Keep `CustomerChatComponent` focused on view state; move transport and mapping helpers into the existing service/util pattern.
- Share only pure contracts/utilities; do not couple Angular and Next runtime code.
- Preserve accessibility labels, keyboard behavior, consent action UX, and tenant-scoped local-session keys.

### Phase 5 — security checklist hardening

Add or retain tests for:

- tenant IDOR and guessed session/action/document IDs;
- channel API-key/HMAC authentication, nonce replay, rotation, and cross-tenant rejection;
- PII masking before model/n8n calls and no plaintext in logs/audit metadata;
- source ACL/public visibility and prompt-injection refusal;
- consent required before CRM mutation and confirmation callback replay protection;
- upload MIME/magic/size validation, bounded base64 handling, parser cleanup, and SSRF rejection;
- workflow allowlist, signed callback validation, idempotency, timeout/reconciliation behavior;
- response errors that expose stable codes but not secrets, SQL, tokens, or raw provider payloads.

Static scans are not a production security sign-off. TLS, admin MFA, secret-manager rotation, external provider data-processing approval, firewall policy, and live n8n/Salesforce configuration require deployment evidence.

### Phase 6 — measured optimization

Use evidence rather than speculative tuning:

- remove duplicate tenant lookups within a request and avoid repeated full conversation loads;
- add/verify PostgreSQL indexes from actual query plans, not intuition;
- keep cache keys tenant/session/message scoped and verify bounded fallback memory;
- cap concurrent ingestion/workflow work and retain idempotency;
- lazy-load large admin views and measure browser bundle budgets;
- use production-like p95 latency, query duration, queue depth, and error-rate baselines before/after.

Do not add a framework, queue, ORM, or abstraction solely for style.

## SOLID review rules

- Single responsibility: routes transport; services enforce policy; repositories persist; adapters call external systems.
- Open/closed: add workflow/channel/provider adapters through existing interfaces and allowlists, not conditionals scattered across routes.
- Liskov: memory and PostgreSQL stores must satisfy the same `Store` behavior and failure semantics.
- Interface segregation: split large interfaces only when a caller needs a smaller contract; do not create marker interfaces.
- Dependency inversion: inject clock, store, cache, model, embedding, and workflow dependencies at the composition root.

## Acceptance gates

Every phase must pass:

```text
npm test
npm run typecheck
npm run lint
npm run verify:secrets:test
npm run verify:secrets
npm run verify:compose
npm audit --omit=dev --audit-level=high
npm run build
```

For the backend split, additionally run the API integration/security suite and compare the route matrix and OpenAPI document. For UI changes, build both admin and web and perform a browser smoke test for tenant resolution, chat continuity, consent action, document upload, and error rendering.

## Rollback and change control

- One logical phase per commit; no database migration is needed for this cleanup plan.
- Revert the phase commit if route snapshots, tenant isolation, masking, or browser behavior changes unexpectedly.
- Keep this plan updated with each completed phase, actual test output, and any deferred risk.

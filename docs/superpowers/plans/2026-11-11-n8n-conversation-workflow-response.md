# n8n conversation workflow response implementation plan

> **Execution note:** implement in this branch only. Local code/test/build must be green before any VM action. Preserve the existing VM database, session rows, SSL files and unrelated runtime configuration.

## Goal

Make the published ANCFZ V2 catalog authorize the active Salesforce Lead and quotation workflows, dispatch their exact payload contracts through the existing durable action/outbox path, normalize their results, and expose those results through the next guarded conversation turn. The customer should receive a truthful submitted, generated, pending or failed response; no worker-generated duplicate assistant message is created.

## Scope and decisions

- Use catalog-first action routing; no direct conversation-to-webhook calls.
- Use `/n8n/webhook/salesforce-lead` and `/n8n/webhook/generate-quotation` as the remote transport routes.
- `lead.create` is enabled only with verified contact facts, purpose consent and explicit Lead confirmation.
- `quotation.generate` is enabled at package selection only with a confirmed package, a provider-backed account reference, quotation consent and explicit quotation confirmation.
- The remote quotation `accountId` comes from the current verified account; `REMOTE_N8N_QUOTE_ACCOUNT_ID` is allowed only for synthetic acceptance when no customer account exists.
- The confirmation turn reports submission/pending. The next status or continuation turn reads the persisted normalized result through `get_action_status` and composes the customer-visible workflow response.
- HTTP 200, n8n success, a PDF body or a Lead ID is not silently treated as legal stage completion; provider evidence and existing callback/reconciliation gates remain authoritative.

## Files and interfaces

### Catalog and contracts

- `services/api/src/fixtures/ancfz-catalog-v2.json` — add the active Lead/quotation tool and workflow rows plus quote requirements.
- `services/api/src/fixtures/ancfz-catalog-v2-seven-stage.json` — keep the seven-stage runtime fixture in sync with the base fixture.
- `intent-source/ANCFZ_CATALOG_REVIEW_ROWS.json` — record the reviewed remote workflow identities and quote action requirements as source evidence.
- `services/api/src/conversation/catalog.ts` — only extend schema/runtime validation if the remote transport marker or new requirement metadata needs a typed field; do not weaken existing cross-reference checks.
- `services/api/src/conversation/catalog-runtime.ts` and `services/api/src/conversation/workflow-bridge.ts` — expose the transport/provider metadata needed to distinguish local n8n from the supplied remote routes and preserve the published-catalog pin.
- `services/api/src/conversation/catalog.test.ts`, `catalog-runtime.test.ts`, `workflow-bridge.test.ts` — failing tests first for enabled tool reachability, complete route identity, remote path resolution and quote prerequisite references.

### Remote workflow transport and result normalization

- `services/api/src/remote-n8n.ts` (new) — typed request builders and response normalizers for the two supplied contracts. It will:
  - build the exact Lead JSON fields (`Name`, `Company`, `Phone`, `Email`, `Description`);
  - build the exact quotation JSON fields (`accountId`, `customerName`, `email`, `packageName`, `currency`, `items[]`);
  - send the quotation `x-api-key` from private runtime configuration only;
  - reject non-HTTPS base URLs, invalid route paths, non-2xx results, invalid Lead responses and non-PDF/empty quotation responses;
  - return masked typed outcomes containing only safe status, provider reference, artifact digest/content type and reconciliation metadata.
- `services/api/src/remote-n8n.test.ts` (new) — RED/GREEN coverage for Lead `SUCCESS`, Lead `UPDATED`, quote PDF success, invalid PDF, HTTP 500, timeout, missing key and secret non-logging.
- `services/api/src/types.ts` and `services/api/src/actions.ts` — extend action result/outcome types only as needed for normalized provider status and quote artifact metadata; preserve existing idempotency and state transitions.
- `.env.example`, `docker-compose.yml`, `services/api/src/event-worker.ts` — add private remote transport configuration without committing keys and without changing SSL-related settings.

### Durable dispatch and conversation projection

- `services/api/src/event-bus.ts` — route remote catalog bindings through the remote adapter, construct provider payloads from the action/session/catalog state rather than raw event PII, persist normalized accepted/result metadata, and preserve retry/reconciliation behavior. Local internal n8n routing must remain unchanged.
- `services/api/src/event-bus.test.ts` — RED/GREEN tests for route selection, exact payload shape, remote header use, idempotent dispatch, remote failure classification and no secret/PII leakage.
- `services/api/src/conversation/action-gate.ts` — validate `quotation.generate` against catalog tool binding, confirmed package, account/provider reference, purpose consent and explicit customer confirmation; do not add a hardcoded ANCFZ-only route.
- `services/api/src/conversation/turn-controller.ts` — accept catalog-proposed Lead/quotation actions, create the correct action proposal text from the tool binding, and preserve the current pending requirement when the customer asks an unrelated knowledge question.
- `services/api/src/conversation/tool-gateway.ts` — include safe normalized workflow outcome fields in `get_action_status` evidence so the planner/composer can report Lead update or quotation artifact availability on the next turn.
- `services/api/src/conversation/response-guard.ts`, `persona-quality.test.ts`, `turn-controller.test.ts`, `tool-gateway.unit.test.ts` — ensure customer replies contain no webhook URL, API key, internal action key, raw provider payload or unsupported completion claim; add success/pending/failure response tests.

### Verification artifacts and VM publication

- `scripts/acceptance-remote-n8n.mjs` — retain synthetic-only remote smoke coverage and extend it only to assert the same response normalizers used by the application.
- `scripts/publish-dev-catalog.mjs` or the existing VM catalog publication path — publish the validated catalog as a new version; never mutate the existing published row in place.
- `docs/n8n-workflows.md`, `docs/remote-n8n-integration.md`, `docs/current-state.md` — record the active route contracts, implementation paths, local results, VM catalog version and any provider-evidence limitation.
- `docs/verification/n8n-conversation-workflow-2026-11-11.json` — store redacted local/VM acceptance results only; no API key, raw PII, raw PDF, unrestricted transcript or provider credential.

## Execution tasks

### Task 1 — Catalog RED/GREEN

1. Add failing catalog tests for `quotation.generate`, its requirement dependencies, active `sales.quote.generate` binding, and both active remote route identities.
2. Run only the affected catalog tests and confirm they fail for the missing rows.
3. Update both V2 fixtures and the reviewed source rows.
4. Add the minimum runtime route metadata needed by the event bridge and make the tests pass.
5. Run the complete catalog/conversation contract test subset.

Expected result: the catalog validates, both workflow routes are reachable only from enabled tools, and legacy/local bindings remain unchanged.

### Task 2 — Remote transport RED/GREEN

1. Add failing adapter tests for the exact supplied Lead and quotation requests and all invalid response cases.
2. Implement the smallest typed remote adapter/normalizer; keep secrets in process environment and redact all failure text.
3. Run adapter tests and existing action/security tests.

Expected result: the adapter can distinguish accepted Lead, updated Lead, generated PDF, pending/failure and invalid provider responses without exposing secrets.

### Task 3 — Durable action dispatch RED/GREEN

1. Add failing event bridge tests showing remote route selection from the pinned catalog and correct contract-specific payload construction.
2. Implement remote dispatch in the event bridge while retaining internal n8n dispatch for local workflows.
3. Persist normalized action result/execution status and retain existing callback correlation, retry and reconciliation semantics.
4. Run event, store, action-gate and provider-evidence suites.

Expected result: duplicate outbox delivery cannot create a second remote write; transient errors retry; ambiguous results reconcile; no raw customer payload is placed in routing metadata.

### Task 4 — Conversation response RED/GREEN

1. Add failing turn tests for Lead submission, quotation proposal gating, confirmed package/account prerequisite, generated-PDF status, pending status and failed workflow status.
2. Update the turn controller and action-status tool to use catalog tool metadata and normalized action outcomes.
3. Add guard assertions for truthful wording and absence of internal workflow data.
4. Run the focused conversation suite, then the full API suite.

Expected result: the customer gets one natural response per turn; Lead/quote results are reported on a later status/continuation turn, and unrelated knowledge/document questions do not lose the active action or requirement.

### Task 5 — Local Docker acceptance

1. Run typecheck, lint, full unit tests, build and Compose/security verification.
2. Rebuild and start the local API/event-worker/event-relay stack.
3. Publish the updated catalog to the local synthetic tenant using the existing versioned publication path.
4. Run a synthetic conversation through goal confirmation → contact/consent → Lead confirmation → Lead result status → account reference/package confirmation → quote confirmation → quotation result status.
5. Run the supplied remote synthetic acceptance and the 15-use-case replay; record functional failures separately from duplicate/naturalness observations.

Expected result: local code and catalog use the same route contracts, both supplied remote endpoints return successful synthetic results, and the conversation reports them without false completion claims.

### Task 6 — VM catalog publication and validation

1. Before SSH, record the VM current branch/commit, active catalog version/ref, database migration ledger, running service health and the exact SSL/config file checksums/paths. Do not change SSL files.
2. Pull the reviewed branch/PR state on the VM using the existing deployment procedure; do not overwrite unrelated local VM changes.
3. Run only required forward migrations if the local test proves one is needed; catalog publication itself must use a new version and preserve the old published version for rollback.
4. Validate the catalog locally on the VM, publish it for the ANCFZ tenant, and verify the new version is published and pinned for new sessions.
5. Restart only the services required by the application deployment; preserve database, vector data, SSL and credentials.
6. Run VM health, catalog route, synthetic Lead/quote acceptance and the focused conversation replay. Use synthetic data only.
7. Capture the redacted VM evidence and rollback command/version without executing rollback unless validation fails.

Expected result: the VM uses the new catalog/workflow routes, existing sessions and historical catalog versions remain intact, both workflows are exercised, and any provider limitation is reported honestly.

## Required verification commands

```powershell
npm run test:unit --workspace services/api
npm run typecheck --workspace services/api
npm run lint --workspace services/api
npm run build
npm run verify:conversation-boundary
npm run verify:compose
npm run verify:secrets
docker compose build
docker compose up -d api event-worker event-relay
node scripts/acceptance-remote-n8n.mjs
node scripts/live-session-hardening.mjs
```

The VM commands will be selected from the existing deployment procedure after read-only SSH preflight; no new SSH credential or SSL mutation is introduced by this plan.

## Completion criteria

- Catalog, adapter, event bridge, action-gate, tool-status and response tests pass.
- Full API tests, typecheck, lint, build, Compose and secret checks pass.
- Local Docker synthetic journey proves both workflow results are reflected in the next guarded conversation turn.
- 15-case replay has no functional/API failures; remaining repetition findings are quantified.
- VM catalog publication is versioned, old data is preserved, SSL/configuration is untouched and VM synthetic acceptance is recorded.

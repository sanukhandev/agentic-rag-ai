# Current code state and migration gaps — 2026-10-30

**Current baseline:** `main` after merged PRs #79 and #78 (2026-10-30), containing the initial Python GPT gateway/Node adapter and retired Foundry-agent runtime files. This is **not** a tested seven-stage runtime; the original lead-first `app.ts` still controls the chat. This document records source inspection and target gaps, not live acceptance.

**2026-11-06 local V2 checkpoint:** non-status document requests in an unconfirmed ANCFZ conversation now open the guarded company-formation handoff instead of exposing document policy prematurely. The reply asks for explicit goal confirmation, then starts Lead contact collection; package and quote operations remain behind the existing CRM/account and provider-evidence gates. Local replay and API tests passed; external CRM completion remains unverified.

## Recovery checkpoint — 2026-11-04

On `fix/zara-conversation-engine-end-to-end-recovery`, the V2 public path now independently validates optional questions, claims and candidate intent plans; accepts trusted evidence from correlated read tools; evaluates mixed-polarity source clauses; preserves the V2 prompt cursor across public turns; recognizes reviewed natural formation aliases; accepts natural scoped confirmation phrasing; preserves verified business and masked contact facts through invalid non-knowledge citations; advances catalog contact requirements through consent; routes an explicit, purpose-consented Lead request through the existing Node action gate to an awaiting-confirmation proposal when the published binding is enabled; resolves canonical V2 outbox actions through catalog-declared n8n identity and durable claim correlation; contextualizes knowledge follow-ups; keeps synthetic tool provenance out of PostgreSQL source UUID lookups; preserves relevant short structured ingestion lines for deterministic grounded fallback; and stores package offerings against either legacy UUID or canonical V2 catalog identity without repinning. Focused/full local tests, local ingestion and tenant acceptance, public confirmation/fact/contact smoke, a rebuilt Docker API, and a 25-turn public persistence harness pass. The seven-stage journey, Salesforce sandbox, package/quotation data, browser E2E and three-run Azure acceptance remain unverified; this checkpoint does not replace the migration gaps below.

## Deployment migration checkpoint — 2026-11-10

VM deployment now starts PostgreSQL, runs the forward-only `scripts/migrate-vm.mjs`
runner, and only then rebuilds the Compose services. The runner records migration
checksums in `agentic_schema_migrations`, uses a PostgreSQL advisory lock, and
requires an explicit `DB_MIGRATION_BASELINE` when an existing VM schema cannot
be inferred. Current branch data changes are `072-intent-vocabulary-learning.sql`
and `073-schema-migrations.sql`; editable catalog content still goes through the
authenticated validate/draft/publish flow. The runner was exercised against the
local Docker PostgreSQL volume and a second run applied zero migrations. VM
execution remains pending until the database baseline is confirmed on that VM.

## Existing code topology — IMPLEMENTED

| Responsibility | Verified location | What exists |
| --- | --- | --- |
| Customer HTTP API | `services/api/src/app.ts`, `services/api/src/http/schemas.ts` | Session and message routes, message idempotency, per-turn catalog/RAG/response orchestration; unchanged public JSON response |
| Catalog | `services/api/src/intent-catalog.ts`, `intent-catalog-xlsx.ts` | Published XLSX catalog, weighted signals (phrases/keywords/exclusions), score/confidence/ambiguity, slot and journey rules; optional `BusinessStages` plus other catalog extensions |
| Continuity | `services/api/src/intent-journey.ts`, `journey-engine.ts`, `conversation-state.ts` | Active intent, opportunity identity, pending requirement, fact/confirmation state and transition handling |
| Selected model | `services/api/src/python-model/chat-model-adapter.ts`, `services/model-gateway/gateway/app.py` | New private Node→Python GPT adapter and Azure OpenAI Responses API-key gateway, initial structured planning and normalization (not yet live verified) |
| Model tools | `services/api/src/agent-tools.ts`, existing ActionGateway | Legacy Node read-only services and authorized outbox operations remain; Python↔Node catalog-v2 dynamic tool-call cycle is **not yet implemented** |
| Inference interface | `services/api/src/model.ts` | Existing `ChatModel` abstraction and deterministic fallback/normalization helpers |
| Retrieval | `services/api/src/knowledge.ts`, retrieval/search modules | Tenant/source-filtered PostgreSQL pgvector knowledge, citations and extractive fallback |
| Outbox/workflows | `services/api/src/actions.ts`, `events.ts`, `event-relay.ts`, `event-bus.ts`, `event-worker.ts` | Action proposals, transactional outbox, Redis Streams, worker→n8n, retries/reconciliation |
| Business lifecycle | `services/api/src/routes/lifecycle.ts` and lifecycle services | Package/quote/account/invoice/contract endpoints and guarded state; not all providers confirmed |
| Persistence | `services/api/src/store-postgres.ts`, `infra/postgres/001..059` | Durable tenant/session/journey/actions/business artifacts, V2 catalog identity and Foundry conversation bindings |
| One-journey QA | `tools/qa/ancfz-single-journey.mjs` | One synthetic session, idempotency and some continuity assertions; stops at real provider blocker |
| Admin and web | `apps/admin`, `apps/web` | Existing Angular Admin and Next.js web chat; not redesigned by this task |
| Python | `services/model-gateway/`, `tools/ingestion`, `tools/anc/pdf_service`, `tools/anc/payment_mock` | New FastAPI model gateway is added but unverified; ingestion/OCR/PDF/payment mock remain separate services |

## Deficiencies versus target

1. **Initial model boundary exists, but orchestration is incomplete:** private Python `/internal/v1/model/plan` and `/normalize` plus Node adapter are added, with an opt-in Compose overlay. The V2 path now projects enabled action bindings and routes an eligible explicit Lead request to Node's proposal gate, but the full published catalog and User Intent Document are not yet supplied to every planner path and provider execution remains separately configured and unverified.
2. **Intent-score semantics:** `intent-catalog.ts` derives `confidence = score / 100` from weighted keyword/phrase scores; this is a heuristic score, not a measured probability. The current engine has no **goal-first six-category taxonomy** and no **GPT-led adaptive conversation strategy** that weighs full conversation summary, requirements and competing business goals on every substantive turn. Model intent interpretations and signal evidence are not systematically fused/validated per turn. Cross-intent ambiguity needs explicit user selection.
3. **No dedicated User Intent Document:** current `conversation_state`, `intentProgress`, `journey_instances`, `journey_facts`, messages and audit are useful foundations but no independently versioned, reconstructible per-turn intent decision ledger exists with **primary Business Goal distinct from per-turn intent category**, LLM-generated structured conversation summary, candidate signal **and adaptive weight** evidence, confirmed goal, model provenance and cache invalidation guarantees.
4. **Normalization is conditional:** `app.ts` builds a deterministic query and gates model normalization on global/tenant flags for particular uncertain turns. Target: use a bounded AI normalization call when retrieval needs it, then cache and validate its facts, negation, tokens and source/tenant scope.
5. **Cost/latency:** app may perform separate model activities for composition/normalization. Need a per-turn budget, keyed memoization and reuse of structured results rather than redundant LLM requests.
6. **Action planning:** catalog `WorkflowBindings` and Node action path exist, but the current flow risks treating lead/CRM capture as the implicit primary goal. Named Foundry read-only function tools are separate from n8n writes. The new design must treat **CRM Lead capture as a conditional Service Execution capability**, not universal intent completion. Need a tenant-neutral catalog `ToolBindings`/action specification and server-side interpretation → user intent confirmation → prerequisite/consent → transactional outbox.
7. **One-question continuity:** pending requirements and source-grounded responses exist, but there is no unified invariant to guarantee one relevant follow-up after every successful grounded active-journey answer, especially through knowledge interruptions and stage handoff.
8. **Provider blocker:** latest documented v6 13-turn run created an eligible ActionRequest and dispatched local lead, then set `reconcile_required` without a verified Salesforce remote Lead. Qualification/Account/Package/Documents/Invoice/Contract were not completed in that run.
9. **Python retry/rate limits:** initial FastAPI/SDK client now exists and configures SDK `max_retries=3`, but Azure live retry, 429 throttling, shared turn deadlines and circuit breaker have **not** been acceptance-tested.
10. **Privacy deferral conflict:** existing Node masking/token vault and scope restrictions are implemented. Advanced PII-filter changes can be deferred, but directly disabling these guards would require a separate privacy/security decision; not part of a documentation-only migration.

## Current dangerous assumptions to avoid

- Foundry *Agent* project endpoint and version (v4/v6) are **not** a GPT model deployment endpoint/key.
- `score / 100` is **not** calibrated intent confidence; report `evidenceScore`, `confidenceBand` and calibrated/verified confidence separately.
- A confirmed chat intent is not consent to create a Lead, Account, send documents, charge or sign.
- A successful n8n execution is not a remote Salesforce record or paid invoice.
- A Redis cache or LLM conversation ID is not an authoritative session/intent document.
- Stored raw customer contact values are not required for intent normalization/RAG.
- No ANCFZ-specific keys, addresses, packages, field names, stages or thresholds should be hardcoded into reusable shared services. The seven-stage order belongs to the **ANCFZ published business catalog**, not a generic Node switch.

## Critical path to completed acceptance

**Step 0:** establish a controlled baseline and verify current code/tests; preserve old Foundry path behind reversible feature flag.

**Step 1:** build Python GPT model gateway and Node adapter with correct endpoint/key, strict contract, budget and 3 retries.

**Step 2:** implement six-category taxonomy, GPT **primary conversation planner** with bounded adaptive weights/summary/next-move decisions, plus durable User Intent Document + per-turn classification/cache and **Business Goal** confirmation distinct from CRM consent.

**Step 3:** integrate query normalization, RAG grounding and exactly one pending follow-up into Node response composition.

**Step 4:** route catalog ToolBindings through existing ActionRequest/outbox/n8n (not Python direct writes).

**Step 5:** fix provider acknowledgment/configuration for Salesforce Lead, then verify stages 1→7 in **one** session; no 25/200 turn benchmark.

## Prior evidence (historical)

- v4 tool-free Foundry Agent serving and v6 candidate application function loop were independently tested.
- Focused 13-message v6 run: 22 passing assertions, one real `get_journey_state` call, local Lead action, missing verified Salesforce acknowledgment; stopped at `lead_generation`.
- Root tests reported 294 passed / 12 skipped in that earlier milestone. These are **past reports**, not fresh verification after this documentation rewrite.
- Trace details: `verification/ancfz-single-journey-tool-calling.md` and `verification/ancfz-stage-verification-matrix.md`.

**Update rules:** for each phase, mark components `IMPLEMENTED`, `TESTED`, `BLOCKED` or `TARGET`; include paths, migration and exact evidence. Never promote a component from TARGET based on prose or simulated output.

## Reported remote workflow inventory (unverified)

Four n8n webhook-test paths have been supplied for Salesforce Lead creation, account OTP send/verify and Salesforce document upload. This is **configuration evidence only**: no calls were executed, no actual n8n workflow IDs/response contracts were fetched, and no Salesforce record was verified from them. Lead and upload request samples omit auth headers; a pasted account-verification API key must be rotated. Account OTP verification does not create a Salesforce Account. Full safe integration requirements: [`remote-n8n-integration.md`](remote-n8n-integration.md). This inventory does **not** resolve the latest `reconcile_required` Lead blocker.

## Rewrite branch — explicit removal boundary

Retired from the rewrite branch: eight Foundry-only SDK/tool source and test files, the Azure CLI Docker build target, and the local Foundry overlay configuration. Preserved: all PostgreSQL migrations (including the historical Foundry conversation bindings), public Chat/Admin API, Redis/outbox/n8n, auth, privacy, catalog, lifecycle, Next.js, Angular, local data and dated verification.

New initial code: `services/model-gateway/` (API-key Azure GPT model, typed plan/normalize, at most three SDK transient retries, private HTTP authentication) and `services/api/src/python-model/chat-model-adapter.ts` (compatibility adapter, not a full User Intent Document engine). Deployment is opt-in through `docker-compose.python-gpt.yml`. **No live Azure model call, runtime build, provider workflow or seven-stage acceptance was executed in this GitHub editing session.**

Next: implement a modular Node ConversationCoordinator, catalog-v2 stage-scoped requirements, durable User Intent Document/CAS, and model-proposed read-only tools plus separately confirmed async provider actions; then replace the monolithic chat orchestration. See [rewrite safety manifest](rewrite-safety-manifest.md).

## New planning contract — persona-first customer responses (not implemented)

The **target** requires a session-pinned published tenant persona **before** Python planning, a bounded Python-to-Node **read-only tool loop** (RAG, catalog, persona, journey, requirements, packages, action status), a **Python Persona Response Composer as the final generative step**, and a **Node Response Guard for all customer-visible replies**, including errors, queue states, consent and handoff. An approved tenant-persona offline fallback is required when the model is unavailable. This is a **documentation-only design addition**: the current FastAPI gateway/Node adapter and legacy `app.ts` do not implement the full persona finalizer or tool protocol. See [persona-response-contract.md](persona-response-contract.md) and [agent-tool-loop.md](agent-tool-loop.md).

## Consolidated Conversation Engine v2 blueprint — documentation only

The authoritative proposed design now has **seven logical components**: Python Conversation Agent; Planning & Intent Engine; Natural Persona Composer; Node Response Guard; Node/PostgreSQL Session & Conversation Manager; Node Trusted Tool Gateway; and Node/PostgreSQL/Redis/n8n Workflow & Event Engine. These are not seven autonomous GPT agents. The target includes catalog v2 parser/publisher, per-turn User Intent Document, authorized RAG/requirements/status Node tools called **before** persona composition, guard-validated customer replies and separately authorized provider actions. **No new runtime implementation or seven-stage verification is claimed** by this design update. Read [architecture](conversation-engine-architecture.md), [contracts](conversation-engine-contracts.md), [P0–P7 delivery plan](conversation-engine-delivery-plan.md) and [evaluation matrix](conversation-engine-evaluation.md). Current blockers remain a lead provider acknowledgment and unverified/missing Account creation, quotation, invoice and contract integrations.

## 2026-11-04 recovery checkpoint

The GPT-first path now preserves pending company-formation confirmation across advisory/requirement interruptions, retains quote-validated visa/timeline facts, and handles timeline correction plus recap through bounded Node acknowledgements. This is verified by 61 API test files / 501 tests and a live public Azure-backed 25-turn run (25/25 transport, 25 durable messages, objective score 0.90/1.00). Remaining gaps are generic fallbacks on some non-action turns, formal human Azure scoring, browser E2E, Salesforce/provider readback and the full seven-stage journey; status remains `NOT_READY`.

## 2026-11-04 recovery checkpoint — pending non-action recovery

The pending formation-confirmation path now also handles unfixed budget preferences and privacy refusals after PII masking, while preserving the pending goal and withholding action authorization. Verification: 61 API test files / 507 tests, typecheck/lint/Docker API build PASS, and a fresh public 25-turn Azure-backed run with 25/25 transport, 25 durable messages and automated objective score 1.00/1.00. This is not the mandatory human-quality gate. Salesforce/provider readback, browser E2E, quotation lifecycle, complete seven-stage journey and three independent >=90% Azure quality runs remain unverified; status remains `NOT_READY`.

## 2026-11-04 recovery checkpoint — explicit initiation and action-gate recovery

- Latest API suite: **PASS** — 61 files / 515 tests; typecheck and lint pass.
- Natural initiation phrases now produce a durable formation confirmation prompt even when GPT labels the supporting turn as navigation.
- Public replay now masks the bounded synthetic name phrase, preserves consent, hides internal requirement keys, and reports the disabled Salesforce provider truthfully without creating an action request.
- Docker API rebuild and public Nginx/API action-gate replay: **PASS** for this boundary.
- Overall status remains **NOT_READY**: Salesforce sandbox/readback, SF-02, browser E2E, quotation lifecycle, full seven-stage journey and three independently human-scored Azure >=90% runs remain unverified or blocked.

## 2026-11-04 verification status — exact remaining blockers

- `npm run verify:local` now passes lint, all workspace typechecks, compose/security checks, all workspace tests (Admin 70/70, Web 15/15, API 61 files / 512 tests, chat-utils/contracts 12/12), production builds, production dependency audit, synthetic tenant isolation, five-source ingestion acceptance, and 35 Python ingestion tests.
- The production dependency issue was corrected by aligning Angular runtime/compiler packages to 21.2.26, Angular CLI/build packages to 21.2.29, and Vitest to 4.1.12; the production audit now reports **0 vulnerabilities** and `npm ls` is coherent. A full developer-inclusive audit still reports 32 dev-tool findings (3 high, 28 moderate, 1 low), so those remain a non-production maintenance item. Vitest 4 initially discovered generated `dist` tests; the API test script now scopes discovery to `src`, and the source suite passes 512/512.
- Browser E2E remains **NOT_RUN**. The native Chrome windows were visible, but the CUA browser host reported `Browsers: Error: The browser access host is unavailable`; native-window activation also failed before a customer-chat interaction could be executed.
- Postman contract status remains **UNVERIFIED** because the installed CLI exits before reporting status with `Cannot find module '@postman/dataset-engine-sdk'`.
- The public API boundary is verified through Lead consent and correctly stops: the published ANCFZ `lead.create` binding is disabled, no Salesforce sandbox credentials/readback path is configured, and the latest confirmation persisted zero `action_requests`. Enabling the binding or using the local mock as Salesforce evidence would be an authorization and evidence violation.
- Therefore the exact completion status remains **NOT_READY**. The remaining work is provider configuration/readback for stages 1–7, a real customer-facing browser run, and three frozen human-scored Azure quality runs at >=90% each; the original five-turn conversation regressions and production dependency gate are no longer active blockers.

## 2026-11-05 deployment checkpoint

- Docker rebuilt `api`, `admin`, and `web` from the refreshed lockfile; the API, web, admin, Nginx, Postgres, Redis, and model-gateway services are healthy, and `/api/v1/health/live` returned `{"status":"ok"}`.
- Fresh public Nginx → API → Azure-backed model-gateway regression: `artifacts/ancfz/api-25-turns-post-dependency-scored.json` records 25/25 HTTP answers, 25 durable user messages, automated objective score **1.00 (10/10)**, no action proposal, no internal payload leak, and no false provider-completion claim. Human persona quality remains `NOT_RUN` and external provider completion remains `NOT_VERIFIED_BY_THIS_HARNESS`.
- Runtime trace confirms deterministic Account, package, payment, and contract provider classes are currently unit-tested adapters only; the application wires the V2 Lead evidence route and document mock, while the generated lifecycle n8n workflows still mark the remaining lifecycle Node endpoints as inactive/new contracts. This is the concrete implementation gap behind the unverified seven-stage journey.
- The legacy `/api/v1/internal/crm/accounts/:id/remote` callback is now blocked for V2 actions with `V2_PROVIDER_EVIDENCE_REQUIRED`; regression coverage proves it cannot mark a V2 Account verified without correlated provider evidence. This closes a false-completion bypass but does not implement the missing OTP plus Account/Contact/Opportunity provider adapter.

## 2026-11-05 Account provider boundary checkpoint

- Added protected development-only V2 Account OTP challenge/verification and `/api/v2/internal/provider-evidence/account`. A synthetic qualified verified Lead now reaches deterministic Account creation, stores opaque Account/Contact/Opportunity IDs, completes the correlated action, advances the User Intent Document from `account_creation` to `package_selection`, and accepts a replay without a duplicate operation.
- Trusted V2 provider completion now advances both the session lifecycle projection and the pinned User Intent Document; transport callbacks without trusted evidence remain `reconcile_required`.
- This proves only the deterministic development provider path. Salesforce Account/Contact/Opportunity creation and independent sandbox readback remain unavailable; the OTP service is in-memory and therefore not restart-durable until a real provider challenge store/adapter is configured.
- The public development package route now has an integration regression for approved offering → quote → selection confirmation; the pinned journey advances from `package_selection` to `document_upload` rather than leaving the User Intent Document stale. Quote values remain development catalog data, not official ANCFZ pricing.

## 2026-11-05 document/SF-02 development checkpoint

- Public document routes now resolve a pinned V2 catalog by either row UUID or canonical version reference; package scope and stored document identity use the canonical V2 reference.
- The V2 document configuration is exposed to the customer route, and the synthetic path passes upload → worker claim → OCR/review result → deterministic SF-02 attachment readback → lifecycle advance to `payment_invoice`.
- API suite: **61 files / 516 tests PASS**; API typecheck and lint PASS. This is deterministic development evidence only. Salesforce sandbox SF-02 readback, payment, contract, browser E2E and formal Azure scoring remain unverified.

## 2026-11-05 payment/contract development checkpoint

- Added catalog-gated public V2 invoice, payment and contract proposals. V2 sessions no longer fall back to legacy workflow identities when an active binding is missing.
- Added correlated internal provider-evidence routes for deterministic invoice issuance, payment settlement and contract signing. Invoice issuance remains within `payment_invoice`; only trusted payment completion advances the journey to `contract`.
- The focused document → invoice → payment → contract regression passes with deterministic development providers; API typecheck and the full 61-file / 516-test suite pass.
- This is **DEVELOPMENT MOCK ONLY**. Live Salesforce Lead/Account/SF-02, payment settlement, signature provider readback, browser E2E and formal Azure quality remain unverified; overall status remains `NOT_READY`.

## 2026-11-05 durable Account OTP checkpoint

- Added additive migration `infra/postgres/064-v2-otp-challenges.sql` and store-backed OTP challenge persistence for both MemoryStore and PostgresStore.
- The service-instance restart regression passes, the real PostgresStore persistence/update round-trip passes with synthetic data, and the rebuilt API remains healthy through Nginx.
- Full local verification passes: workspace lint/typechecks, 61 API files / 517 tests, builds, security checks, dependency audit, synthetic tenant/source acceptance and 35 Python ingestion tests.
- This removes the local restart-loss defect, but does not establish live Salesforce OTP delivery/verification or sandbox Account readback; overall status remains `NOT_READY`.

## 2026-11-05 service restart/replay checkpoint

- Public synthetic session sent one message, then `api`, `model-gateway`, and `event-worker` were restarted together.
- Replaying the same `clientMessageId` returned the identical assistant message ID and answer; PostgreSQL retained exactly one user row and one assistant row for the session.
- This proves API/model/worker restart and message-idempotency continuity for the tested turn. Full Redis/outbox/provider replay remains unverified.

## 2026-11-05 contact recovery checkpoint

- Fixed the remaining live objective failure where masked email/phone submitted before explicit goal confirmation fell through to the generic unsupported-claim fallback.
- Node now responds with privacy-safe confirmation guidance, keeps the pending goal decision, and does not persist/use contact slots until the goal and contact workflow are authorized.
- API verification: **61 files / 519 tests PASS**; Docker API rebuild and health check PASS.
- Three fresh public Azure-backed 25-turn runs each passed **25/25 HTTP**, **25 durable user messages**, and **10/10 objective checks**. Human persona scoring, Salesforce/provider readback and the full seven-stage journey remain unverified; overall status remains `NOT_READY`.

## 2026-11-05 semantic recovery and embedding reliability checkpoint

- Fixed three reproduced live response defects in the pending formation-confirmation path: timeline statements are acknowledged, adviser preference is acknowledged without internal journey text, and pre-confirmation status reports no submitted Lead/CRM action.
- Added regression coverage for grounded-but-semantically-unrelated excerpts and Azure embedding 503 recovery.
- Azure embedding retries now cover bounded transient 408/409/429/5xx responses and transient fetch failures.
- Verification: API 61 files / 523 tests PASS; typecheck, lint, build and Docker API rebuild/health PASS; three post-retry public Azure-backed 25-turn runs PASS with 25/25 answers, 25 durable messages and 10/10 deterministic objective checks each.
- Two pre-retry captures are retained as failed evidence for `V2_KNOWLEDGE_RETRIEVAL_UNAVAILABLE`; formal human Azure scoring, Salesforce/provider readback, browser E2E, official pricing and complete seven-stage completion remain unverified. Overall status: `NOT_READY`.

## 2026-11-05 Salesforce endpoint audit

- The development environment does configure `REMOTE_CRM_PROVIDER=salesforce` and a sandbox Lead endpoint.
- A credential-free `HEAD` probe returned HTTP 401 without sending customer data. No Salesforce OAuth/access-token material is present in the API or n8n runtime, and the n8n SQLite inventory contains no credentials for the inactive ANCFZ workflows.
- The V2 Node path now has a fail-closed Salesforce Lead readback adapter (`services/api/src/salesforce-sandbox-lead-provider.ts`) and the Lead template is endpoint-configurable, but the published Lead bindings remain disabled. The exact live blocker is authenticated provider access, a configured n8n managed credential/readback endpoint, and a reviewed sandbox run—not endpoint discovery.
- Status remains `BLOCKED_EXTERNAL_DEPENDENCY`; no Lead creation or provider completion is claimed.

## 2026-11-05 Salesforce readback adapter checkpoint

- Added `SalesforceSandboxLeadProvider`, which requires an explicit bearer token and `{leadId}` readback URL, retries bounded transient readback failures, verifies the returned provider record and optional correlation fields, and returns only a trusted `provider_record_verified` attestation.
- The V2 evidence route now uses that adapter for `salesforce_sandbox`; missing configuration, authentication failure, record mismatch or readback failure transitions the action to `reconcile_required` without claiming completion.
- The inert ANCFZ Lead workflow now reads create/readback endpoints from `REMOTE_CRM_LEAD_URL` and `REMOTE_CRM_LEAD_READ_URL`; Docker Compose passes the readback configuration to API and n8n without embedding credentials.
- Verification: **528 API tests PASS**, typecheck/lint/build PASS, `npm run verify:local` PASS, n8n template tests PASS, Docker rebuild and public health `200` PASS.
- Live status remains `BLOCKED_EXTERNAL_DEPENDENCY`: no sandbox access token, n8n managed OAuth credential, readback URL, or live provider evidence is available; no Lead write is claimed.

## 2026-11-05 Salesforce relationship readback checkpoint

- Extended the fail-closed adapter with isolated Account relationship and SF-02 attachment readback checks. They require the provider record ID, tenant/session/idempotency correlation, and the expected Account/Contact/Opportunity plus Lead/Account attachment relationships before producing `provider_record_verified` evidence.
- Verification: **530 API tests PASS**, API typecheck/build PASS, and the new mismatch regression rejects an attachment linked to the wrong Account.
- These checks are not wired as live completion paths yet: the Account route still requires a configured provider-specific adapter plus external OTP challenge/readback, and the document worker still executes only the deterministic SF-02 provider. Live Salesforce status remains `BLOCKED_EXTERNAL_DEPENDENCY`.

## 2026-11-05 live Salesforce Lead smoke checkpoint

- The supplied development Salesforce Connected App is now stored as the encrypted project-scoped n8n credential `SalesForce ANC - CREDS`; no plaintext secret was added to the repository.
- n8n OAuth execution reached the Salesforce Apex endpoint and received the expected `405 Method Not Allowed` response to a read probe, proving the n8n credential is authenticated.
- A one-time synthetic Lead POST through n8n using the reference `Name` / `Company` / `Phone` / `Email` / `Description` body returned a Salesforce Lead ID. Standard Salesforce REST API v68.0 readback returned the same ID and matching fields.
- The temporary smoke workflow and payload were removed. The ANCFZ V2 workflows and catalog bindings remain inactive; the Node-authorized public journey still needs configured Lead readback, duplicate/replay coverage, Lead update, Account/Contact/Opportunity, SF-02 and later provider contracts before live activation.
- This changes the Salesforce status from “no credential / no live Lead evidence” to **partial direct Lead integration evidence**, but overall acceptance remains `NOT_READY`.

## 2026-11-05 Salesforce Account adapter checkpoint

- The V2 Account evidence route now accepts a configured Salesforce adapter. It independently verifies the Node OTP, Account/Contact/Opportunity relationship readback, lead association, idempotency correlation and provider evidence tier before persisting remote IDs and advancing the stage. Missing configuration or any mismatch still transitions the Account and action to `reconcile_required`.
- The inactive Account n8n template now targets `/api/v2/internal/provider-evidence/account` and reads `REMOTE_CRM_ACCOUNT_URL` / `REMOTE_CRM_ACCOUNT_READ_URL`; no credentials are committed and the workflow remains disabled.
- Verification: **531 API tests PASS**, API typecheck/build PASS, n8n template tests PASS, and `docker compose config --quiet` PASS. The live Account provider, external OTP delivery, SF-02, payment and contract providers remain unverified.

## 2026-11-05 Salesforce credential inventory checkpoint

- Rechecked the active `.env`: it contains the Salesforce provider flag and Lead Apex REST URL, but no access token, OAuth client/refresh secret, Account URL, or SF-02 URL. No credential values were exposed or written to Git.
- The mounted n8n SQLite database contains **zero** `credentials_entity` rows and all 10 ANCFZ V2 workflows are inactive. A credential-free `HEAD` request to the configured sandbox Lead endpoint returned **HTTP 401**, without sending customer data.
- A managed n8n Salesforce credential cannot be created or connection-tested until the approved sandbox credential material and the Account/SF-02 provider contracts are supplied. Live Salesforce acceptance remains `BLOCKED_EXTERNAL_DEPENDENCY`; no provider completion is claimed.

## 2026-11-05 Node Salesforce OAuth/readback checkpoint

- `SalesforceSandboxLeadProvider` now supports bounded client-credentials token retrieval and short-lived in-process token caching, while preserving the static bearer-token path.
- Local `.env` supplies the development-only Salesforce token URL/client credentials and standard REST Lead readback template; real values are not present in `.env.example`, Git, logs or reports.
- The rebuilt API container independently obtained a token and returned `provider_record_verified` for the sandbox Lead created through n8n.
- Verification: API **62 files / 532 tests PASS**, full `npm run verify:local` PASS, Docker API health PASS, and real Node-to-Salesforce readback PASS.
- This proves the Lead readback adapter can authenticate and verify a real sandbox record. It does not activate the ANCFZ V2 binding or prove the full action-gated create/dedupe/update journey.

## 2026-11-06 human-centered TTS response checkpoint

- Updated `services/model-gateway/gateway/persona_composer.py` to instruct normal tenant-persona replies to use short spoken-language sentences, brief context acknowledgement, a plain-language explanation, and at most one final follow-up question.
- Updated `services/api/src/v2-coordinator.ts`, `services/api/src/v2-evidence.ts`, and `services/api/src/model.ts` so deterministic and source-recovery replies use tenant-neutral explanatory framing, preserve approved evidence verbatim and retain synchronized question metadata. Package recovery now asks which package the customer wants to explore; generic evidence recovery asks whether the customer wants the information applied to their setup.
- No package workflow, CRM, document, quote, payment, contract, database schema, credential, or persona identity behavior changed.
- Verification: API **62 files / 545 tests PASS**, API typecheck PASS, API build PASS, changed-file ESLint PASS, and model-gateway **39 tests PASS** with `PYTHONPATH=services/model-gateway`.
- Repo-wide API lint remains **BLOCKED_BY_BASELINE** by four pre-existing `@typescript-eslint/no-explicit-any` errors in `services/api/src/runtime-security.test.ts`; none are in the changed files. Full seven-stage journey, live provider completion, and human TTS listening quality remain unverified.

## 2026-11-06 Zara response regression fix

- Removed the technical source-verification wording from deterministic customer replies. Source recovery now uses natural employee-style phrasing such as `Of course.` while retaining the exact approved evidence and guard validation.
- First-contact fallback now recognizes a customer addressing the configured assistant and introducing themselves, such as `hello Zara, I’m Meow Ching`, and returns the pinned persona greeting instead of the generic work-through response.
- Regression coverage: API **62 files / 546 tests PASS**, typecheck PASS, and changed-file ESLint PASS. The follow-up Docker rebuild is recorded below.

## 2026-11-06 confirmation and package recovery checkpoint

- Scoped formation confirmation now accepts the observed `ys` and `yes, let us get started with company formation` replies without consuming the pending goal prompt incorrectly.
- Package questions now prefetch the pinned, approved, effective V2 package evidence before model composition, so package options remain available even when the model skips the optional package tool or its prose repair is rejected.
- Verification: API **62 files / 560 tests PASS**, API typecheck/build PASS, changed-file ESLint PASS, Docker `api` and `web` rebuild PASS, and `/api/v1/health/ready` returned `ready` with PostgreSQL and Redis available.
- The reported session still has action `916e1d64-430f-43e1-be05-7f66e1c25b35` in `reconcile_required` and no `crm_leads` row because n8n returns `POST ancfz/v2/lead-create` as an unknown webhook. The inactive ANCFZ workflow must be reviewed/configured before the Admin CRM row can be created; no Lead is claimed.

## 2026-11-06 Lead button confirmation checkpoint

- V2 now creates the existing server-backed `awaiting_confirmation` Lead action when contact consent is complete and returns the existing confirmation-card payload. A subsequent knowledge or package turn reuses the pending action and does not create duplicates.
- No new endpoint, UI component, direct CRM write, or n8n activation was added. The existing confirmation endpoint remains the authorization path; explicit typed confirmation remains only as a compatibility fallback.
- Verification: API **62 files / 561 tests PASS**, API typecheck/build PASS, changed-file ESLint PASS, Docker `api` and `web` rebuild PASS, and `/api/v1/health/ready` returned `ready` with PostgreSQL and Redis available.
- The configured n8n webhook `ancfz/v2/lead-create` remains unregistered, so a clicked button may still transition to `reconcile_required` until the reviewed workflow is configured. No Admin CRM Lead is claimed from this change.

## 2026-11-06 Lead → package → development quote checkpoint

- Published ANCFZ Catalog V2 revision 6 (`anc:r6:f6975dba48310da07648cb16e57c8a6b2e77d135c6e7199e1a46212f20fbeea6`) enables the approved `package.confirm` binding and keeps the three synthetic package offerings pinned to that revision.
- After a verified CRM Lead and granted contact consent, the chat now renders approved package cards. Selecting a card creates an idempotent package selection and dispatches the reviewed `ancfzV2PackageQuoteR1` n8n workflow.
- The development-only quote boundary rechecks tenant/session/action/Lead/package scope, renders a MOCK PDF through the private ANCFZ PDF service, hashes the downloaded bytes, stores the PDF privately, and exposes it only through the authenticated chat-session download route. This is not official ANCFZ pricing or provider completion.
- Local n8n was backed up at `data/n8n/database.sqlite.before-package-cleanup-20261106` and reduced to the existing Lead template plus the active package quote/PDF workflow. Unused inactive ANCFZ stage/notification workflows were removed from the local registry; source templates remain in Git.
- Verification: full workspace tests **PASS** (admin 71, web 15, API 564, chat-utils 6, contracts 6), typecheck **PASS**, ANCFZ n8n template tests **PASS**, PDF renderer tests **PASS**, Docker builds for API/web/PDF **PASS**, API readiness **200**, PDF render/download integrity **PASS**, and the n8n package webhook returned **200** and started an execution.
- Remaining limits: the Lead workflow remains inactive/configuration-dependent, quote generation is local development-only, and the full Salesforce Lead-to-Admin journey plus browser TTS quality are not re-accepted by this checkpoint.

## 2026-11-06 package selection gate correction

- Package questions still show the approved catalog options, but the response now marks them read-only until both contact consent and a verified remote CRM Lead exist. The assistant wording no longer asks the customer to choose a quote package before that gate.
- After verification, the existing package buttons become actionable; the API-side `LEAD_NOT_VERIFIED` guard remains in place for direct or stale requests.
- Verification: API **564 tests PASS**, API/web typechecks PASS, API/web Docker rebuild PASS, and API readiness returned `ready`.

## 2026-11-08 quote workflow gate and synthetic API verification

- The pinned V2 legacy `POST /api/v1/chat/sessions/:id/packages/quotes` route now fails closed with `QUOTE_WORKFLOW_REQUIRED` unless it is only re-reading a quote already attached to a confirmed package selection. Sessions without a V2 catalog pin retain the legacy compatibility behavior.
- Added a synthetic API exercise covering approved package action → internal development quote executor → verified PDF bytes → authorized download, plus replay after completion. The quote was marked `mock`/development-only; no provider-backed quote or official ANCFZ pricing was claimed.
- Verification: API **62 files / 566 tests PASS**, API typecheck/build PASS, changed-file ESLint PASS, and the synthetic quote API test PASS.
- Docker Compose rebuild/start completed for the local stack; API readiness returned HTTP 200 with PostgreSQL and Redis available. No external provider or production credential was used.

## 2026-11-08 live API conversation review

- `scripts/live-quote-conversation.mjs` exercised a synthetic customer conversation through the live API, including greetings, setup clarification, company-formation confirmation, contact collection, explicit V2 consent postback, Lead confirmation, reconciliation follow-up, package lookup, and both supplied document upload attempts.
- The customer-visible flow remained coherent and the Lead confirmation was correctly proposed. The action ended at `reconcile_required` because the published `crm.lead.create` binding uses `salesforce_sandbox` and the local API has no configured Salesforce provider adapter for this execution. The API returned the persona-safe follow-up: `I’ll keep the conversation open while this is reviewed. What would you like to go over next?`
- The supplied Emirates ID and passport images were sent only to the local API harness; both uploads were rejected before storage with `DOCUMENT_REQUIREMENT_NOT_ACTIVE` because document intake is disabled for the pinned catalog. Raw image bytes and PII are not present in the export.
- Live API result: **quote not generated/downloadable** because verified Lead completion is the prerequisite gate. The separate synthetic API integration test still proves the local development quote executor and authorized PDF download path (mock-only, not provider-backed pricing).
- Redacted human-review export: `docs/verification/quote-conversation-review-2026-11-08.json`.

## 2026-11-08 Salesforce readiness gate correction

- Root cause confirmed: Salesforce readback configuration is present in the local API environment, but the registered ANCFZ V2 Lead workflow `ancfzV2LeadCreateR1` is inactive in n8n. The live `POST /webhook/ancfz/v2/lead-create` therefore returns 404 and cannot be treated as a usable Lead path.
- Added a Node-owned `leadProviderReady` gate. The API now requires both configured Salesforce Lead readback credentials and `V2_LEAD_WORKFLOW_READY=true` before it can create or advertise a Lead action. The deployment default is `false`; this does not expose provider secrets to Python or the customer.
- When the gate is false, consent is recorded but no Lead action or confirmation card is created. Provider evidence validation remains the authoritative completion path once the reviewed n8n workflow, credentials and callback are enabled.
- Verification: focused API tests **62 files / 567 tests PASS**, API typecheck/build and changed-file ESLint PASS, Docker API/event services rebuilt, API readiness returned HTTP 200, and the live conversation export recorded `providerGate: v2_lead_workflow_not_ready`, no Lead action, and no quote generation/download.
- The separate synthetic development quote executor remains verified through the existing mock PDF integration test; this live Salesforce run correctly stops before package selection because the Lead prerequisite is not verified.

## 2026-11-08 local Salesforce sandbox acceptance rerun

- Local n8n was configured with the existing Salesforce OAuth2 credential and internal Node header credential, the credential-bound `ancfzV2LeadCreateR1` workflow was published/activated, and the local API gate was enabled with `V2_LEAD_WORKFLOW_READY=true`. The repository template remains inactive by default.
- The real synthetic Docker conversation completed the Salesforce-backed Lead action with state `completed`; the redacted export records nine polling attempts and no reconciliation follow-up. No production tenant or real customer data was used.
- Package selection returned HTTP 202. The development quote executor returned HTTP 200 with `verified: true`, `mock: true`; the authenticated PDF download returned HTTP 200, 2,522 bytes, and SHA-256 `c9c11baffdbdd3e22ed1977eabf6c50b4746d9fc85f0bf62c42ffaea1047530c`, matching the stored artifact.
- Redacted human-review export: `docs/verification/quote-conversation-review-2026-11-08.json`. Downloaded development artifact: `artifacts/ancfz-sandbox-2026-11-08/ancfz-development-quote-live-review.pdf`.
- The Emirates ID and passport uploads were attempted after the quote but remain blocked with `DOCUMENT_REQUIREMENT_NOT_ACTIVE`; the pinned catalog has document intake disabled. The quote is development/mock evidence, not official ANCFZ pricing or Salesforce quote completion.

## 2026-11-09 Salesforce runtime readiness hardening

- Added a secret-safe n8n readiness verifier for the exact Lead workflow ID, webhook path, payload contract, active state, and required create/readback/OAuth/internal-secret presence flags. It reports readiness codes without printing endpoint values, credential IDs, tokens, or customer payloads.
- Docker Compose keeps the Salesforce Lead gate disabled by default; local activation remains an explicit dev-only operation. Internal event-worker traffic uses `http://n8n:5678`; `/n8n/` is the public proxy path.
- The existing local n8n Salesforce credential and sandbox wiring were not rotated: the previous synthetic Docker run already proved create, readback, Node evidence verification, and correlated completion. Credential replacement would be unnecessary risk unless a fresh readiness or sandbox run fails.
- Added `npm run activate:n8n:dev`, an explicit local-only allowlisted publisher for the Lead, development quote, and OCR workflows. It must be followed by readiness verification; no production activation or credential creation is implied.
- Added the correlated Lead failure callback and Node endpoint. The repository template and API path are covered by tests, while local n8n was restored to the previously verified published database after a direct SQLite revision sync did not preserve n8n's publication metadata. The restore keeps the working Salesforce OAuth/internal-header runtime intact; a safe n8n-native import/publish is still required before treating the new callback as deployed runtime behavior.

## 2026-11-09 Salesforce Lead workflow acceptance rerun

- Fresh local Docker restart, explicit dev activation, readiness verification, mock webhook probe, and the complete synthetic conversation passed. The existing n8n Salesforce credential created and read back a sandbox Lead; the action reached `completed` with `provider_record_verified` evidence.
- The development quote was verified and downloaded as a PDF (HTTP 200). Both supplied synthetic document images were accepted, OCR processing completed, and Salesforce attachment readback audit events were recorded for both files.
- Redacted evidence: [`salesforce-lead-workflow-acceptance-2026-11-09.json`](verification/salesforce-lead-workflow-acceptance-2026-11-09.json). No credential values, document bytes, or customer PII are included. Quote evidence remains mock/development-only.

## 2026-11-09 CRM AI summary fix

- OCR callback handling now persists newly-created session privacy tokens before the document summary is composed or synchronized. CRM and Salesforce document summaries contain document type/status metadata only; identity-document OCR text and filenames are not sent in summary text.
- Admin CRM summarization now has an explicit private Python model-gateway dependency at `/internal/v1/model/summarize`, authenticated with the existing service key and bounded to masked CRM context. V2 customer conversation planning remains unchanged and does not share this route as a fallback.
- Admin summarization rebuilds its model input from the current masked conversation and metadata-only supporting-document state instead of trusting legacy persisted OCR summaries, allowing historical leads with stale token placeholders to be summarized safely.
- Missing model configuration, model failures, unknown privacy tokens, and unsafe model output now return typed summary errors instead of an unhandled `INTERNAL_ERROR`.
- Follow-up hardening keeps OCR exports out of the model, persisted CRM summary, and Salesforce payloads while appending completed-document OCR details only to the authenticated Admin CRM response and document panel. User requirements are normalized into concise, deduplicated statements, greetings and acknowledgements are omitted, and unknown legacy privacy placeholders are shown as `[REDACTED]` at the Admin boundary.
- Verification: workspace tests PASS (admin 71, web 15, API 579, chat-utils 6, contracts 6), Python model-gateway tests **42 PASS**, typecheck/lint/build **PASS**, Docker API/model-gateway rebuild and readiness **PASS**, Docker model-gateway probe **HTTP 200** with masked-placeholder preservation, and focused legacy/OCR CRM summary API tests **PASS**. A live Admin HTTP call against the pre-existing Docker database was not run because its local admin credentials were unavailable; no database reset or auth bypass was used.

## 2026-11-09 Azure intent and quote-readiness retest

- Normal V2 turns no longer receive the unconditional Node package/CRM prose suffix. Package lookup is exposed only for explicit package/pricing turns; status/recap turns do not receive knowledge search as a substitute for authoritative journey state.
- V2 knowledge preflight now derives a bounded retrieval topic, shapes the approved query, and removes unrelated package, banking, document-attestation, and cost-only clauses before Azure composition. This is a retrieval boundary, not a replacement for the GPT planner's turn intent.
- Verification: API **65 files / 587 tests PASS**, API typecheck/lint PASS, lifecycle/catalog quote gate tests PASS, model-gateway **43 tests PASS**, Docker API rebuild/restart/health PASS, and secret-safe gateway readiness reports `mode=azure`, `deployment=gpt-5.4`, valid `/openai/v1`, one initial attempt plus up to three retries, 90-second deadline, concurrency 2, circuit closed.
- Final local Docker Azure harness: **25/25 HTTP answers, 25 durable user messages, conversation gate PASS**. Licensing returned process evidence rather than package/cost prose; explicit package information remained catalog-backed; no CRM completion or later-stage completion was claimed. Evidence: `artifacts/ancfz/azure-intent-quote-retest-2026-11-09-final6-scored.json`.
- Quote scope remains stage 1–4 only and development/mock-only. Existing lifecycle coverage verifies the approved package → quote artifact → authenticated download boundary; no new external Salesforce write, charge, signature, document upload, payment or contract action was triggered by this retest. Overall status remains **NOT_READY** for the full seven-stage acceptance and formal human-quality gate.

## 2026-11-09 V2 natural contact-name cursor fix

- V2 now recognizes a bounded natural name such as `Adnan Kazi` only while the catalog-pinned `lead_contact_name` requirement is active. The value is routed through the existing session token vault before persistence, Azure context, intent evidence and response composition; the default token-only `extractLeadData` contract is unchanged.
- The contact cursor now owns non-knowledge, non-package turns while the name is missing, so qualification text cannot be mistaken for a name or leave the conversation in a generic model fallback. Package and knowledge questions remain answerable without creating a Lead.
- Verification: focused V2/model tests **65 files / 589 tests PASS**, full workspace tests **admin 71, web 16, API 589, chat-utils 6, contracts 6 PASS**, typecheck/lint/build **PASS**, and the rebuilt local Docker API returned `ready` in Azure mode with deployment `gpt-5.4`.
- Existing local Azure quote harness completed a synthetic Lead, development package selection, verified mock quote and authenticated PDF download; quote evidence remains development/mock-only. The exact bare-name regression is covered by the new V2 controller test; no production provider configuration was changed.

## 2026-11-09 Dev session ID visibility flag

- The web image always compiles with `NODE_ENV=production`, so the development Session ID chip is now controlled by the explicit build-time `NEXT_PUBLIC_DEV_SESSION_ID` flag instead of `NODE_ENV`.
- Local `.env` and the VM `.env` use `NEXT_PUBLIC_DEV_SESSION_ID=true`; the example defaults to false. The chip remains opt-in and exposes only the existing session ID and copy action.

## 2026-11-10 quote-to-document handoff and quote contact snapshot

- The local development quote executor now resolves the verified CRM Lead for the same session, rehydrates name/email/phone only at the private PDF boundary, and renders all three fields as separate customer rows. Missing or invalid contact data fails with `QUOTE_CUSTOMER_DETAILS_REQUIRED` before a new artifact is rendered.
- After a verified development quote, Node resolves the active required document policy from the session-pinned published catalog and OCR registry, persists the same opportunity at `document_upload`, and repairs the legacy pending cursor so the next Azure-composed turn exposes the active policy key. The development-only Lead-to-quote shortcut is explicitly handled; production quote workflow behavior is unchanged.
- Docker verification on 2026-11-10 used Azure model mode (`gpt-5.4`) and synthetic data only: Lead `completed`, quote execution HTTP 200 (`verified: true`, `mock: true`), authenticated PDF download HTTP 200, PDF text contained synthetic name/email/phone, the next turn exposed `document.identity.review`, and consented synthetic PNG upload returned HTTP 202. Redacted export: `docs/verification/document-upload-quote-contact-e2e-2026-11-09.json`.
- This remains development/mock quote evidence. It does not claim Account conversion, official ANCFZ pricing, Salesforce SF-02 attachment, payment, invoice settlement or contract completion.

## 2026-11-10 reliability, context and local Docker retest

- The feature branch was rebased onto `origin/main` at `17e42a6` before implementation. The Python gateway now applies one initial Azure attempt plus at most three transient retries, a bounded per-turn deadline, circuit protection and queue admission. Queue overload is logged with the real failure and returned to the customer as a safe retry message rather than an internal traceback.
- Redis is configured for AOF `everysec`, `noeviction`, 256 MB default maxmemory, TCP keepalive, bounded stream trimming and optional password ACLs. Conversation context is an ephemeral, tenant/session/opportunity-scoped cache with idle and absolute TTLs; PostgreSQL remains authoritative, so Redis loss does not discard verified state. The local runtime was corrected from a host-loopback Redis URL to the Compose service name after reproducing the 504.
- Nginx now has an exact WebSocket upgrade path with buffering disabled and bounded read/send timeouts. A live local Azure-backed handshake passed through Nginx with `authenticated → turn.accepted → assistant.message → turn.completed`; the adapter also exposes safe failed frames, including queue overload. The public HTTP chat contract remains available for local compatibility.
- The full local Azure Docker quote retest passed: CRM Lead fields were populated, quote action completed, authenticated PDF download returned HTTP 200, the PDF artifact included synthetic name/email/phone/package/evidence data, the document requirement was exposed only after quote handoff, and a consented synthetic document upload returned HTTP 202. A prior quote 502 was reproduced as a root-owned private-volume permission error and fixed by running the PDF service as UID 10001 with an owned volume.
- Verification after these changes: API **67 files / 595 tests PASS**, Python model-gateway **45 tests PASS**, API typecheck PASS, Compose verifier PASS and `git diff --check` PASS. The local Redis instance was inspected for the recommended runtime settings; password-enforced ACL mode and failover/consumer recovery were not exercised because the development `.env` has no Redis password.

### Remaining blockers (status is still NOT_READY)

- The repository still runs the existing `v2-*` Node path; the requested full neutral-module cutover and removal of old runtime names is not complete. The new WebSocket adapter currently bridges that path synchronously rather than running a Redis-streamed turn job with replay/reconnect semantics.
- Automatic intent-vocabulary observe/validate/evaluate/promote/rollback and the admin audit view are not implemented yet. The history-summary read tool and Redis context cache are implemented, but they do not replace that lifecycle.
- Quote rendering remains a protected Node boundary called by the inactive/local n8n template; the complete production dispatch must still be wired so n8n is the only execution path. Payment, contract and full provider-backed seven-stage acceptance remain environment-dependent.

## 2026-11-10 neutral runtime, vocabulary, Redis streams and n8n quote retest

- Active Node conversation source modules were moved from `services/api/src/v2-*` and `catalog-v2-*` filenames into `services/api/src/conversation/` with migrated callers. Historical migrations, evidence and semantic compatibility identifiers remain preserved; a full semantic route rename is not claimed.
- Intent vocabulary learning now observes customer-origin expressions, rejects assistant text, PII, negation, quotations/hypotheticals, duplicates and competing phrases, promotes after two independent sessions, and exposes tenant-scoped admin reject/rollback/audit operations. It changes only intent vocabulary; RAG, documents, pricing and workflow policy remain protected.
- WebSocket turns now use Redis Streams for tenant/session-scoped events and a durable turn-job consumer group, with hashed session-token authorization, duplicate client-message dedupe, replay cursors and pending-message reclaim. PostgreSQL remains business truth. A live Nginx/Azure handshake and reconnect replay passed.
- The live quote harness no longer calls the private PDF executor directly. After synchronizing the persistent development n8n published history revision with the checked-in package workflow, the Azure-mode conversation passed Lead completion, n8n-dispatched package quote, verified mock PDF generation, authenticated PDF download, requirement-gated document prompt and consented document upload. The PDF was independently inspected for synthetic name, email, phone, package and development/mock evidence.
- Verification for this checkpoint: `npm run typecheck`, workspace production build, Compose config validation, `git diff --check`, live Docker quote conversation and live WebSocket replay passed. No unit tests were run per the current execution instruction. Development Redis ACL/password and restart-recovery checks remain intentionally unexercised.

### Remaining blockers

- The quote provider remains development/mock evidence; official pricing, Account creation, SF-02 attachment readback, invoice/payment provider settlement and contract signature verification still require provider-backed seven-stage acceptance.
- Semantic `v2` identifiers and compatibility route names remain in active code, even though the source filenames/import paths are neutralized. Removing those identifiers is a separate breaking API cutover and was not silently performed.
- The persistent n8n workflow database is runtime state and is not updated by Docker image rebuild alone; deployment must import/publish the checked-in workflow revision before treating a fresh environment as quote-ready.

## 2026-11-10 intent catalog contract and Azure live verification

- The canonical `BusinessGoals` catalog contract now carries human-editable keywords, customer expressions, required information, document references, ordered business steps, package/product references, authorized read tools and completion conditions. The API schema, workbook headers, ingestion parser, Python model contract and GPT envelope/tool projection are aligned.
- The local `anc` tenant published catalog revision 12 was derived from the previous published catalog so existing enabled workflow bindings and package authorization were preserved while the structured company-formation goal data was added. Approved package offerings were re-pinned to the new catalog revision; the prior catalog remains retained as draft history.
- A focused Azure live conversation recognized “I want to open a firm” semantically, requested explicit goal confirmation, then collected lead information. The live quote journey completed the development Lead, n8n quote action, authenticated PDF download and requirement-gated document upload; the PDF contained synthetic customer name, email, phone, package and mock-evidence text.
- The 15-case Azure replay completed 14/15 cases; one turn returned a transient `V2_MODEL_INVALID_RESPONSE` 500 and the exact scenario passed on rerun. This remains a reliability follow-up rather than a catalog validation failure.

## 2026-11-10 quote conversation remediation live check

- The shared GPT-first turn controller now resolves short consent replies against the active consent requirement and provides a catalog-backed identity-document handoff when the model response is rejected or the post-quote requirement is pending. A greeting/exploration turn no longer falls back to an approved-knowledge abstention.
- New Session clears the persisted session token and closes the old WebSocket; connecting a different session no longer reuses the previous open socket.
- Live Azure Docker verification passed after rebuild: greeting, setup question, pre-confirmation document question, goal confirmation, contact collection, text `Yes` consent, Lead proposal, post-quote document prompt and synthetic document upload completed without a repeated assistant response or generic fallback. Quote action was approved, PDF download returned HTTP 200, and the upload returned HTTP 202.
- Evidence: `docs/verification/quote-conversation-live-review.json` (`conversationAccepted: true`, `repeatedAssistantResponses: 0`, `fallbackResponses: 0`) and `docs/verification/quote-conversation-ws-smoke-2026-11-10.json`.
- This is a development/mock quote acceptance through the current UI/API workflow. It does not prove official pricing, payment, contract signature or the full provider-backed seven-stage journey; package selection and action confirmation are still represented by the existing trusted UI/API action boundaries in the harness.

## 2026-11-10 latest-main test/fix branch

- Branch `test/fix-latest-main-changes` was created from fetched `origin/main` at `795d5df`.
- The GPT-first controller now requires Node-observed customer initiation before a model-only semantic goal can bind, preserves an accepted greeting follow-up offer, and uses the published goal label in pending-goal recovery text. The corresponding stale unit expectations were aligned with the catalog label and explicit natural contact-consent behavior.
- The Python persona instructions retain an explicit information-only boundary, and the catalog-v2 ingestion fixture now includes the published `BusinessGoals` fields required by the parser.
- Verification: workspace tests PASS (Admin 71, Web 16, API 604, chat-utils 6, contracts 6); Python model-gateway 45/45 and ingestion 36/36; workspace typecheck, lint, production build, Compose verification, secret tests and `git diff --check` PASS.
- This local branch did not run the full live seven-stage provider journey; Account, payment/invoice, contract-signature and official-registration evidence remain unverified.
- **2026-11-10 conversation stability baseline (read-only):** On branch `test/fix-latest-main-changes` at `795d5df`, the local ANCFZ 15-use-case run persisted 15 sessions, 94 user turns and 94 assistant turns. The runner reported 14/15 transport passes, 1/15 failure (`growth-quote-document-followup`, turn 3), and 19 duplicate answer digests. The transcript review counted 25 generic/non-answer replies, 14 package-list replies, 5 safety abstentions, 1 approved-information-unavailable fallback, 0 action requests and 0 CRM leads. This is a conversational-quality failure despite mostly successful HTTP responses.
- **Baseline guard/planner distribution:** The corresponding read-only audit showed 50/94 turns ending in `safe_no_evidence_dialogue` (34 with zero tool calls and 16 with one), 25 `accepted_knowledge_excerpt`, 7 `accepted_knowledge_repair`, 7 `unsupported_claim`, 3 `accepted_model_dialogue`, 1 `policy_denied` and 1 `invalid_citation`. Planner evidence was dominated by `unknown_or_unrelated_topic,no_goal_candidate` (26) and `no_goal_candidate` (15), consistent with package/quote natural-language turns not reaching a useful grounded state.
- **Diagnostic query contract:** For each synthetic run, review only masked/audited fields: session/message sequence, `candidateGuardReason`, final `guardReason`, approved-evidence count, tool names/statuses, pending offer keys, pending requirement, and action/CRM counts. Do not export environment variables, provider secrets, raw PII, or unrestricted transcript data. Historical artifacts: `artifacts/ancfz/15-use-case-conversation-review-2026-11-10.md`, `artifacts/ancfz/15-use-case-conversations-2026-11-10.json`, and `artifacts/ancfz/15-use-case-db-transcript-2026-11-10.json`.
- **Catalog validation during response-stability fix:** Read-only PostgreSQL inspection confirmed the published ANCFZ V2 reference remains `anc:r12:f9a46f1822603a66c0c98a94876b2fe1cb4ff3d42894f44b8816e686da935751`, with 25 intent signals and 8 knowledge topics; the only direct package-selection signal is `I select this package`, and no direct `quote`, `quotation`, or package-name signal was present. `python -m pytest tools/ingestion/test_catalog_v2.py -q` passed (5/5). No catalog version was published because the reviewed source workbook was not present in this worktree and runtime routing now covers these expressions; ad-hoc SQL publication was intentionally skipped.

## 2026-11-10 response-stability fix execution and retest

- The shared Node path now routes package/quote language, persists a catalog-scoped package offer, resolves verbose published package names using package-specific tokens, reloads selected-package evidence, and exposes executable V2 read-tool names in the model envelope. Synthetic contact fixtures use suffixed production-format tokens; production masking/extraction was not weakened.
- Fixed-run artifact: `artifacts/ancfz/15-use-case-conversations-fixed3-2026-11-10.json`. The local ANCFZ runner completed **15/15 journeys and 94/94 turns**, with **13 runner duplicate-answer counts**, **15 runner generic-like turns**, **18 generic-shaped turns under a broader text scan**, **0 fallback flags**, and **2 pending lead action proposals**. Package selection and quotation are grounded for direct Starter/Growth paths, but supporting-intent cases remain semantically unstable.
- Read-only PostgreSQL verification over the latest 15 sessions reported **15 sessions, 94 user messages, 94 assistant messages, 94 intent-turn assessments, 2 `crm.lead.create` action requests awaiting confirmation, and 0 CRM leads**. No provider operation was initiated. The published catalog remains `anc:r12:f9a46f1822603a66c0c98a94876b2fe1cb4ff3d42894f44b8816e686da935751`; no catalog write was performed.
- Full verification: `npm test` passed (Admin 71, Web 16, API 618, chat-utils 6, contracts 6); workspace typecheck, lint and build passed; model-gateway tests passed **45/45** from its service directory; ingestion tests passed **36/36**; runner syntax and `git diff --check` passed; `agentic-api` was healthy in Docker Compose.
- Detailed review: `artifacts/ancfz/15-use-case-conversation-review-fixed3-2026-11-10.md`. Verdict remains **IMPROVED, BUT NOT FULLY STABLE**. Remaining defects are supporting-intent routing, ordinal/affirmative offer replies, pending-requirement precedence, package constraint ranking, and cross-turn/language evidence continuity. No commit, push, merge, real CRM write, payment, signature, or provider operation was performed.

## 2026-11-11 mock real-time quote guidance check

- Live synthetic API conversation confirmed that package evidence is reachable and Growth returned grounded details (AED 4,999, two visas), but a quotation request is still gated by explicit company-formation confirmation and then Lead contact collection.
- With the Lead name/contact cursor active, a valid package question produced either a safe abstention or only a partial price answer. After synthetic contact consent, Node created only a `crm.lead.create / lead.create / awaiting_confirmation` proposal; read-only PostgreSQL verification showed **0 CRM leads** and no quote/provider action because explicit Lead submission was not confirmed.
- Detailed transcript: `artifacts/ancfz/mock-real-time-quote-guidance-2026-11-11.md`. This confirms pending-requirement precedence as the next shared routing issue; no code or catalog change was made during this check.

## 2026-11-11 pending-contact package continuity fix

- The shared controller now treats an approved package question as a supporting knowledge turn even while `lead_contact_name` is pending. It loads approved package evidence, returns a guarded citation-backed package list, persists a short-lived package offer, and preserves the contact requirement for the next turn.
- Regression coverage verifies the pending-contact package path, package offer expiry, package selection, and fail-closed behavior when package rows exist without approved evidence. The fallback never fabricates a package answer from empty evidence.
- Fixed replay: `artifacts/ancfz/mock-real-time-quote-guidance-fixed-2026-11-11.md`. One transient `V2_MODEL_INVALID_RESPONSE` occurred on the first goal-confirmation attempt and succeeded on retry. The quote remained correctly gated by contact collection and explicit action confirmation; no CRM/provider operation ran.

## 2026-11-11 PR review fixes

- The package evidence fallback now passes through the persona/evidence response guard and is disabled for model/tool hard stops. Package selection negation and conditional questions are fail-closed, expired package pricing is revalidated when an offer is selected, executable read-tool names are normalized before plan validation, semantic explicit goal pursuit remains eligible for model-led confirmation, and fallback grounding is cleared when a later override replaces the answer.
- CI path drift was corrected for the workbook exporter, catalog validator, runtime safety tripwire, retirement guard and their current `conversation/` test fixtures. Hosted unit-only validation passed after these fixes.

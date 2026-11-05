# Current code state and migration gaps — 2026-10-30

**Current baseline:** `main` after merged PRs #79 and #78 (2026-10-30), containing the initial Python GPT gateway/Node adapter and retired Foundry-agent runtime files. This is **not** a tested seven-stage runtime; the original lead-first `app.ts` still controls the chat. This document records source inspection and target gaps, not live acceptance.

## Recovery checkpoint — 2026-11-04

On `fix/zara-conversation-engine-end-to-end-recovery`, the V2 public path now independently validates optional questions, claims and candidate intent plans; accepts trusted evidence from correlated read tools; evaluates mixed-polarity source clauses; preserves the V2 prompt cursor across public turns; recognizes reviewed natural formation aliases; accepts natural scoped confirmation phrasing; preserves verified business and masked contact facts through invalid non-knowledge citations; advances catalog contact requirements through consent; routes an explicit, purpose-consented Lead request through the existing Node action gate to an awaiting-confirmation proposal when the published binding is enabled; resolves canonical V2 outbox actions through catalog-declared n8n identity and durable claim correlation; contextualizes knowledge follow-ups; keeps synthetic tool provenance out of PostgreSQL source UUID lookups; preserves relevant short structured ingestion lines for deterministic grounded fallback; and stores package offerings against either legacy UUID or canonical V2 catalog identity without repinning. Focused/full local tests, local ingestion and tenant acceptance, public confirmation/fact/contact smoke, a rebuilt Docker API, and a 25-turn public persistence harness pass. The seven-stage journey, Salesforce sandbox, package/quotation data, browser E2E and three-run Azure acceptance remain unverified; this checkpoint does not replace the migration gaps below.

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

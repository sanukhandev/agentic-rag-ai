# Current code state and migration gaps — 2026-10-30

**Current baseline:** `main` after merged PRs #79 and #78 (2026-10-30), containing the initial Python GPT gateway/Node adapter and retired Foundry-agent runtime files. This is **not** a tested seven-stage runtime; the original lead-first `app.ts` still controls the chat. This document records source inspection and target gaps, not live acceptance.

## V2-P0-01 baseline audit — 2026-10-30

The implementation branch `feat/conversation-engine-v2` starts at commit
`7bbda9a868d21c8f891c264348f8a335cee55759`, on top of merged `main`
`7e9212774c9de5ab93195c6f7d4fb408d08f146a`. The redacted baseline report is
[`docs/verification/conversation-v2/V2-P0-01.md`](verification/conversation-v2/V2-P0-01.md).

Measured baseline: Compose and secret checks pass; lint and all non-API
workspace tests pass. The API suite has 208 passed, 1 failed and 12 skipped,
with the deterministic 1536-dimension embedding test timing out. Typecheck and
the production build fail on existing Python-model adapter typing errors. The
Python gateway tests are blocked locally because `pytest` is not installed.
The full seven-stage E2E remains intentionally NOT RUN and is reserved for
manual issue #124. No migration, customer data, provider write or credential
was changed.

V2-P0-02 is **VERIFIED for the configured local development deployment**:
the private Azure OpenAI `/openai/v1/` endpoint, deployment, API key and
Node↔Python service key were present through the local endpoint compatibility
mapping. Live structured Responses output, strict JSON and a direct function
capability probe succeeded. Azure CLI quota metadata was not available on the
host; application budgets are verified. See
[`V2-P0-02`](verification/conversation-v2/V2-P0-02.md).

## Existing code topology — IMPLEMENTED

| Responsibility | Verified location | What exists |
| --- | --- | --- |
| Customer HTTP API | `services/api/src/app.ts`, `services/api/src/http/schemas.ts` | Session and message routes, message idempotency, per-turn catalog/RAG/response orchestration; unchanged public JSON response |
| Catalog | `services/api/src/intent-catalog.ts`, `intent-catalog-xlsx.ts` | Published XLSX catalog, weighted signals (phrases/keywords/exclusions), score/confidence/ambiguity, slot and journey rules; optional `BusinessStages` plus other catalog extensions |
| Continuity | `services/api/src/intent-journey.ts`, `journey-engine.ts`, `conversation-state.ts` | Active intent, opportunity identity, pending requirement, fact/confirmation state and transition handling |
| Selected model | `services/api/src/python-model/chat-model-adapter.ts`, `services/model-gateway/gateway/app.py` | Private Node→Python GPT adapter and Azure OpenAI Responses API-key gateway, live structured planning/function capability and bounded resilience controls verified |
| Model tools | `services/model-gateway/gateway/agent.py`, `services/model-gateway/gateway/tool_definitions.py`, `services/api/src/agent-tools.ts` | Python bounded Responses function-call loop is implemented with strict read-tool schemas, correlation, duplicate protection and typed fallback; authenticated Node gateway is the next issue |
| Inference interface | `services/api/src/model.ts` | Existing `ChatModel` abstraction and deterministic fallback/normalization helpers |
| Retrieval | `services/api/src/knowledge.ts`, retrieval/search modules | Tenant/source-filtered PostgreSQL pgvector knowledge, citations and extractive fallback |
| Outbox/workflows | `services/api/src/actions.ts`, `events.ts`, `event-relay.ts`, `event-bus.ts`, `event-worker.ts` | Action proposals, transactional outbox, Redis Streams, worker→n8n, retries/reconciliation |
| Business lifecycle | `services/api/src/routes/lifecycle.ts` and lifecycle services | Package/quote/account/invoice/contract endpoints and guarded state; not all providers confirmed |
| Persistence | `services/api/src/store-postgres.ts`, `infra/postgres/001..054` | Durable tenant/session/journey/actions/business artifacts and Foundry conversation bindings |
| One-journey QA | `tools/qa/ancfz-single-journey.mjs` | One synthetic session, idempotency and some continuity assertions; stops at real provider blocker |
| Admin and web | `apps/admin`, `apps/web` | Existing Angular Admin and Next.js web chat; not redesigned by this task |
| Python | `services/model-gateway/`, `tools/ingestion`, `tools/anc/pdf_service`, `tools/anc/payment_mock` | New FastAPI model gateway is added but unverified; ingestion/OCR/PDF/payment mock remain separate services |

## Deficiencies versus target

1. **Initial model boundary exists, but Node cutover is incomplete:** private Python `/internal/v1/model/plan` and `/normalize`, the bounded `/internal/v2/conversation/turn` coordinator and Node adapter are added, with an opt-in Compose overlay. Current `app.ts` still routes through lead-first branches and does not pass the full published catalog and User Intent Document into the planner; structured plans remain unable to authorize business writes.
2. **Intent-score semantics:** `intent-catalog.ts` derives `confidence = score / 100` from weighted keyword/phrase scores; this is a heuristic score, not a measured probability. The current engine has no **goal-first six-category taxonomy** and no **GPT-led adaptive conversation strategy** that weighs full conversation summary, requirements and competing business goals on every substantive turn. Model intent interpretations and signal evidence are not systematically fused/validated per turn. Cross-intent ambiguity needs explicit user selection.
3. **No dedicated User Intent Document:** current `conversation_state`, `intentProgress`, `journey_instances`, `journey_facts`, messages and audit are useful foundations but no independently versioned, reconstructible per-turn intent decision ledger exists with **primary Business Goal distinct from per-turn intent category**, LLM-generated structured conversation summary, candidate signal **and adaptive weight** evidence, confirmed goal, model provenance and cache invalidation guarantees.
4. **Normalization is conditional:** `app.ts` builds a deterministic query and gates model normalization on global/tenant flags for particular uncertain turns. Target: use a bounded AI normalization call when retrieval needs it, then cache and validate its facts, negation, tokens and source/tenant scope.
5. **Cost/latency:** app may perform separate model activities for composition/normalization. Need a per-turn budget, keyed memoization and reuse of structured results rather than redundant LLM requests.
6. **Action planning:** catalog `WorkflowBindings` and Node action path exist, but the current flow risks treating lead/CRM capture as the implicit primary goal. Named Foundry read-only function tools are separate from n8n writes. The new design must treat **CRM Lead capture as a conditional Service Execution capability**, not universal intent completion. Need a tenant-neutral catalog `ToolBindings`/action specification and server-side interpretation → user intent confirmation → prerequisite/consent → transactional outbox.
7. **One-question continuity:** pending requirements and source-grounded responses exist, but there is no unified invariant to guarantee one relevant follow-up after every successful grounded active-journey answer, especially through knowledge interruptions and stage handoff.
8. **Provider blocker:** latest documented v6 13-turn run created an eligible ActionRequest and dispatched local lead, then set `reconcile_required` without a verified Salesforce remote Lead. Qualification/Account/Package/Documents/Invoice/Contract were not completed in that run.
9. **Python retry/rate limits:** SDK `max_retries=3`, local 429 `Retry-After`, shared turn deadlines, bounded concurrency/pacing, circuit breaker and redacted observability are implemented and focused-tested. Provider RPM/TPM quota metadata remains an operational follow-up because Azure CLI is unavailable on the host.
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

### Conversation Engine v2 P5-01 — catalog-authorized action gate — 2026-10-30

Issue #108 is implemented and focused-tested in
[`V2-P5-01`](verification/conversation-v2/V2-P5-01.md). Node now validates
untrusted v2 action proposals against the pinned catalog, current goal/stage,
verified requirements, purpose-specific consent and action revision before it
can create a pending `ActionRequest`. Exact customer confirmation remains a
separate trusted gate and reuses the existing ActionGateway/outbox boundary.
No provider operation or final journey acceptance is claimed.

### Conversation Engine v2 P5-02 — outbox and Redis retry safety — 2026-10-30

Issue #109 is verified in
[`V2-P5-02`](verification/conversation-v2/V2-P5-02.md). The existing durable
outbox/inbox/Redis/n8n path passed duplicate, worker-lease, transient retry,
dead-letter, reconciliation and accepted-state protection checks. In-memory
outbox idempotency now matches PostgreSQL uniqueness semantics. No external
provider write was executed.

### Conversation Engine v2 P5-03 — signed callbacks and evidence tiers — 2026-10-30

Issue #110 is implemented and verified in
[`V2-P5-03`](verification/conversation-v2/V2-P5-03.md). v2 provider callbacks
now require exact session, opportunity, catalog, action and revision
correlation in addition to signed execution/event/attempt checks. The status
tool distinguishes transport, dispatch, explicit provider/mock verification
and reconciliation; only explicit verified evidence can satisfy a stage gate.

## P0 decisions, issue plan and manual final test — documentation only

The customer approved the **existing Azure GPT model deployment**, a **new v2-only catalog** (no v1 import fallback in new engine, with legacy state preserved for rollback), **published Zara English** persona for ANCFZ, **sandbox/mock-first** seven-stage acceptance, and **Contract Stage 7 as journey completion** with legal company registration independently tracked. Development issues #82–#124 carry label `v2-feature`, and the implementation branch is `feat/conversation-engine-v2`. The [P0 decision register](conversation-engine-p0-signoff.md), [v2 catalog spec](catalog-v2-contract.md), [business/provider register](ancfz-business-provider-readiness.md), [issue index](conversation-v2-issue-index.md) and [Codex instructions](codex-v2-master-prompt.md) are **planning/specification only**. No new runtime implementation, Azure smoke, Salesforce provider verification or full seven-stage E2E is claimed. Final issue #124 is intentionally reserved for **explicit manual customer trigger** after all other implementation tasks are closed.

## V2-P0-03 strict catalog contract — 2026-10-30

Issue #84 is implemented at the contract boundary: `services/api/src/catalog-v2.ts` strictly validates schema v2, required sheets, cross-references, stage order, tool gates and canonical catalog identity. The synthetic ANCFZ fixture and five focused tests pass. Existing v1 parser/data remain available for rollback; importer, Admin publication and runtime adoption are P1 work in #87–#91. No migration or catalog data was changed, and the full seven-stage acceptance remains reserved for #124.

## V2-P0-04 private agent contracts — 2026-10-30

Issue #85 freezes strict v2 TurnEnvelope, tool request/result, persona response and response-guard verdict boundaries in the TypeScript API and Python gateway. Scope, version pins, revisions, budgets, bounded output and unknown-key rejection are validated before later orchestration work. Python receives no database, CRM, n8n, payment or signing capability; the public Node chat contract and legacy adapter remain unchanged. Full model/tool execution is deferred to P3/P4 issues.

## V2-P0-05 ANCFZ policy/provider matrix — 2026-10-30

Issue #86 locks the seven ordered stages and their required evidence tiers in `services/api/src/fixtures/ancfz-provider-matrix-v2.json`. Consent phrases are synthetic test-only placeholders pending owner approval. All stages remain blocked for real provider completion until the documented Salesforce, quote, SF-02, invoice/payment and signing evidence exists; legal registration is separately tracked. The full seven-stage run remains reserved for #124.

## V2-P1-01 strict XLSX parser — 2026-10-30

Issue #87 adds `tools/ingestion/ingestion/catalog_v2.py`, a dedicated openpyxl parser for the frozen 15-sheet v2 workbook. It rejects legacy/unversioned or unsafe workbooks, preserves source hash and tenant scope, and leaves the v1 parser/history path unchanged. Focused parser tests pass; Admin publication and runtime adoption remain later issues.

## V2-P1-02 runtime policy validator — 2026-10-30

Issue #88 adds the trusted published-catalog validator, stage eligibility evaluator and separate evidence/ambiguity/requirement/action-readiness scoring in `services/api/src/catalog-v2-runtime.ts`. The existing v1 resolver is preserved for rollback; v2 catalog adoption by the conversation coordinator remains later work.

## V2-P1-03 Admin v2 catalog publication — 2026-10-30

Issue #89 adds a separate tenant-scoped v2 catalog store/API, strict preview and explicit publication, plus canonical JSON and XLSX export. The existing v1 Admin routes/storage remain unchanged. Migration `055-catalog-v2-versions.sql` is added but was not applied in this focused memory-store verification; the v2 conversational runtime is not switched by publication.

## V2-P1-04 audited legacy catalog migration — 2026-10-30

Issue #90 adds metadata-only, tenant-scoped auditing of v1 catalog history and
an explicit reviewed v1→v2 candidate endpoint. A candidate must pass the
strict v2 contract and trusted tenant-scope check, is stored as an unpublished
v2 draft, and is linked to the source v1 version by an audit event. No v1
catalog, session, action, lead, document, consent or provider identity is
mutated or copied. The v2 runtime still requires a later explicit rollout;
full seven-stage acceptance remains reserved for #124.

## V2-P1-05 ANCFZ reference fixtures — 2026-10-30

Issue #91 adds the strict ANCFZ v2 reference catalog and scenario fixtures:
seven ordered stages, Zara English persona reference, qualification variants,
knowledge-only and ambiguity cases, stage-scoped document policy and disabled
remote writes. Node Admin export is revalidated by the strict validator, and a
reproducible generated workbook is accepted by the dedicated Python v2 parser.
Provider evidence remains separately blocked until independent sandbox/mock
acknowledgements exist; the full seven-stage test remains reserved for #124.

## V2-P2-01 durable User Intent Document — 2026-10-30

Issue #92 adds additive migration `056-user-intent-document.sql`, strict
redacted projection/turn types, memory/PostgreSQL Store methods, expected
revision CAS and replay-safe append semantics. Discovery may remain without an
opportunity; tenant/session/opportunity scope and PII bounds are enforced.
The public chat coordinator does not consume this projection yet; that remains
later P2/P3 work. No live database migration was executed.

## V2-P2-02 transactional turn claim — 2026-10-30

Issue #93 adds an atomic client-message claim in both MemoryStore and
PostgresStore. The Chat API now detects a concurrent winner before session
mutation or model/business work, returns `MESSAGE_IN_PROGRESS` to the loser,
and replays the exact persisted response for an identical completed retry.
Changed message bodies remain `MESSAGE_ID_REUSED`; session revision CAS,
action idempotency and outbox protections are unchanged. Evidence is recorded
in `docs/verification/conversation-v2/V2-P2-02.md`.

## V2-P2-03 discovery continuity and correction — 2026-10-30

Issue #94 preserves knowledge-only discovery, catalog-pinned journey continuity
and slot provenance while invalidating pending same-opportunity action proposals
when a validated business fact is explicitly corrected. The correction is
audited with redacted identifiers; completed/provider-verified actions and
unrelated opportunities are retained. Evidence is recorded in
`docs/verification/conversation-v2/V2-P2-03.md`.

## V2-P2-04 tenant-scoped cache and invalidation — 2026-10-30

Issue #95 extends the existing Redis cache with tenant-prefixed keys, scoped
invalidation, local singleflight for normalization and redacted cache-hit
audits. Cache loss remains a graceful degradation path: durable PostgreSQL
state, message replay and consent/action records remain authoritative. Evidence
is recorded in `docs/verification/conversation-v2/V2-P2-04.md`.

## V2-P2-05 published persona pin and response history — 2026-10-30

Issue #96 keeps the published persona version pinned to each new chat session
and records redacted response audit metadata for persona version, language,
intent, grounding and response digest. Historic responses are replayed without
recomposition after later persona publication. Evidence is recorded in
`docs/verification/conversation-v2/V2-P2-05.md`.

## V2-P3-01 Azure model resilience — 2026-10-30

Issue #97 is verified and closed. The private Python gateway has bounded Azure
retry, shared turn deadlines, application rate limits, circuit breaking and
redacted observability. Live deployment connectivity and structured Responses
output were verified with the configured development environment. Evidence is
recorded in `docs/verification/conversation-v2/V2-P3-01.md`.

## V2-P3-02 bounded Python conversation agent — 2026-10-30

Issue #98 is verified and closed. The internal coordinator uses the frozen v2
envelope, the nine-function strict read-only registry, correlated function-call
outputs and bounded model/tool execution. It is not a public Chat API or a
provider-side business-action executor. Evidence is recorded in
`docs/verification/conversation-v2/V2-P3-02.md`.

## V2-P3-03 authenticated Node trusted tool gateway — 2026-10-30

Issue #99 adds the private Node tool boundary used by the Python coordinator.
Node verifies a short-lived signed scope, the private service key, tenant and
session ownership, pinned catalog/persona revisions and session state revision.
Only the nine explicit read-only tools are available; results are bounded,
sanitized and replay-safe by tool call ID. No CRM, n8n, payment, signing or
arbitrary network operation is exposed. Focused evidence is recorded in
`docs/verification/conversation-v2/V2-P3-03.md`.

## V2-P3-04 authorized RAG and grounding — 2026-10-30

Issue #100 is verified and closed. The v2 knowledge tool uses the existing
tenant/source-filtered PostgreSQL/pgvector path, fact-preserving normalization
and an active current-version recheck before returning bounded evidence. No
evidence produces uncertainty; it never authorizes a business action. Evidence
is recorded in `docs/verification/conversation-v2/V2-P3-04.md`.

## V2-P3-05 bounded intent and stage planning — 2026-10-30

Issue #101 is verified and closed. Structured Python planning proposals are
validated by Node against the published catalog and current state for goal
membership, signals, ambiguity, stage requirements and read-tool allowlists.
Confirmed goals survive knowledge interruptions, and planning cannot authorize
writes or transitions. Evidence is recorded in
`docs/verification/conversation-v2/V2-P3-05.md`.

## V2-P3-06 claim provenance and evidence verification — 2026-10-30

Issue #102 is verified and closed. The private v2 response verifier maps
claims to active approved evidence or verified structured facts, rejects
revoked/conflicting/injected/unsupported claims, and returns typed guard
verdicts with redacted claim provenance. It does not authorize business
actions. Evidence is recorded in
`docs/verification/conversation-v2/V2-P3-06.md`.

## V2-P4-01 natural persona composer — 2026-10-30

Issue #103 is verified and closed. The private Python conversation agent now
builds final-response instructions from the session-pinned tenant persona and
validates the composed response against that persona version and permitted
language before it crosses the runtime boundary. The composer is constrained
to masked context and approved observations, permits one relevant question or
a legitimate no-question outcome, and rejects internal metadata, protocol
terms and prompt leakage. Evidence is recorded in
`docs/verification/conversation-v2/V2-P4-01.md`.

## V2-P4-02 deterministic Node response guard — 2026-10-30

Issue #104 is verified and closed. The v2 Node guard now composes the existing
claim/evidence verifier with persona and language pin checks, pending-question
policy, repeated-question rejection, and explicit denial of uncited provider
completion claims. Rejected model text is never returned as the customer
response; the caller receives a bounded approved fallback and redacted
feedback digest. Evidence is recorded in
`docs/verification/conversation-v2/V2-P4-02.md`.

## V2-P4-03 versioned offline persona fallbacks — 2026-10-30

Issue #105 is verified and closed. Node now supports approved, pinned fallback
families for missing knowledge, invalid model output, rate limiting, tool
outage, action processing, reconciliation, declined consent and human
handoff. Fallback selection requires the exact persona version, template
version, language and approved flag; unknown or unapproved sets fail closed.
Selected fallback text passes the same response-evidence guard and contains no
provider-completion claims or internal metadata. Evidence is recorded in
`docs/verification/conversation-v2/V2-P4-03.md`.

## V2-P4-04 opt-in conversation coordinator — 2026-10-30

Issue #106 is verified and closed. The private `V2ConversationCoordinator`
connects a scoped Node turn envelope to the Python v2 agent, validates the
typed agent result through the Node response guard, maps only an accepted or
approved fallback response to the existing `ModelDraft` compatibility shape,
and preserves tool traces for internal telemetry. The existing chat handler
uses it only when `CONVERSATION_ENGINE_V2_ENABLED=true` and the tenant is in
the explicit `CONVERSATION_ENGINE_V2_TENANTS` allowlist. Unavailable v2 turns
roll back to the existing model path; Node action, consent, document and
provider gates remain unchanged. Evidence is recorded in
`docs/verification/conversation-v2/V2-P4-04.md`.

## V2-P4-05 persona quality and tenant isolation — 2026-10-30

Issue #107 is verified and closed. The synthetic quality matrix evaluates the
same guard contract for published English Zara and a separate tenant persona
across greeting, remembered qualification, correction, consent, action status,
document review, invoice, contract, opt-out and outage fallback states. It
checks one purposeful question, no repetition, language/persona pins, raw
metadata rejection and no false provider completion. Evidence is recorded in
`docs/verification/conversation-v2/V2-P4-05.md`.

## V2-P5-04 PII, credential and document boundary — 2026-10-30

Issue #111 is verified and closed for the code and synthetic security gate.
Credential-shaped values are removed before reversible PII token allocation and
when composing document/CRM summaries. OTPs, payment credentials, provider
secrets and model-selected provider endpoints are not exposed to the v2 model
or public API. Existing tenant scope, document consent, source ACLs, HMAC
n8n authentication, opaque references and audit boundaries remain unchanged.
Owner-approved n8n secret rotation and production provider review remain
operationally blocked; no credential value was read or changed. Evidence is
recorded in `docs/verification/conversation-v2/V2-P5-04.md`.

## V2-P6-01 Stage 1 Lead provider contract — 2026-10-30

Issue #112 is verified with deterministic mock evidence. Node now has a strict
v2 Lead create-or-dedupe contract that binds tenant, session, opportunity,
catalog, action revision and idempotency, carries only an opaque payload
reference, requires explicit contact consent and classifies ambiguous or
uncorrelated provider results as reconciliation-required. The deterministic
mock is retry-idempotent and explicitly reports `mock_verified`. No live
Salesforce credential or workflow binding was enabled, so no real Lead ID is
claimed. Evidence is recorded in
`docs/verification/conversation-v2/V2-P6-01.md`.

## V2-P6-02 deterministic Lead Qualification — 2026-10-30

Issue #113 is verified. Node now evaluates the published catalog's
qualification requirements deterministically and returns qualified,
disqualified, unknown or manual-review outcomes with bounded fact provenance.
Only a qualified result enables the later Account Creation gate. Document
policies cannot satisfy or block Stage 2 qualification, and no provider action
is created by the evaluator. Evidence is recorded in
`docs/verification/conversation-v2/V2-P6-02.md`.

## V2-P6-03 OTP and Account/Contact/Opportunity boundary — 2026-10-30

Issue #114 is verified for the Node-side contract. OTP challenges are hashed,
tenant/session/opportunity/Lead-bound, expiring, retry-limited and one-time.
Account conversion requires qualified Lead state, verified remote Lead
identity, purpose consent, explicit customer confirmation and matching OTP
verification. Provider results require exact correlation and independently
verified evidence. The deterministic provider is mock-only; no Salesforce
Account, Contact or Opportunity completion is claimed. Evidence is recorded in
`docs/verification/conversation-v2/V2-P6-03.md`.

## V2-P6-04 package eligibility and quote boundary — 2026-10-30

Issue #115 is verified for the Node-side package contract. Package requests
are bound to the active opportunity and catalog version and require approved
eligibility, an active authoritative price and versioned source references.
Quote results are exact-correlation checked and idempotent; existing lifecycle
services still own durable selection confirmation and quote storage. The
deterministic quote adapter is mock-only, so no live pricebook or provider
completion is claimed. Evidence is recorded in
`docs/verification/conversation-v2/V2-P6-04.md`.

## V2-P6-05 document review and SF-02 boundary — 2026-10-30

Issue #116 is verified for the Node-side document contract. SF-02 requests are
allowed only for completed OCR/review, consented documents bound to the active
tenant/session/Lead/opportunity and a verified Account/Contact/Opportunity
target. Exact callback correlation is required; wrong-record or incomplete
provider evidence remains reconciliation-required. The deterministic adapter
is mock-only and no live attachment completion is claimed. Evidence is
recorded in `docs/verification/conversation-v2/V2-P6-05.md`.

## V2-P6-06 invoice and payment boundary — 2026-10-30

Issue #117 is verified for the Node-side invoice/payment contract. Payment
requests require a quote-linked pending invoice, matching approved amount and
currency, hosted payment metadata and an invoice artifact hash. Invoice and
payment statuses remain separate; deterministic settlement is explicitly
`mock_paid`, never real settlement. Failed, stale, mismatched or incomplete
provider evidence remains unverified. Evidence is recorded in
`docs/verification/conversation-v2/V2-P6-06.md`.

# Current code state and migration gaps — 2026-10-30

**Branch reviewed:** `feat/foundry-single-journey-tool-orchestration` at SHA `8efe09b620a48c31cc7e4daab974638baf938134` (baseline for this documentation rewrite). This is a source inspection, **not** a new live end-to-end run. Subsequent commits must update this file when implementation changes.

## Existing code topology — IMPLEMENTED

| Responsibility | Verified location | What exists |
| --- | --- | --- |
| Customer HTTP API | `services/api/src/app.ts`, `services/api/src/http/schemas.ts` | Session and message routes, message idempotency, per-turn catalog/RAG/response orchestration; unchanged public JSON response |
| Catalog | `services/api/src/intent-catalog.ts`, `intent-catalog-xlsx.ts` | Published XLSX catalog, weighted signals (phrases/keywords/exclusions), score/confidence/ambiguity, slot and journey rules; optional `BusinessStages` plus other catalog extensions |
| Continuity | `services/api/src/intent-journey.ts`, `journey-engine.ts`, `conversation-state.ts` | Active intent, opportunity identity, pending requirement, fact/confirmation state and transition handling |
| Current model | `services/api/src/foundry/agent-client.ts`, `chat-model-adapter.ts`, `context.ts` | Named Foundry Agent client, AzureCliCredential, Conversations/Responses, v4 serving and v6 candidate, local agent version + hosted tool validation |
| Current function calling | `services/api/src/foundry-functions.ts` | Five read-only Foundry functions, bounded per-round tool calls and strict authorized lookups |
| Inference interface | `services/api/src/model.ts` | Existing `ChatModel` abstraction and deterministic fallback/normalization helpers |
| Retrieval | `services/api/src/knowledge.ts`, retrieval/search modules | Tenant/source-filtered PostgreSQL pgvector knowledge, citations and extractive fallback |
| Outbox/workflows | `services/api/src/actions.ts`, `events.ts`, `event-relay.ts`, `event-bus.ts`, `event-worker.ts` | Action proposals, transactional outbox, Redis Streams, worker→n8n, retries/reconciliation |
| Business lifecycle | `services/api/src/routes/lifecycle.ts` and lifecycle services | Package/quote/account/invoice/contract endpoints and guarded state; not all providers confirmed |
| Persistence | `services/api/src/store-postgres.ts`, `infra/postgres/001..054` | Durable tenant/session/journey/actions/business artifacts and Foundry conversation bindings |
| One-journey QA | `tools/qa/ancfz-single-journey.mjs` | One synthetic session, idempotency and some continuity assertions; stops at real provider blocker |
| Admin and web | `apps/admin`, `apps/web` | Existing Angular Admin and Next.js web chat; not redesigned by this task |
| Python | `tools/ingestion`, `tools/anc/pdf_service`, `tools/anc/payment_mock` | Ingestion/OCR/PDF/payment mock. **No dedicated GPT inference gateway** exists yet |

## Deficiencies versus target

1. **Wrong model service boundary:** current Node Foundry Agent SDK is not the proposed Python API-key model gateway. No private `/v1/model/normalize`, `/interpret` and `/compose` service or typed Node adapter.
2. **Intent-score semantics:** `intent-catalog.ts` derives `confidence = score / 100` from weighted keyword/phrase scores; this is a heuristic score, not a measured probability. The current engine has no **goal-first six-category taxonomy** and no **GPT-led adaptive conversation strategy** that weighs full conversation summary, requirements and competing business goals on every substantive turn. Model intent interpretations and signal evidence are not systematically fused/validated per turn. Cross-intent ambiguity needs explicit user selection.
3. **No dedicated User Intent Document:** current `conversation_state`, `intentProgress`, `journey_instances`, `journey_facts`, messages and audit are useful foundations but no independently versioned, reconstructible per-turn intent decision ledger exists with **primary Business Goal distinct from per-turn intent category**, LLM-generated structured conversation summary, candidate signal **and adaptive weight** evidence, confirmed goal, model provenance and cache invalidation guarantees.
4. **Normalization is conditional:** `app.ts` builds a deterministic query and gates model normalization on global/tenant flags for particular uncertain turns. Target: use a bounded AI normalization call when retrieval needs it, then cache and validate its facts, negation, tokens and source/tenant scope.
5. **Cost/latency:** app may perform separate model activities for composition/normalization. Need a per-turn budget, keyed memoization and reuse of structured results rather than redundant LLM requests.
6. **Action planning:** catalog `WorkflowBindings` and Node action path exist, but the current flow risks treating lead/CRM capture as the implicit primary goal. Named Foundry read-only function tools are separate from n8n writes. The new design must treat **CRM Lead capture as a conditional Service Execution capability**, not universal intent completion. Need a tenant-neutral catalog `ToolBindings`/action specification and server-side interpretation → user intent confirmation → prerequisite/consent → transactional outbox.
7. **One-question continuity:** pending requirements and source-grounded responses exist, but there is no unified invariant to guarantee one relevant follow-up after every successful grounded active-journey answer, especially through knowledge interruptions and stage handoff.
8. **Provider blocker:** latest documented v6 13-turn run created an eligible ActionRequest and dispatched local lead, then set `reconcile_required` without a verified Salesforce remote Lead. Qualification/Account/Package/Documents/Invoice/Contract were not completed in that run.
9. **Python retry/rate limits:** no Python GPT inference client exists for the proposed API key/deployment, thus no tested initial+3 retry/429/circuit-breaker policy in that layer.
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

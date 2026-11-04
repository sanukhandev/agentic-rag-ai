# Zara Conversation Engine Recovery — Root-Cause Analysis

## Failure ZARA-001 — formation knowledge answer rejected as `invalid_question`

- **Customer message:** `Tell me about company formation`
- **Expected behavior:** A relevant approved-knowledge answer; an optional follow-up may be suppressed if its metadata is invalid.
- **Actual behavior:** Generic guarded fallback; the public answer incorrectly implied the approved information could not be used.
- **Relevant branch/commit:** `fix/zara-conversation-engine-end-to-end-recovery` at baseline `ba1e29f9c79d2ac8214dce0fcd6f95aae7c6563f`.
- **Failing runtime component:** `services/api/src/v2-response-guard.ts`, then `services/api/src/v2-coordinator.ts`.
- **Actual failure code:** `invalid_question`; final fallback was selected.
- **Root cause (confirmed):** `questionFailure()` ran before evidence validation and returned a rejected whole-response verdict. The coordinator then treated the candidate as unusable instead of independently validating the factual answer and removing only the optional question.
- **Reproduction method:** Fresh public API session; diagnostic audit showed 4 prefetched excerpts and `invalid_question`.
- **Regression test:** `services/api/src/v2-response-guard.test.ts` — malformed optional question is suppressed while the grounded answer survives.
- **Correction:** Optional question validation is now independent; required question identity remains strict. The original question failure is retained as diagnostic metadata.
- **Unit/integration/Docker/Azure result:** Unit PASS; public Docker API PASS after correction; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; full acceptance remains open.

## Failure ZARA-002 — contextual formation follow-up rejected as `unsupported_claim`

- **Customer message:** `How does it work?` after a formation question.
- **Expected behavior:** Continue the formation topic using authorized evidence retrieved during the model tool loop.
- **Actual behavior:** Generic “cannot verify” fallback despite a successful `search_knowledge` call in the recorded trace.
- **Failing runtime component:** `services/api/src/v2-coordinator.ts`; evidence correlation/repair boundary.
- **Actual failure codes:** `unsupported_claim`; historical audit also recorded `claim_source_polarity_mismatch`.
- **Root cause (confirmed):** Grounding repair/independent review was gated by exact Node prefetch (`hasTrustedPrefetch`). Evidence returned by a successful correlated read tool was merged for citation checking but was not eligible for the same bounded repair/review path. The existing per-source polarity logic also evaluates source text at a broader boundary than the individual relevant clause in mixed-polarity excerpts.
- **Reproduction method:** Fresh/public and historical diagnostic rows; `search_knowledge` status `ok`, citations present in candidate trace, final evidence/fallback rejected.
- **Regression test:** `services/api/src/v2-coordinator.test.ts` — successful correlated read-tool evidence is eligible for one bounded repair; `v2-claim-provenance.test.ts` covers mixed-polarity source clauses.
- **Correction:** Trusted evidence now includes exact prefetch plus successful correlated read-tool evidence. Repair is source-bound; a bounded exact excerpt can be returned only when independent review is not active. Source polarity is evaluated against the relevant source clause.
- **Unit/integration/Docker/Azure result:** Focused tests PASS; public Docker contextual follow-up returns grounded cited text on repeated runs; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; retrieval quality and full evaluation remain open.

## Failure ZARA-003 — explicit initiation did not reach goal confirmation

- **Customer message:** `I want to start company formation`
- **Expected behavior:** Node validates observed formation intent and asks for explicit goal confirmation without creating a Lead.
- **Actual behavior:** Generic dialogue; no `pendingIntentKey`, pending requirement, or goal-confirmation record.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` and the final-response dependency in the coordinator.
- **Actual failure code:** Candidate final answer was rejected/replaced as `unsupported_claim`/`safe_no_evidence_dialogue`.
- **Root cause (confirmed):** `modelPlan` was read only when `result.guardReason` was `accepted`, `accepted_model_dialogue`, `accepted_entailment`, or `accepted_knowledge_repair`. A valid model planning proposal contained in the rejected candidate response was therefore discarded before Node catalog/evidence validation. The read tool was allowed to run, but it was not an authorization decision and could not create the goal.
- **Reproduction method:** Fresh public API session; `get_missing_requirements` returned `ok`; no goal confirmation was persisted.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` — rejected final answer with a valid candidate plan still creates a pending confirmation prompt and no action.
- **Correction:** Node now validates the candidate plan independently of final response acceptance and persists only catalog/evidence-validated proposals.
- **Unit/integration/Docker/Azure result:** Unit PASS; public Docker API creates `anc.company_formation` pending confirmation with no action; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; journey completion remains open.

## Failure ZARA-004 — refusal repeated the generic response

- **Customer message:** `No, not now`
- **Expected behavior:** Respect a refusal only if it answers an active confirmation prompt; otherwise continue naturally without inventing a rejection event.
- **Actual behavior:** The previous generic response was repeated.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` state boundary, downstream of ZARA-003.
- **Actual failure code:** `safe_no_evidence_dialogue`; no pending confirmation existed.
- **Root cause (confirmed):** Because the initiation turn did not persist `goalConfirmation.status=pending`, `classifyScopedGoalDecision()` had no scoped prompt to evaluate. The coordinator then produced another generic no-evidence dialogue and the controller persisted no refusal transition.
- **Reproduction method:** Two-turn fresh public API session; both turns returned the same generic response; the intent document had no goal key or confirmation record.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` covers scoped rejection and no action; public Docker API reproduced `No, not now` after the pending prompt.
- **Correction:** The public route no longer increments the session cursor before the atomic V2 turn commit; this preserves the prompt cursor and prevents false `V2_GOAL_CONFIRMATION_STALE` errors.
- **Unit/integration/Docker/Azure result:** Unit PASS; public Docker API PASS with cleared pending prompt and no action; three-run Azure evaluation NOT RUN.
- **Regression status:** FIXED at code/unit/public smoke boundary; full acceptance remains open.

## Additional confirmed baseline gap

The repository documentation explicitly marks the Python↔Node tool loop, final persona composer, full seven-stage provider verification, and live Azure acceptance as incomplete. These are not inferred from the four messages and remain separate acceptance gates after the focused corrections.

## Failure ZARA-005 — correlated package evidence was queried as a UUID source

- **Customer message:** `Show only officially approved package information.`
- **Expected behavior:** A truthful approved-package response or a specific published-data limitation; the public chat request must complete and persist.
- **Actual behavior:** HTTP 400 `INVALID_DATA` after 11 successful public turns in the existing 25-turn harness.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` citation resolution.
- **Actual failure code:** PostgreSQL `22P02`; database log: `invalid input syntax for type uuid: "tool-get_available_packages"`.
- **Root cause (confirmed):** Read-only tool evidence uses synthetic `tool-*` provenance and is trusted through the correlated tool trace. `resolvePublicCitations()` attempted to resolve that synthetic source reference through the PostgreSQL source table, whose identifier is a UUID.
- **Reproduction method:** `python tools/anc/acceptance/api_25_turns.py --api-base http://127.0.0.1:80 --tenant anc --scenarios 1`; first run stopped at turn 12 and PostgreSQL recorded the exact error.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` verifies tool evidence does not call `getSource()`.
- **Correction:** Public-source citation lookup now skips `tool-*` provenance while retaining the trusted tool evidence in the guarded response path.
- **Unit/integration/Docker/Azure result:** Focused controller suite 31/31 PASS; rebuilt Docker API; rerun public harness 25/25 turns and durable history PASS. Live three-run Azure evaluation remains NOT RUN.
- **Regression status:** FIXED for the reproduced public API path.

## Failure ZARA-006 — short structured ingestion evidence was discarded

- **Customer message:** `What is the XLSX plan?`
- **Expected behavior:** The local ingestion acceptance source (`XLSX approved 30`) should produce a grounded answer with its authorized citation.
- **Actual behavior:** `acceptance:local` returned a deterministic ungrounded abstention even though the source was published.
- **Failing runtime component:** `services/api/src/model.ts` deterministic grounded fallback.
- **Actual failure code:** No HTTP error; `grounded=false`, `citations=[]`.
- **Root cause (confirmed):** The fallback only selected prose fragments longer than 24 characters. XLSX extraction preserved the relevant table row as a short line, so no evidence sentence was eligible for composition.
- **Reproduction method:** `npm run acceptance:local`; direct model reproduction with `Plan Price\nXLSX approved 30`.
- **Regression test:** `services/api/src/model.test.ts` verifies a relevant short structured line is cited and returned.
- **Correction:** The deterministic fallback now admits a query-relevant, non-boilerplate structured line of at least 8 characters; unrelated short lines remain excluded.
- **Unit/integration/Docker/Azure result:** Model suite 21/21 PASS; `npm run acceptance:local` PASS. Latest Docker rebuild and live Azure three-run evaluation are pending this checkpoint.
- **Regression status:** FIXED for the local ingestion acceptance path.

## Harness mismatch ZARA-007 — stale combined contact prompt assertion

- **Observed test:** `npm run acceptance:seed`.
- **Expected by old harness:** The name response would ask for `email address or phone` together.
- **Actual contract:** Contact requirements are collected one at a time; the action gate requires both fields.
- **Correction:** `scripts/seed-local.mjs` now accepts either valid first contact prompt, supplies synthetic email and phone in separate turns, and retains the action confirmation/idempotency assertions.
- **Result:** Synthetic tenant A/B acceptance PASS.

## Failure ZARA-008 — confirmation grammar rejected natural approval

- **Customer message:** `Yes, let's proceed.` after a scoped company-formation confirmation prompt.
- **Expected behavior:** Confirm the proposed goal, initialize the authoritative journey, and continue without repeating the prompt.
- **Actual behavior:** The classifier returned `ambiguous`; the prompt was repeated.
- **Failing runtime component:** `services/api/src/conversation-state.ts`.
- **Actual failure code:** `ambiguous` scoped goal decision.
- **Root cause (confirmed):** The confirmation grammar accepted `Yes, proceed.` but not the natural contraction `let's proceed`.
- **Reproduction method:** Fresh public Docker session with `I want to open a company in Ajman.` followed by `Yes, let's proceed.`.
- **Regression test:** `services/api/src/conversation-state.test.ts` covers the exact contraction.
- **Correction:** Added bounded `let's proceed` / `let us proceed` confirmation forms; no consent or side effect is inferred.
- **Result:** Focused coordinator/state suites PASS; public confirmation persists `goalConfirmed=true` and creates no action.

## Failure ZARA-009 — invalid journey citation erased safe continuity

- **Customer message:** `My business is technology consulting.` or `I need two visas.` after confirmed formation.
- **Expected behavior:** Preserve independently verified facts and return a safe persona acknowledgement when a non-knowledge citation is invalid.
- **Actual behavior:** `invalid_citation` could fall through to the generic “cannot verify” response, despite Node persisting the fact.
- **Failing runtime component:** `services/api/src/v2-coordinator.ts`.
- **Actual failure code:** `invalid_citation` / `unsupported_claim` on a non-factual journey statement.
- **Root cause (confirmed):** Factual citation recovery and non-factual journey dialogue shared the same terminal fallback.
- **Reproduction method:** Fresh public Docker session; audit showed a candidate citation while the intent document retained the visitor fact.
- **Regression test:** `services/api/src/v2-coordinator.test.ts` covers an unavailable citation on a verified customer fact.
- **Correction:** Bounded journey-shaped, non-knowledge statements now discard the bad citation and use guarded non-factual acknowledgement; knowledge and provider/action claims remain strict.
- **Result:** Coordinator suite PASS; public smoke returns safe acknowledgements and preserves state.

## Failure ZARA-010 — V2 package reads used the legacy catalog UUID column

- **Customer message:** `Show me packages.`
- **Expected behavior:** Read approved package offerings scoped to the session-pinned Catalog V2 publication, or state specifically that no approved offerings are published.
- **Actual behavior:** The V2 package tool queried `package_offerings.catalog_version_id` with the V2 publication UUID. That column is a legacy `intent_catalog_versions` foreign key, so V2 offerings could not be represented or returned safely.
- **Failing runtime component:** `services/api/src/store-postgres.ts` and `services/api/src/v2-tool-gateway.ts`.
- **Actual failure code:** No customer-visible exception; the read was an empty/not-published result even when a correctly versioned V2 offering could not be stored. The development database currently has zero approved offerings, so no price was fabricated.
- **Reproduction method:** PostgreSQL inspection showed active Catalog V2 `b63b931f-0713-4d18-bcea-88621bd1b5ed`, legacy-only package identity, and zero ANCFZ offerings; the V2 gateway passed the V2 UUID to the legacy filter.
- **Regression test:** `services/api/src/v2-tool-gateway.unit.test.ts` stores a package with a canonical V2 ref and retrieves it through `get_available_packages`; `store-memory.test.ts` verifies ref scoping; `v2-catalog-identity.test.ts` verifies migration 059.
- **Correction:** Added `catalog_v2_version_ref`, tenant-scoped FK/check constraint, store support for V2 refs, and V2 gateway filtering by `catalogVersionRef`.
- **Unit/integration/Docker/Azure result:** 23 focused tests PASS; API typecheck PASS; migration 059 applied and constraints verified in PostgreSQL; API Docker rebuild and health check PASS; live pricebook/Azure/Salesforce acceptance remains unverified.
- **Regression status:** FIXED for catalog identity; the later development-only V2 fixture removes the local empty-catalog condition without claiming official pricing.

## Failure ZARA-016 — V2 customer package routes resolved only legacy catalog UUIDs

- **Customer message:** `Show me packages.` followed by a package selection or quotation request.
- **Expected behavior:** Customer-facing package listing, selection and deterministic quote creation must use the session-pinned Catalog V2 publication and reject offerings from another revision.
- **Actual behavior:** `business-lifecycle.ts` passed `conversationState.catalogVersionId` to the legacy UUID filter. A V2 session therefore could retrieve packages through `v2-tool-gateway.ts` but receive an empty list or cross-boundary selection failure through lifecycle routes.
- **Failing runtime component:** `services/api/src/business-lifecycle.ts`.
- **Actual failure code:** Empty V2 package result; direct selection/quote paths had no canonical V2 identity check.
- **Reproduction method:** A MemoryStore session pinned to a V2 version ID with an offering stored under `catalog_v2_version_ref` returned `[]` before the fix.
- **Regression test:** `services/api/src/business-lifecycle.test.ts` now covers V2 listing, verified-account gating, selection and deterministic quote creation.
- **Correction:** Resolve the V2 version ID to its canonical ref for reads and require the selected offering to match the pinned tenant/catalog identity.
- **Unit/integration/Docker/Azure result:** Focused lifecycle suite 3/3 PASS; typecheck PASS; migration 060 and PostgreSQL verification PASS; live official pricebook/Salesforce/Azure acceptance remains unverified.
- **Regression status:** FIXED for the local V2 package/lifecycle boundary; full customer-facing quote journey remains unverified.

## Failure ZARA-011 — V2 contact facts were not connected to the catalog cursor

- **Customer messages:** synthetic name, email and contact-consent turns after confirmed company formation.
- **Expected behavior:** Persist masked contact facts under the approved requirement keys, ask for consent, then ask for explicit Lead submission confirmation.
- **Actual behavior:** The earlier public path discarded contact fields from V2 verified facts and repeated generic or model-safety responses; the requirement remained `lead_contact_channel`/`lead_crm_consent`.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts`.
- **Actual failure code:** `safe_no_evidence_dialogue` / `unsupported_claim` on wording, with no independent contact-state transition.
- **Root cause (confirmed):** V2 planning exposed only non-PII business facts and never projected Node’s masked contact tokens into `lead_contact_name`/`lead_contact_channel`; consent was likewise not advanced independently of model wording.
- **Reproduction method:** Fresh public Docker session through `/api/v1/chat/messages`; PostgreSQL inspection of `user_intent_documents` and `intent_turn_assessments`.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` contact-cursor test; `conversation-state.test.ts` covers `Yes, let us proceed.`.
- **Correction:** Node-side masked contact extraction, durable catalog-keyed fact patches, contact cursor advancement and bounded verified contact acknowledgements. Action authorization remains separate and disabled by the published development binding.
- **Unit/integration/Docker/Azure result:** 51/51 focused tests PASS; API full suite 476/476 PASS; public Docker contact smoke PASS through consent and `lead_action_confirmation`; Azure/Salesforce live acceptance NOT RUN.
- **Regression status:** FIXED at masked contact persistence/public smoke boundary; full Lead/provider journey remains unverified.

## Failure ZARA-012 — V2 contact completion had no catalog-gated Lead proposal boundary

- **Customer message:** `Please create my Lead` after confirmed formation, contact details and contact consent.
- **Expected behavior:** Preserve the confirmed goal and verified contact facts, then create a purpose-authorized awaiting-confirmation proposal only when the published Catalog V2 binding and explicit request permit it.
- **Actual behavior:** The V2 controller completed the contact cursor but did not project enabled action bindings or call the existing Node action gate.
- **Failing runtime component:** `services/api/src/v2-turn-controller.ts` and the Python/Node V2 catalog projection.
- **Actual failure code:** No provider error; the action boundary was absent from this path.
- **Root cause (confirmed):** The planner envelope exposed only enabled read tools, while V2 turn handling had no handoff from an explicit Lead request to the existing consent/idempotency gate.
- **Reproduction method:** In-memory V2 catalog fixture with Lead bindings enabled; complete goal, contact and consent requirements, then submit an explicit Lead request with a `propose_action` plan.
- **Regression test:** `services/api/src/v2-turn-controller.test.ts` — `creates a catalog-gated Lead proposal only after contact consent and an explicit submission request`.
- **Correction:** Project enabled action keys for planning, validate the binding and explicit request in Node, and route the request through `proposeV2CatalogAction`; no Python or model output can dispatch a provider write.
- **Unit/integration/Docker/Azure result:** Regression PASS; API full suite 477/477 PASS; Docker build PASS; live Salesforce/Azure result NOT RUN.
- **Regression status:** FIXED for the proposal boundary; provider execution and readback remain externally blocked.

## Failure ZARA-013 — V2 approved actions could not reach the n8n claim boundary

- **Customer-visible impact:** A confirmed V2 Lead proposal could be approved locally, but the outbox/action-claim path only resolved legacy Catalog V1 UUID bindings.
- **Expected behavior:** Route a V2 action by its pinned canonical catalog reference, require a catalog-declared n8n identity, and return only Node-authorized masked payload data.
- **Actual behavior:** V2 action refs were treated as legacy catalog UUIDs; PostgreSQL could reject the lookup or return no claim, and the V2 workflow templates could not safely identify their binding.
- **Root cause (confirmed):** V2 `WorkflowBindings` had no transport identity fields and `event-bus`/claim stores queried only `intent_catalog_versions`.
- **Correction:** Added optional reviewed transport fields, V2 route resolution, memory/PostgreSQL claim support and a fail-closed bridge test. The current ANCFZ publication remains disabled/unbound.
- **Regression status:** FIXED at the Node dispatch/claim boundary; provider evidence and Salesforce readback remain blocked.

## Failure ZARA-014 — V2 provider contracts rejected canonical catalog references

- **Customer-visible impact:** A valid V2 action using the pinned `anc:r2:<hash>` catalog reference could reach the claim boundary but could not be represented by the Lead, document, account or quote provider contracts, which still required a UUID.
- **Root cause (confirmed):** Provider-specific Zod schemas duplicated a legacy UUID constraint instead of using the canonical V2 catalog identity contract.
- **Correction:** Added one shared canonical-reference schema and applied it to the V2 Lead, document, account and package provider request/result contracts.
- **Regression:** Canonical reference parsing and all affected provider suites PASS.

## Failure ZARA-015 — trusted evidence was validated but terminal transition still rejected it

- **Customer-visible impact:** The new evidence boundary could validate a deterministic provider record, but the shared V2 transition helper rejected every terminal completion before persisting the verified result.
- **Root cause (confirmed):** `evaluateV2CallbackStageCompletion` intentionally denied all V2 `completed` transitions and had no explicit input for a separately validated provider readback.
- **Correction:** Added an explicit trusted-evidence flag passed only by the evidence route after exact deterministic validation. Ordinary callbacks and unverified Salesforce results remain fail-closed.
- **Regression:** Deterministic mock route completes the action and links the local Lead; Salesforce route enters `reconcile_required` without creating a Lead.

## Failure ZARA-017 — V2 Account conversion used legacy policy and transport identity

- **Customer-visible impact:** A V2 journey with a catalog-declared Account capability could not reach the Account proposal boundary because the lifecycle helper searched only legacy `crmAccountConversionPolicies` rows; if it did reach the route, the route would still emit legacy `crm.account.convert` / `account.registration` identity.
- **Expected behavior:** Resolve the enabled V2 `account.propose_creation` tool and its enabled `crm.account.create` workflow binding, preserve the canonical V2 catalog reference, and remain fail-closed when the binding is disabled or the provider transport is unavailable.
- **Actual behavior:** V2 sessions returned `ACCOUNT_CONVERSION_NOT_CONFIGURED` even when an enabled V2 binding was present in the pinned catalog.
- **Failing runtime components:** `services/api/src/business-lifecycle.ts` and `services/api/src/routes/lifecycle.ts`.
- **Actual failure code:** `ACCOUNT_CONVERSION_NOT_CONFIGURED`.
- **Root cause (confirmed):** The lifecycle route predated Catalog V2 and treated Account conversion as a legacy policy/workflow concern. It did not resolve V2 tool/workflow bindings or carry `catalogVersionRef` into the action.
- **Reproduction method:** A MemoryStore V2 catalog with the Account tool/workflow enabled, a qualified synthetic Lead and a pinned V2 session failed before the fix with `ACCOUNT_CONVERSION_NOT_CONFIGURED`.
- **Regression test:** `services/api/src/business-lifecycle.test.ts` enables the fixture binding and verifies a pending Account proposal from a qualified Lead; legacy conversion coverage remains in the same suite.
- **Correction:** Added one shared V2/legacy binding resolver. V2 permits only the qualification-verified Account stage, requires an enabled catalog tool and workflow with a webhook path, and emits the canonical catalog reference; the real ANCFZ disabled binding still fails closed.
- **Unit/integration/Docker/Azure result:** Focused lifecycle suite 4/4 PASS; API full suite 61 files / 485 tests PASS; lint/typecheck/build PASS; API Docker rebuild and public health/package smoke PASS; Salesforce, n8n and Azure acceptance remain unverified.
- **Regression status:** FIXED for the V2 lifecycle identity boundary; provider Account execution/readback and full seven-stage completion remain unverified.

## Failure ZARA-018 — natural formation phrase was rejected by independent intent evidence

- **Customer message:** `Hello, I want to set up a business.`
- **Expected behavior:** Recognize a potential formation goal and ask for explicit confirmation without creating a record.
- **Actual behavior:** The GPT proposal used `signal.company.setup`, but Node rejected it as `unobserved_signal, insufficient_evidence` because the published ANCFZ catalog did not contain the exact natural alias.
- **Failing runtime component:** `services/api/src/v2-intent-evidence.ts` and the published Catalog V2 revision.
- **Root cause (confirmed):** Independent evidence validation intentionally observes only catalog-declared signal values/aliases. The live revision contained related phrases but not `set up a business`; this was a catalog coverage defect, not a reason to weaken Node validation.
- **Correction:** Added the reviewed alias to the fixture and published immutable development revision 3 through `infra/postgres/061-anc-natural-formation-aliases.sql`. Existing sessions remain pinned to their prior revision.
- **Evidence:** Fresh public Docker session reached `I can help with company formation. Would you like to proceed with company formation?`; the refusal turn cleared the pending prompt without an action.
- **Regression status:** FIXED for the observed natural-formation phrase; unseen synonym coverage and the full journey remain open.

## Failure ZARA-019 — mixed FAQ chunks polluted broad formation answers

- **Customer messages:** `Tell me about company formation` and contextual `How does it work?`
- **Expected behavior:** Return a relevant source-backed formation explanation, not an unrelated document-list note or generic fallback.
- **Actual behavior:** Retrieval returned mixed FAQ chunks; the model could select a document caveat or a visa/provider-style statement. Claim validation then rejected the response as `claim_source_polarity_mismatch` or `single_source_support_not_established`, and bounded repair sometimes had no acceptable citation.
- **Failing runtime components:** `services/api/src/knowledge.ts`, `services/api/src/v2-knowledge-preflight.ts`, `services/api/src/v2-claim-provenance.ts`.
- **Root causes (confirmed):** Broad process ranking did not sufficiently down-rank unrelated visa/document material; query-aware projection returned the original chunk when all retained sentences were document-only; and modal source language such as `can be completed` was classified as an actual completed provider/customer outcome.
- **Correction:** Added measured formation ranking/visa penalty, query-aware sentence projection, document-only fallback suppression, and modal-language handling in the outcome detector. Actual customer completion claims remain strict and require verified provider evidence.
- **Regression tests:** `knowledge.test.ts`, `v2-knowledge-preflight.test.ts`, `v2-claim-provenance.test.ts`, and `v2-coordinator.test.ts`.
- **Evidence:** Final Docker replay returned the exact approved sentence `Company registration and licence issuance can be completed in as little as 2 hours, provided all required documents are in order.` with a citation for both formation turns. The answer remains narrow because the source corpus does not expose a complete reviewed step-by-step procedure in the retrieved evidence.
- **Regression status:** Core fallback cascade FIXED; answer completeness and formal Azure quality remain unverified.

## Failure ZARA-020 — identical authorized evidence projections were treated as a security conflict

- **Customer impact:** A live Azure-backed 25-turn run returned HTTP 500 `INTERNAL_ERROR` at turn 21 even though the same authorized citation had been retrieved through Node prefetch and a successful read-only tool.
- **Failing runtime component:** `services/api/src/v2-coordinator.ts` evidence merge boundary.
- **Actual failure code:** `V2_EVIDENCE_CONFLICT`.
- **Root cause (confirmed):** The merge identity compared the full projected text. Query-aware evidence projection legitimately produces different text slices for the same citation/source/version, so a text-only difference was incorrectly treated as a provenance conflict.
- **Reproduction method:** `python tools/anc/acceptance/api_25_turns.py --api-base http://127.0.0.1:80 --tenant anc --origin http://localhost --scenarios 1`; intermediate artifact `artifacts/ancfz/azure-eval-postfix-run-3.json` failed at turn 21. The audit recorded matching authorized citation identity and `V2_EVIDENCE_CONFLICT`.
- **Regression test:** `services/api/src/v2-coordinator.test.ts` verifies that a trusted tool's different text projection does not replace Node-prefetched text or fail the turn.
- **Correction:** Evidence conflict now compares citation ID, source reference, source version and authorization/revocation state. Node-prefetched evidence remains authoritative text; mismatched identity still fails closed.
- **Verification:** Focused coordinator suite 51/51 PASS; API suite 61 files / 495 tests PASS; three fresh final Azure-backed public runs each completed 25/25 turns with 25 durable user messages.
- **Regression status:** FIXED for the reproduced public path; formal conversation-quality scoring, Salesforce and full seven-stage acceptance remain unverified.

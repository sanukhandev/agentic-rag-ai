# Acceptance — one continuous intent-driven seven-stage journey

**Status: TARGET; not yet passed.** The goal is **one reliable ANCFZ company-formation conversation**, with GPT as the **primary dialogue planner**, not 25 turns, 200 messages, a fixed number of tool calls or forced CRM leads. The engine remains reusable for other tenants and **knowledge-only** intents through published catalog/configuration.

## Conversation Engine v2 acceptance authority

Required component-level tests and traceability are in [conversation-engine-evaluation.md](conversation-engine-evaluation.md). **Seven logical components are one system**, not seven independently deployed model agents. Before passing a full ANCFZ test, prove published tenant persona on **every** customer reply, pre-response Python↔Node read tools, Node guard, durable session and per-turn ledger, catalog v2 stage-scoped gating, replay/idempotency, source-backed facts and accurate asynchronous provider statuses.

**Acceptance distinctions:** `CONVERSATION_ENGINE_VERIFIED` does not imply Salesforce/provider stages complete; `SEVEN_STAGE_SIMULATED` uses labeled mocks; `SEVEN_STAGE_PROVIDER_VERIFIED` requires actual provider acknowledgments. A final claim of legally registered company needs separate registration proof. No one may mark acceptance green based only on model text, a completed CRM Lead, HTTP 2xx, n8n success or signed-URL generation.

## Preconditions

- A private Python GPT model gateway is deployed and authenticated to an approved Azure OpenAI model deployment via API key. Verify exact deployment name, Responses API availability, quotas and retry configuration.
- The existing Node Chat API response contract remains unchanged; existing tenant/admin policies and data are intact.
- A published, session-pinned **tenant persona** and approved fallback templates are configured before Python planning. ANCFZ uses Zara only if its tenant selected her. Every customer-visible message must pass **Python Persona Response Composer → Node Response Guard** or **approved persona template → guard**.
- ANCFZ published catalog includes reviewed **Business Goals, six turn-intent categories, intent phrases/keywords/exclusions, weight policies, requirement prompts, seven ordered company-formation stages, verified completion criteria, and allowed tool/workflow bindings**. No shared code contains ANCFZ-specific conditions.
- Authorized sandbox/mocks for Salesforce, OCR/SF-02, invoicing, payment and contract are labeled explicitly; real payment and legally binding signing require separate consent/approval.

## One run, one customer, one session, one opportunity

Drive the **real Next.js/Node API** and the private Python model service rather than calling internal classifiers alone. Start with unique synthetic customer data; record session/opportunity ID hashes, pinned catalog version and User Intent Document revision. On every substantive turn verify stored classification assessment, cache key/hit, source evidence, intent status and pending question.

1. Initial company setup: GPT reads catalog and running summary, proposes evidence-backed weights and the primary **company-formation Business Goal**, recognizes its current turn category, then asks one natural goal confirmation. Store LLM suggested and Node-accepted weights, competing candidates and the confirmed goal **separately from CRM contact/consent**.
2. Lead Generation: collect required contacts/consent, separate action approval, run Node outbox→n8n and prove remote Salesforce Lead or stop with exact blocker.
3. Lead Qualification: ask only catalog-required questions, collect multiple explicit facts where safe; knowledge interruption must produce grounded citations **and one pending follow-up**, with no loss of intent. Correct a fact and verify invalidation and state revision.
4. Account Creation: only after successful qualification, verified Lead identity and appropriate customer confirmation; verify Account/Contact/Opportunity relationships.
5. Package Selection: retrieve eligible published package/price and quote, confirm customer choice and persist version/revision.
6. Document Upload: secure upload, OCR/review and verified **SF-02** record association.
7. Payment Details & Invoice: approved quote/billing/invoice; separately report real/mock payment; no card credentials.
8. Contract: authorized template/provider flow, verified document/signature if claiming signed; end with a truthful summary.

## Required resilience and negative tests

- Every grounded active-journey answer has exactly **one LLM-selected, relevant, non-repeated follow-up question** from the allowed catalog requirements; never invent one in error/closed/opt-out state. The LLM decides whether clarification, a fact, document, contact, status, or next permitted action is most helpful.
- A **knowledge-only customer** receives RAG-grounded advice and a helpful optional follow-up with **zero automatic Lead/CRM actions**. Completed Business Goal receives verified summary and **an offer of further help**; no repeated personal-information request.
- A requirement-dependent customer is asked for a document or contact detail **only when the catalog requires it**; the model preserves the current goal across knowledge questions and a fact correction.
- Duplicate clientMessageId returns original persisted response with **zero additional GPT/n8n calls**; modified payload under same key rejected.
- One knowledge interruption, one fact correction, one API restart, an intent ambiguity, a user-confirmed intent change/new opportunity and a delayed callback.
- Model 429 with Retry-After and success within up to three retries; persistent 429/5xx exhausts initial+3 and returns typed `MODEL_UNAVAILABLE` with no fake fact/action. Test 400/401 no-retry and budget/circuit breaker.
- Two tenant-scoped sessions with different catalogs; no cross-tenant candidate cache, RAG, opportunity or provider reference.
- Catalog republish does not change an active pinned opportunity; source revocation prevents answering from the revoked source.
- A Salesforce/n8n timeout yields reconciliation, not duplicate write or stage completion.
- Caller cannot override tenant/session/opportunity, execute arbitrary tool keys or skip confirmation/consent by prompt injection.

## Blocking persona-response and Node-tool-loop acceptance

- Across the **entire seven-stage continuous conversation**, verify every message (greetings, knowledge, qualification, contact/document collection, action confirmations, pending/reconciliation, failure, completion and handoff) follows the pinned tenant assistant name, natural tone and permitted language without repeatedly introducing itself.
- When more knowledge is required, verify **Python requests scoped Node tools before final response**, receives correlated RAG/catalog/package/journey/status results and then generates a **persona-composed final answer** supported by cited evidence.
- Node Response Guard must reject raw tool/model JSON, internal intent/confidence keys, prompt/trace IDs, unsupported prices/policies, wrong persona/language, invented provider completion, repeated irrelevant questions and ungrounded citations.
- When RAG evidence is unavailable, the assistant responds with honest uncertainty and a legitimate next question in the tenant persona, **not automatic Lead capture**. Knowledge-only customers must not be pushed into CRM.
- Model outage/429, invalid structured output, missing tool, provider reconciliation and consent denial must produce an accurate **versioned offline persona fallback** or legitimate pre-session transport error, not a model-generated claim of success.
- After a session restart, cached response replay and mid-session persona publication, the same personaVersionId remains effective unless a validated explicit migration occurs.
- A **second tenant** with different published assistant name/style/language must never receive Zara's voice or template. Malicious user/RAG prompt injection must not change the persona.
- Review labeled human-quality scenarios for contextual acknowledgment, concise/natural prose, relevant non-repetitive follow-up and accurate status; distinguish **passing technical invariants** from qualitative voice review.
- Do not report full seven-stage acceptance unless these persona-and-tool checks pass as well as business-stage provider checks. Design/specification alone is **not** runtime verification. Full spec: [persona-response-contract.md](persona-response-contract.md), [agent-tool-loop.md](agent-tool-loop.md).

## Stage acceptance evidence

For **each** stage, report `stageKey`, catalog-version, input turn hashes, requirement keys, primary intent confirmed, action/confirmation references, durable stage state before/after, model calls/cache hits, n8n workflow/execution reference, provider ID/acknowledgment and callback verification. Do not join separate sandbox runs and claim a single completed journey.

Success categories:
- `SEVEN_STAGE_PROVIDER_VERIFIED` — all applicable real/sandbox provider completions verified and accurately labeled.
- `SEVEN_STAGE_SIMULATED` — full sequence completed only with explicit mock providers.
- `CONVERSATION_INTENT_AND_TOOLS_VERIFIED_INTEGRATIONS_BLOCKED` — conversation/model/intent flow correct but external gate not proven.
- `PARTIAL` or `BLOCKED` with exact first failing boundary.

Tests must reflect **actual** available infrastructure; no fixed turn-count benchmark. Update `current-state.md` and store redacted reports under `docs/verification/` or generated `artifacts/`.

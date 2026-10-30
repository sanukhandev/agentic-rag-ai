# Acceptance — one continuous intent-driven seven-stage journey

**Status: TARGET; not yet passed.** The goal is **one reliable ANCFZ conversation**, not 25 turns, 200 messages or a fixed number of Foundry tool calls. The engine must remain reusable for another tenant via published catalog/configuration.

## Preconditions

- A private Python GPT model gateway is deployed and authenticated to an approved Azure OpenAI model deployment via API key. Verify exact deployment name, Responses API availability, quotas and retry configuration.
- The existing Node Chat API response contract remains unchanged; existing tenant/admin policies and data are intact.
- ANCFZ published catalog includes reviewed intent signals, confirmation prompt, validated requirements, seven active ordered stages and allowed tool/workflow bindings. No shared code contains ANCFZ-specific conditions.
- Authorized sandbox/mocks for Salesforce, OCR/SF-02, invoicing, payment and contract are labeled explicitly; real payment and legally binding signing require separate consent/approval.

## One run, one customer, one session, one opportunity

Drive the **real Next.js/Node API** and the private Python model service rather than calling internal classifiers alone. Start with unique synthetic customer data; record session/opportunity ID hashes, pinned catalog version and User Intent Document revision. On every substantive turn verify stored classification assessment, cache key/hit, source evidence, intent status and pending question.

1. Initial company setup: correctly rank candidate intents and ask one intent confirmation. On confirmation, persist primary intent and its evidence separately from contact/CRM consent.
2. Lead Generation: collect required contacts/consent, separate action approval, run Node outbox→n8n and prove remote Salesforce Lead or stop with exact blocker.
3. Lead Qualification: ask only catalog-required questions, collect multiple explicit facts where safe; knowledge interruption must produce grounded citations **and one pending follow-up**, with no loss of intent. Correct a fact and verify invalidation and state revision.
4. Account Creation: only after successful qualification, verified Lead identity and appropriate customer confirmation; verify Account/Contact/Opportunity relationships.
5. Package Selection: retrieve eligible published package/price and quote, confirm customer choice and persist version/revision.
6. Document Upload: secure upload, OCR/review and verified **SF-02** record association.
7. Payment Details & Invoice: approved quote/billing/invoice; separately report real/mock payment; no card credentials.
8. Contract: authorized template/provider flow, verified document/signature if claiming signed; end with a truthful summary.

## Required resilience and negative tests

- Every grounded active-journey answer has exactly **one relevant, non-repeated follow-up question**; never invent a question in error/closed/opt-out state.
- Duplicate clientMessageId returns original persisted response with **zero additional GPT/n8n calls**; modified payload under same key rejected.
- One knowledge interruption, one fact correction, one API restart, an intent ambiguity, a user-confirmed intent change/new opportunity and a delayed callback.
- Model 429 with Retry-After and success within up to three retries; persistent 429/5xx exhausts initial+3 and returns typed `MODEL_UNAVAILABLE` with no fake fact/action. Test 400/401 no-retry and budget/circuit breaker.
- Two tenant-scoped sessions with different catalogs; no cross-tenant candidate cache, RAG, opportunity or provider reference.
- Catalog republish does not change an active pinned opportunity; source revocation prevents answering from the revoked source.
- A Salesforce/n8n timeout yields reconciliation, not duplicate write or stage completion.
- Caller cannot override tenant/session/opportunity, execute arbitrary tool keys or skip confirmation/consent by prompt injection.

## Stage acceptance evidence

For **each** stage, report `stageKey`, catalog-version, input turn hashes, requirement keys, primary intent confirmed, action/confirmation references, durable stage state before/after, model calls/cache hits, n8n workflow/execution reference, provider ID/acknowledgment and callback verification. Do not join separate sandbox runs and claim a single completed journey.

Success categories:
- `SEVEN_STAGE_PROVIDER_VERIFIED` — all applicable real/sandbox provider completions verified and accurately labeled.
- `SEVEN_STAGE_SIMULATED` — full sequence completed only with explicit mock providers.
- `CONVERSATION_INTENT_AND_TOOLS_VERIFIED_INTEGRATIONS_BLOCKED` — conversation/model/intent flow correct but external gate not proven.
- `PARTIAL` or `BLOCKED` with exact first failing boundary.

Tests must reflect **actual** available infrastructure; no fixed turn-count benchmark. Update `current-state.md` and store redacted reports under `docs/verification/` or generated `artifacts/`.

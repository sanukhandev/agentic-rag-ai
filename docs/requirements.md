# Current target requirements — tenant-configurable conversational journey

**Status: TARGET, not current implementation.** Acceptance tenant is ANCFZ only. The product continues to be reusable for any tenant; no tenant slug, catalog intent, stage list, workflow or prompt is hardcoded in shared services. The generic engine derives all decisions from the tenant's **published and pinned** catalog.

## Business objective

A customer should be able to ask open-ended questions, receive approved RAG-grounded answers, and naturally progress through a **single confirmed primary intent** and every published stage/requirement to an independently verified terminal outcome. The assistant follows the active intent even when the customer digresses or corrects facts. It never jumps stages based solely on a model sentence.

## Conversation contract

- Interpret each substantive user turn against current catalog phrases, keywords, negative signals, relations and approved synonyms/normalizations. Do not claim confidence from pure model self-rating.
- For every active-journey grounded answer, include **one contextually relevant next question** generated from the authoritative pending requirement or a purposeful next-step confirmation. Do not ask multiple questions or repeat confirmed facts. On blocked/error/completed/opt-out, provide a truthful next action rather than an artificial question.
- Maintain one active primary intent per opportunity. Keep secondary candidates but ask an explicit clarification when ambiguous; **confirm the intent in user-visible language** before commencing intent-specific requirements/workflow proposals. Intent confirmation is separate from consent and final action confirmation.
- Collect slots progressively with schema validation, extract multiple facts when safely explicit, respect corrections and provenance, and recompute invalidated downstream decisions when facts change.
- Knowledge interruption: answer with approved citations; preserve current intent, stage, pending question and opportunity identity.
- Durable resume: duplicate `clientMessageId` returns the same saved response; after API restart or new worker the same session/opportunity/intent document is loaded. Delayed provider callbacks reconcile to the correct tenant/opportunity/action revision.
- Session history and an explicit **User Intent Document** are stored durably; classification assessment and normalized retrieval tokens on **every substantive intent-evaluation turn** have stable lineage and cache/replay semantics.
- When knowledge lacks evidence, abstain rather than inventing prices, regulations, visa rules, package data or timelines.

## ANCFZ acceptance stage contract (configurable catalog data)

| Order | Stage | Core gate / verified evidence |
| --- | --- | --- |
| 1 | Lead Generation | Contact requirements and purpose-specific consent, confirmed Lead action, remote Salesforce Lead verified |
| 2 | Lead Qualification | Catalog-required activity, entity, visas, timeline, budget etc. **only if published**, deterministic qualification verdict |
| 3 | Account Creation | Qualified Lead, customer verification/confirmation, Salesforce Account and associated Contact/Opportunity and Lead identity |
| 4 | Package Selection | Eligible published package, approved pricebook/quote, customer confirmation |
| 5 | Document Upload | Secure source, consent, document types from catalog, OCR/review, **SF-02** CRM association |
| 6 | Payment Details & Invoice | Quote-linked invoice artifact/provider evidence, separate payment/mock status |
| 7 | Contract | Approved template, correct associations and verified provider contract/signature status |

Stage transitions happen only after server-side completion gates, not at the model's request. The model may ask about a later stage or answer a grounded general question, but the active requirement remains until fulfilled.

## Tool and workflow behavior

- Published catalog defines tool capability, bound workflow, input contract, required facts/consent, allowed stage, confirmation policy, timeout/retry classification, callback verification and next transition.
- Inference may propose a catalog key and sanitized tool arguments; Node independently validates tenant/session/opportunity and published binding, confirms user intent, verifies requirements, obtains consent and **separately confirms side effects**. All state-changing tool calls go via Node ActionRequest → outbox → Redis worker → private n8n. Read-only Node lookups are not external writes.
- No arbitrary n8n URL or workflow key from the model. No direct model-to-Salesforce, payment, contract or tenant-data access.
- External acknowledgment and provider identity are mandatory for a remotely completed stage; fallback to reconciliation when ambiguous.

## Platform commitments

Preserve Angular Admin, Next.js web chat, platform/tenant roles, source approval, persona language/tone publishing, per-tenant catalog versioning, API contracts, tenant isolation, provenance, audit, ingestion and embeddings. Other tenants and future channels use the same engine and validated contracts. Python is an internal inference service only.

## Model and privacy scope

Use a configured GPT deployment via Azure OpenAI/Foundry Models Responses API with Python API-key authentication; do not use the saved Foundry agent during this target phase. Use synthetic data and avoid new PII-filter feature development for now. **Keep** existing tenant isolation, auth, vault, consent, minimization and secure logging; do not ship real-customer use without renewed privacy review. Credential never leaves the private Python container.

## Acceptance meaning

One continuous journey is the primary end-to-end test; follow-up questions, tool proposals and provider states must be verified by persisted evidence. No arbitrary 25-turn, 200-message or local-commit target. A mocked/sandboxed journey is clearly labeled; real provider completion requires actual acknowledgments. Tests for ambiguity, retries/rate limits, action dedupe, cache invalidation, security and restart remain mandatory.

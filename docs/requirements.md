# Current target requirements — tenant-configurable conversational journey

**Status: TARGET, not current implementation.** Acceptance tenant is ANCFZ only. The product continues to be reusable for any tenant; no tenant slug, catalog intent, stage list, workflow or prompt is hardcoded in shared services. The generic engine derives all decisions from the tenant's **published and pinned** catalog.

## Business objective and intent hierarchy

The **customer's business outcome is the primary intent**, not a Salesforce Lead. A tenant catalog can define multiple business goals, knowledge-only services, follow-up requirements and authorized workflow capabilities. The LLM is the **conversation master**: on each substantive turn, it interprets the bounded conversation summary and catalog, identifies the current turn's intent category, proposes goal candidates and context-sensitive weights, chooses the next move and formulates a useful question. Node validates all proposals against the published catalog and existing authorization/consent before storing facts or dispatching actions.

Use six categories defined in [Intent taxonomy](intent-taxonomy.md): **Business Goal**, **Knowledge & Advisory**, **Qualification & Requirement**, **Service Execution**, **Service Status & Support**, and **Conversation Navigation**. These are **not six competing primary intents**; knowledge and requirements can be sub-intents serving one persistent business goal. CRM Lead creation is a supporting `ToolBinding` and never the forced primary intent.

## Conversation requirements

- **Per-turn comprehension:** Feed the LLM a concise current catalog digest (approved goals, descriptions, phrases, keywords, exclusions, requirements and capabilities), durable User Intent Document, existing question/answer summary, verified facts, corrections, stage status and pending requirements. Have it label each substantive turn and persist its reasoned decision.
- **Intelligent weighting:** The LLM suggests which signals and prior responses are relevant and how to weight them **within catalog policy bounds**; Node validates and persists the effective evidence score, confidence band, ambiguity margin and provenance. Goal identification confidence is **distinct** from missing-requirement coverage and deterministic action eligibility.
- **Intent discovery:** The LLM may decide to clarify an ambiguous goal, confirm a high-confidence goal, answer a knowledge question, collect a business requirement, request a document, ask for personal/contact details *only when required by the selected intent*, check status, request permitted action confirmation or complete the goal. Ask one high-value question, not a scripted stack of questions.
- **Explicit goal confirmation:** A newly selected primary business goal is customer-confirmed before initiating its side-effectful workflow. A knowledge question must not automatically create a Lead or start company formation. Intent confirmation and data-processing consent are different decisions.
- **Grounded answers and next question:** Every factual service/policy/pricing answer uses approved tenant RAG evidence or verified catalog/provider data. Where the conversation remains active, deliver a natural answer with **one relevant follow-up question** that reduces uncertainty or progresses a required next step; never repeat an answered question. On unsupported questions, abstain and ask a safe clarification or offer human help.
- **Multi-turn continuity:** Questions about visas, licensing, prices, or required documents can interrupt but **not overwrite** a confirmed company-formation goal. Preserve known information, confirmed intent, pending question, action and stage revision through interruptions, fact corrections, duplicate turns, restarts and delayed callbacks.
- **Durable user intent:** Store a per-opportunity structured summary and an assessment **for every evaluated substantive turn**, including category, goal candidates and weight evidence, clarified/confirmed goal, remaining information, normalized RAG tokens, suggested next move, one question and cache lineage. Cache expensive operations by scoped catalog/summary/state versions; duplicates produce zero new GPT/n8n work.
- **Personal information and documents:** Whether name, email, phone, passports or other evidence is required is **intent- and stage-dependent**. Never collect it merely to record CRM leads or because the assistant wants a higher lead score. Preserve existing consent and secure handling.
- **Completion:** A knowledge-only request is satisfied when the grounded question is answered; an active business goal is satisfied only when its catalog-defined outcome is complete and all mandatory external gates are verified. Then ask **whether the user needs more help**, without forcing additional CRM capture or creating an unrequested opportunity.

Implementation detail: [Conversation planner](conversation-planner.md), [Intent engine](intent-engine.md), [User Intent Document](user-intent-document.md).

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

- Published catalog ties the customer's confirmed **business goal**, supporting intent category and stage to permitted tools, requirements (including optional contact/documents), workflow binding, confirmation/consent, callback verification and completion criteria.
- Inference may propose a catalog key and sanitized tool arguments; Node independently validates tenant/session/opportunity and published binding, confirms user intent, verifies requirements, obtains consent and **separately confirms side effects**. All state-changing tool calls go via Node ActionRequest → outbox → Redis worker → private n8n. Read-only Node lookups are not external writes.
- No arbitrary n8n URL or workflow key from the model. No direct model-to-Salesforce, payment, contract or tenant-data access.
- External acknowledgment and provider identity are mandatory for a remotely completed stage; fallback to reconciliation when ambiguous.

## Platform commitments

Preserve Angular Admin, Next.js web chat, platform/tenant roles, source approval, persona language/tone publishing, per-tenant catalog versioning, API contracts, tenant isolation, provenance, audit, ingestion and embeddings. Other tenants and future channels use the same engine and validated contracts. Python is an internal inference service only.

## Model and privacy scope

Use a configured GPT deployment via Azure OpenAI/Foundry Models Responses API with Python API-key authentication; do not use the saved Foundry agent during this target phase. Use synthetic data and avoid new PII-filter feature development for now. **Keep** existing tenant isolation, auth, vault, consent, minimization and secure logging; do not ship real-customer use without renewed privacy review. Credential never leaves the private Python container.

## Acceptance meaning

One continuous journey is the primary end-to-end test; follow-up questions, tool proposals and provider states must be verified by persisted evidence. No arbitrary 25-turn, 200-message or local-commit target. A mocked/sandboxed journey is clearly labeled; real provider completion requires actual acknowledgments. Tests for ambiguity, retries/rate limits, action dedupe, cache invalidation, security and restart remain mandatory.

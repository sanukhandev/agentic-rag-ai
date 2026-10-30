# Current requirements — Agentic RAG AI / ANCFZ

**Effective:** 2026-10-30. **Status:** current implementation and acceptance contract; externally verified seven-stage completion remains **BLOCKED**. This supersedes the older greenfield build briefs, phase/commit mandates and endurance-count acceptance instructions.

## Product and scope

Use the existing Node/Express TypeScript platform, Next.js customer chat and Angular Admin. The current delivery focus is ANCFZ business setup within a dedicated deployment; retain tenant-scoped storage, authorization and provenance. Admin manages tenant persona, source approval, published intent catalog and operational views; keep existing Admin and Chat API contracts unchanged.

Local development uses Docker and Azure CLI inside the API development image. The shared named Foundry agent `agentic-rag-core-dev` generates conversational wording from masked, authorized context. Node owns factual grounding, catalog selection, journey facts, consent, authorization, external operations and response validation.

## Broader platform contract (retained alongside dedicated ANCFZ delivery)

The ANCFZ focus narrows the current **acceptance journey**, not the platform's foundational product goal:

- **Multi-tenant and roles:** a platform administrator can onboard and manage organizations; tenant administrators/editors can manage only assigned tenant configuration. Preserve authenticated roles, membership, domains, source ACLs, tenant-specific personas, published catalogs, sessions and redacted audit events.
- **Admin application:** retain the Angular management interface and Node Admin API for onboarding, controlled persona publishing, source upload/approval, ingestion status, catalog version publishing, workflow review, CRM summaries and health/usage monitoring. Do not rebuild these in Foundry.
- **Customer channels:** Next.js web chat is the first-party channel; future channel adapters must use signed, scoped contracts and the existing Chat API. No browser directly calls Foundry, PostgreSQL, Redis, n8n or privileged Admin APIs.
- **Knowledge lifecycle:** approved file/HTTPS ingestion uses safe staging, extraction, sanitization, embeddings, source/version review, tenant/visibility filters, revocation and auditable citations. Supported formats are defined by the implementation; uploads are not automatically public or searchable.
- **Personas and languages:** each published tenant persona sets name, greeting, permitted languages and tone as **presentation only**. Platform privacy, source constraints and catalog gates take precedence. English-only voice support, if enabled, is a separate channel capability, not a change to chat language permissions.
- **Operations:** consent, retention/deletion, stable request/audit correlation, idempotency, provider reconciliation and observability remain mandatory. Local Foundry verification is not production go-live clearance.

## Exact business sequence

| # | Stage | Required completion proof |
| --- | --- | --- |
| 1 | Lead Generation | Valid purpose-scoped contact and consent; authorized action, **verified remote Salesforce Lead** if CRM write is configured. Local action/outbox/n8n receipt alone is not remote success. |
| 2 | Lead Qualification | Published-catalog-required facts, qualification rule and provenance persisted; no model-invented threshold. |
| 3 | Account Creation | Qualified Lead, applicable confirmation/email verification, reconciled Salesforce Account/Contact/Opportunity linked to correct Lead and local opportunity. Never create an Account for every Lead. |
| 4 | Package Selection | Currently eligible, approved package, authoritative quote/pricing, customer-confirmed revision. Unknown prices are disclosed as unavailable. |
| 5 | Document Upload | Separate upload/OCR/CRM-transfer consent, private upload/security checks, review/OCR status, **SF-02** attached to correct Salesforce record and verified. |
| 6 | Payment Details & Invoice | Approved quote and billing metadata, verified invoice reference/artifact; payment status separate. No card/CVV/bank secrets. `mock_paid` is not real settlement. |
| 7 | Contract | Approved template/prerequisites, provider contract reference, delivery/signing status and verified signed artifact before calling it signed. |

Stages cannot be bypassed by a model response, tool call, n8n execution, HTTP 202 or fixture. Account creation follows qualification and required confirmation rather than quote acceptance.

## Conversation and privacy

One customer session and active opportunity must retain Foundry conversation binding, pinned catalog/persona, fact provenance, stage revisions, unanswered prompts, consents, action idempotency keys and callback correlation across interruptions, fact correction, duplicate turns, API restart and delayed callbacks. Do not reuse predecessor-opportunity consent or documents. Ask one relevant question at a time; avoid asking again for verified facts.

PII and reversible identifiers stay in the authorized Node vault/PostgreSQL boundary; Foundry sees only masked permitted context. Customer-uploaded identity documents are not RAG knowledge. Search only approved, current and tenant/ACL-authorized evidence; do not invent policies, fees, citations, timelines or guarantees.

## Foundry execution and functions

The serving endpoint is pinned to verified tool-free **v4**; isolated candidate **v6** adds application-managed function calls (via explicit agent reference), no hosted OpenAPI. Five initial strictly read-only functions:

- `search_knowledge`
- `get_journey_state`
- `get_available_packages`
- `get_document_requirements`
- `get_action_status`

Node validates names/arguments, derives scope from server session/opportunity, bounds/redacts output, audits and returns matching `function_call_output`. Tool choice is **not** authorization. External writes remain via catalog gates, consent, transactional outbox, Redis, n8n, authenticated callback and reconciliation.

## Current blocker and delivery target

The latest recorded focused journey completed **13 customer messages, 13 assistant messages and 22 passing assertions** with a real v6 `get_journey_state` call/output. It reached local Lead action/dispatch but **did not verify a Salesforce remote Lead**. The action required reconciliation; stage remains `lead_generation`. Historical sandbox runs may demonstrate other aspects but do not satisfy this run's provider proof. See `verification/ancfz-single-journey-tool-calling.md`.

**Next acceptance:** one continuous real Foundry v6 candidate session/opportunity, seven stages in order with verified provider evidence or the first honest blocker. Include real function call/output, one knowledge interruption, fact correction, duplicate retry, restart and late callback where feasible. No 25-turn or 200-message count target. Use `docs/acceptance.md` for evidence criteria.

Do not promote v6, reattach unsafe v3 hosted OpenAPI tools, run real financial charges or request legally binding signatures without explicit approval and test evidence.

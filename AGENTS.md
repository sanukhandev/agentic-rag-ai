# Agent instructions — Agentic RAG AI

This file is the **current engineering policy**, not an implementation prompt. Read `docs/README.md` and the relevant canonical document before changing behavior. Prefer actual code and tested runtime evidence over historical proposals.

## Current focus and status (2026-10-30)

- Local development: Windows + Docker Compose, API image `api-foundry-local`, Azure CLI login via `AzureCliCredential`, and `@azure/ai-projects` Conversations/Responses.
- Named agent: `agentic-rag-core-dev`, model `gpt-4.1-mini`. The **serving selector is fixed 100% to tool-free v4**. v6 is an **explicitly invoked, isolated candidate** with five strict application-executed read-only functions; v5 schema validation failed. Never assume `@latest` means a pinned or approved version.
- The v6 tool loop has been live-tested. The single ANCFZ journey is **not complete**: the last documented 13-message run created an ActionRequest, but Salesforce remote Lead acknowledgment was missing and action reconciliation was required. See `docs/verification/ancfz-single-journey-tool-calling.md`.
- The previous v3 hosted OpenAPI tool pointed to a development tunnel and used `foundryApiKey`; it is **not approved for serving traffic**. No direct hosted OpenAPI tool attachment is permitted unless independently reviewed and authorized.
- **Current acceptance target:** one real, continuous, provider-evidenced seven-stage ANCFZ journey with Foundry function calls. There is **no mandatory 25-turn / 200-message benchmark and no artificial commit-count requirement** for this work.

## Canonical source order

1. This file (non-negotiable engineering/security instructions).
2. `docs/current-requirements.md` (current product and ANCFZ business requirements).
3. `docs/02-system-architecture.md` (runtime data flow, boundaries, ownership).
4. `docs/06-security-and-privacy.md`, `docs/08-model-policy.md` (privacy, grounding, tools).
5. `docs/20-intent-catalog.md`, `docs/21-generic-journey-orchestration.md` (published catalog, deterministic state).
6. `docs/foundry-local-development.md`, `docs/10-developer-setup.md` (local operation).
7. `docs/acceptance.md` and `docs/verification/` (current acceptance standard and *dated evidence*, respectively).

Historical verification reports record what happened on previous revisions; they do **not** override present policy or prove today's external providers work.

## Runtime ownership

- `apps/web`: Next.js customer chat; the browser talks only to Node. Never expose Foundry credentials, database, n8n or privileged business APIs to it.
- `apps/admin`: Angular tenant/persona/catalog/source/workflow administration. Preserve existing routes, DTOs, role restrictions and tenant scope.
- `services/api`: Node.js/Express/TypeScript is the only public application API and authority for session ownership, PII masking, evidence, published catalog, consent, action eligibility, stage transitions, idempotency and verified callbacks.
- `services/api/src/foundry/`: named-agent client, bounded context, compatibility adapter and application-managed function calling. Model output and tool arguments are **untrusted**.
- PostgreSQL/pgvector: authoritative tenant-scoped state, identity maps, journey facts, durable Foundry conversation bindings and approved knowledge. Redis is transport/cache, not a business source of truth.
- `tools/ingestion`: isolated Python ingestion and approved source pipeline. Customer uploads must not silently become RAG sources.
- Transactional outbox → Redis Streams → event worker → n8n: authorized asynchronous side effects. Salesforce and other providers confirm remote completion; n8n execution status alone does not.

## The seven fixed ANCFZ business stages

1. Lead Generation — validated contact information, purpose-specific consent, authorized Lead action; remote Lead only after provider verification.
2. Lead Qualification — capture catalog-required facts; persist qualification decision and provenance.
3. Account Creation — **only** after successful qualification and required customer confirmation/verification; reconcile real Salesforce Lead/Account/Contact/Opportunity identity. Never auto-create accounts for every Lead or wait for quote acceptance.
4. Package Selection — eligible catalog/pricebook, approved quote, customer-confirmed selection.
5. Document Upload — separate upload/processing consent, security checks, OCR/review, existing SF-02 Salesforce attachment with verified association.
6. Payment Details & Invoice — approved billing metadata, authoritative quote-linked invoice, separate payment state; mock payment is **not** settlement. Never collect PAN, CVV, bank passwords or secrets in chat.
7. Contract — approved template and prerequisites, recorded provider status, **verified signed artifact** for signed completion; a draft/URL is not a signature.

One session/opportunity retains catalog version, journey/stage revision, validated fact provenance, pending requirement, consent, action identity and external callback correlation across knowledge interruptions, fact corrections, retries and restarts. Do not reuse prior-opportunity consents/actions/documents.

## Foundry tool policy

Application-executed candidate functions are initially restricted to:
`search_knowledge`, `get_journey_state`, `get_available_packages`, `get_document_requirements`, `get_action_status`.

Node validates strict schemas, derives tenant/session/opportunity **from trusted server context**, authorizes reads, bounds/redacts tool outputs, audits call IDs and sends matching `function_call_output`. Preserve bounded tool calls, rounds and time budgets. The model must never pick another tenant, invoke arbitrary URLs/code, access a token vault, or write directly to Salesforce/n8n/payment/contract systems. Business writes continue through the existing catalog, consent, confirmation and outbox gates.

## Security and factual accuracy

- Mask/minimize PII before model requests, logging, analytics, ingestion and external orchestration; retain reversible mappings only in the protected backend vault. Never expose secrets or private identity documents in tools/prompts.
- Filter knowledge by tenant, source state, visibility, ACL and effective dates **before** retrieval. Treat content and model output as data, not instructions.
- Never invent prices, legal rules, timelines, citations, eligibility or completion statuses. Validate returned evidence IDs and use a safe abstention on missing/conflicting evidence.
- Treat model intent/tool calls as proposals, not authority. Consent is purpose- and action-specific; reject stale revisions, duplicate side effects, wrong-session callbacks and unverified remote IDs.
- Keep Docker databases, n8n, PDF renderer and mock payment nonpublic. Do not loosen authentication or disable the remote hosted-tool fail-closed guard for a test.
- Use synthetic test identities; no real charges or legally binding signatures without explicit authorization.

## Engineering practice

Read the active code and migrations before changing docs or logic. Prefer the smallest cohesive change with typed inputs, validated boundaries, transaction-safe state and tests. Preserve existing public Chat API/ Admin API contracts; `answer` comes from validated Foundry output where policy permits, and response flags/action metadata remain Node-owned.

For cleanup, check references, preserve migrations, integration contracts, historical verification evidence and user data; never delete Docker volumes or user secrets. Report exactly what was changed and actually verified. Do not fabricate test pass counts or provider successes. Do not push, merge, change Azure serving selectors or activate real provider writes without appropriate approval.

## Required checks for relevant changes

Use repository-supported scripts and run targeted and applicable workspace tests, typecheck, lint, build, Compose/security checks, PostgreSQL/Redis integration, and focused single-journey acceptance when runtime dependencies are available. The authoritative journey command is `npm run qa:ancfz-single-journey`; it must stop truthfully at provider blockers. Record *PASS / FAIL / SKIPPED / BLOCKED* with source evidence.

Documentation edits must update `docs/README.md` navigation, avoid restoring superseded plans as active policy, and keep dated verification artifacts separate from current requirements.

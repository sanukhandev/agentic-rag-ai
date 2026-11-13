# 06 — Agent intents, requirements, offerings, actions and workflows

**Status:** target generic catalogs, not hardcoded ANCFZ business stages.

## Logical registries
1. **Intent catalog:** published goal key, description, semantic examples, optional keywords/exclusions, conditional requirements, available offerings and operation keys.
2. **Model-visible read/proposal tools:** global reviewed handlers, each enabled only by immutable Agent tool allowlist.
3. **Action registry:** typed policy, customer authorization, consent purpose, dependencies, provider binding, idempotency and completion evidence.
4. **Workflow registry:** approved n8n/provider executor identity and verified status transition model. Model/catalog prose can never directly define executable code or arbitrary remote endpoint.

## Generic intent requirements
`get_intent_requirements(intentKey)` returns applicable fact/document/approval/prerequisite definitions with status verified/missing/conflicting/conditional, derived from the published Agent catalog plus authenticated ticket facts. It replaces ANCFZ-specific document requirement tools. Intent recognition is semantic across conversation; keyword matches are recall aids, not action authorization.

## Offerings
Products, services and packages are separate from intents; each has versioned public description, eligibility, price and currency/validity, quote calculation contracts and approved operations. Formal quotes use authoritative pricing revision, not retrieved prose. One offering may support multiple intents.

## Example only
```yaml
intent:
  key: company_formation
  description: Help a customer explore and request company formation.
  examples: [I want to register a company, I need an IT consultancy license]
  requirements:
    - {key: business_activity, type: text, requiredFor: [create_lead, generate_quote]}
    - {key: visa_count, type: integer, requiredFor: [generate_quote]}
    - {key: contact_email, type: email, requiredFor: [create_lead]}
  offerings: [license_package, visa_package]
  operations: [create_lead, generate_quote]
```
All keys are sample Agent configuration, not global compiled rules.

## Business operation path
Foundry may request `preflight_operation` and `propose_operation` via Python and Node. Proposal alone never dispatches. Node verifies Agent, ticket/account, pinned catalog, required fields, permission, consent and explicit authorization; transactionally writes action request + ticket event + outbox. Worker delivers to the allowlisted n8n workflow. Signed callback or trusted reconciliation verifies external lead/quote ID and immutable result. Ticket event and SSE show actual state.

States: proposed → awaiting_customer_authorization → authorized → queued → running → verified_completed, with rejected, retryable_failed, unknown_outcome/reconciliation_required, terminal_failed separate. Dedupe by stable Agent/ticket/action identity and approved idempotency key.

## Closing and evolution
An action may continue while ticket awaits result; explicit customer request is needed to close. Catalog versions are immutable and pinned. A published workflow cannot run unknown action classes or bypass agent-scope provider connections. All side effects logged to ticket and auditable by authorized administrators.

# 06 — Tenant intents, action catalog and workflow engine

**Status: target data-driven catalog design. A configured goal is not permission to execute an action.**

## Model of business intent
- **Customer utterance:** what was said in the current turn.
- **Business goal:** a probable customer outcome, selected from the tenant's published goals using conversation context.
- **Requirement:** typed information needed to answer, recommend or prepare an action.
- **Action definition:** a separately permissioned capability with input schema, prerequisites, consent rules and workflow binding.
- **Workflow graph:** tenant-published dependency structure defining what may execute next and what independently verifies completion.

A model interprets intent semantically using catalog description, examples, keywords and exclusions. Keywords assist discovery but never alone authorize a goal or side effect. If two goals remain plausible, ask a contextual question. Do not require routine confirmation simply to continue discussing a clear goal.

## Published catalog
The Admin editor manages drafts, schema validation, preview, review and publish. JSON/YAML import/export must round-trip through the same validation and permission controls. Published revisions are immutable; active sessions pin their approved revision until an intentional migration.

Illustrative YAML (not an implementation schema):

~~~yaml
schemaVersion: 1
tenantCatalog:
  displayName: Example Business Services
  goals:
    - key: company_formation
      title: Start a company
      description: Help a customer understand and initiate company registration.
      examples:
        - I want to open a company
        - Can I register a consultancy?
      keywords: [new company, business setup, license]
      exclusions:
        - general information only
      requirements:
        - key: proposed_activity
          type: string
          askWhen: relevant_to_customer_goal
        - key: jurisdiction
          type: string
          askWhen: needed_for_advice_or_action
      availableActions: [create_lead, request_documents, generate_quote]
  actions:
    - key: create_lead
      description: Submit a consented enquiry to the CRM.
      requiresCustomerAuthorization: true
      requiresConsentPurposes: [crm_contact]
      requiredFacts: [contact_name, contact_channel]
      workflowKey: lead_registration
      completionEvidence: provider_verified_lead_reference
  workflows:
    - key: lead_registration
      providerBinding: admin_managed_private_n8n_binding
      idempotencyScope: tenant_conversation_action
~~~

**Security:** providerBinding above is a symbolic published identifier, not an executable URL supplied by the model. Server-side allowlisted configuration maps it to an approved private workflow. Do not store executable scripts or arbitrary network destinations in catalog descriptions.

## Two independent decisions
1. **Conversation decision:** GPT may identify a goal, choose a helpful follow-up, answer with RAG, propose collecting details or explain an available service. Ordinary information collection can proceed when the goal is clear.
2. **Business authorization:** Node checks identity, catalog pin, fact completeness, permission, account/journey state, user authorization, purpose-specific consent, idempotency and provider binding before creating an executable command.

Explicit customer authorization is required for consequential external actions according to policy; it is **not** a mandatory generic question on every goal. Consent to discuss company registration is not consent to share contact details with a CRM.

## Workflow graph
Use a validated tenant-defined directed acyclic graph or a deliberately bounded state machine. Each action has:
- Stable key, versioned schema and permitted roles.
- Required typed inputs and approved source provenance.
- Named prerequisites from the graph; cycle and orphan validation on publish.
- Retry policy, timeout, deduplication key and terminal/error states.
- Tenant-bound provider binding, callback contract and completion-evidence requirement.
- Compensation/reconciliation strategy for partially executed operations.

ANCFZ may publish this **sample** ordered path, not a platform-wide hardcoded journey:

~~~text
Lead Generation -> Lead Qualification -> Account Creation
-> Package Selection -> Document Collection
-> Payment and Invoice -> Contract
~~~

A different tenant can publish a shorter, branching or completely different workflow. Conversation can explain any stage while action execution remains bound by prerequisites.

## Execution truth
Node commits action request and outbox event transactionally; worker forwards via Redis to private n8n; provider adapter correlates results to tenant, command and idempotency key; authenticated callback or trusted reconciliation marks a verified outcome. A model suggestion, webhook transport acknowledgment, generated file or worker log is not completion evidence.

## Administration and evolution
Tenant administrators cannot publish cross-tenant tool bindings, unsafe URLs, unknown action types, invalid graphs or broadened permissions without review. Runtime rollouts must support previously pinned revisions. Maintain audit trails for catalog changes, action authorization, provider evidence and customer-visible state.

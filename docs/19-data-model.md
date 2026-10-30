# Current PostgreSQL data model — tenant, Foundry and seven-stage journey

This diagram is a **logical map of implemented persistence**, not a substitute for the SQL schema. The authoritative definitions are the sequential migrations in `infra/postgres/`, especially `030-event-driven-execution.sql`, `044-journey-opportunity-identity.sql`, `047-business-lifecycle.sql` and `054-foundry-conversation-bindings.sql`. Not every logical opportunity association is declared as a foreign key; enforce tenant/opportunity scope in application transactions and existing constraints.

```mermaid
erDiagram
  TENANTS ||--o{ CHAT_SESSIONS : scopes
  TENANTS ||--o{ INTENT_CATALOG_VERSIONS : publishes
  TENANTS ||--o{ JOURNEY_INSTANCES : owns
  CHAT_SESSIONS ||--o{ MESSAGES : contains
  CHAT_SESSIONS ||--o{ FOUNDRY_CONVERSATION_BINDINGS : binds
  CHAT_SESSIONS ||--o{ JOURNEY_INSTANCES : contains
  JOURNEY_INSTANCES ||--o{ JOURNEY_FACTS : records
  CHAT_SESSIONS ||--o{ ACTION_REQUESTS : proposes
  ACTION_REQUESTS ||--o{ ACTION_EXECUTIONS : tracks
  ACTION_REQUESTS o|--o{ EVENT_OUTBOX : correlates
  TENANTS ||--o{ EVENT_OUTBOX : owns
  TENANTS ||--o{ PACKAGE_OFFERINGS : authorizes
  PACKAGE_OFFERINGS ||--o{ QUOTES : prices
  PACKAGE_OFFERINGS ||--o{ PACKAGE_SELECTIONS : offers
  QUOTES o|--o{ PACKAGE_SELECTIONS : supports
  QUOTES ||--o{ INVOICES : bills
  PACKAGE_SELECTIONS ||--o{ CONTRACTS : associates
  INVOICES o|--o{ CONTRACTS : references
  TENANTS ||--o{ CRM_ACCOUNTS : manages
  TENANTS ||--o{ SUPPORTING_DOCUMENTS : protects

  TENANTS {
    uuid id PK
    text slug
  }
  CHAT_SESSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid persona_version_id FK
    jsonb conversation_state
  }
  INTENT_CATALOG_VERSIONS {
    uuid id PK
    uuid tenant_id FK
    text status
  }
  FOUNDRY_CONVERSATION_BINDINGS {
    uuid id PK
    uuid tenant_id FK
    uuid session_id FK
    text foundry_conversation_id
    text foundry_agent_version
    text status
    int revision
  }
  JOURNEY_INSTANCES {
    uuid id PK
    uuid tenant_id FK
    uuid session_id FK
    uuid catalog_version_id FK
    text intent_key
    int revision
  }
  JOURNEY_FACTS {
    uuid journey_id FK
    uuid tenant_id FK
    text fact_key
    jsonb provenance
  }
  ACTION_REQUESTS {
    uuid id PK
    uuid session_id FK
    uuid opportunity_id
    text action_key
    int action_revision
  }
  EVENT_OUTBOX {
    uuid event_id PK
    uuid tenant_id FK
    uuid action_id FK
    text idempotency_key
    timestamptz published_at
  }
  ACTION_EXECUTIONS {
    uuid id PK
    uuid action_id FK
    text provider_status
    text n8n_execution_ref
  }
  PACKAGE_OFFERINGS {
    uuid id PK
    text package_key
    text approval_status
  }
  QUOTES {
    uuid id PK
    uuid package_offering_id FK
    text status
  }
  PACKAGE_SELECTIONS {
    uuid id PK
    uuid package_offering_id FK
    uuid quote_id FK
    text status
  }
  INVOICES {
    uuid id PK
    uuid quote_id FK
    text provider
    text status
  }
  CONTRACTS {
    uuid id PK
    uuid package_selection_id FK
    uuid invoice_id FK
    text status
  }
  CRM_ACCOUNTS {
    uuid id PK
    uuid lead_id FK
    uuid opportunity_id
    text status
  }
```

## Data ownership and compatibility

- **Tenant/session:** authenticated tenant scope controls all customer records. Session state pins the active persona/catalog context; client IDs and Foundry conversation IDs are not authorization tokens.
- **Foundry:** `foundry_conversation_bindings` stores server-owned tenant/session/agent/version mapping. Conversations support continuity, but business truth is stored in PostgreSQL, not the model.
- **Journey:** `journey_instances` and `journey_facts` represent opportunity identity, catalog revision and provenance. Existing `conversation_state.intentProgress` and scoped action mappings remain compatibility/read paths; do not assume every lifecycle stage is a separate physical table.
- **Actions/outbox:** `action_requests`, `event_outbox`, `event_inbox`, `action_executions` and Redis Streams provide durable, idempotent dispatch and callback reconciliation. Redis is delivery infrastructure, not truth.
- **Business lifecycle:** `crm_accounts`, `package_offerings`, `quotes`, `package_selections`, `supporting_documents`, `invoices` and `contracts` hold guarded business artifacts. External provider IDs and verified callbacks are required before claiming completion.
- **Knowledge/security:** source versions, pgvector chunks, ingestion jobs, token-vault mappings, role memberships and audit logs remain in existing tables not fully expanded in this diagram. Onboarding uploads must not become public RAG knowledge without approval.
- **Version migration:** applied migrations must never be deleted or rewritten to match a diagram. Schema constraints and actual service code take precedence over this documentation.

For behavior, see [current requirements](current-requirements.md), [journey orchestration](21-generic-journey-orchestration.md), and [Foundry local development](foundry-local-development.md).

# Local data model

This is the local MVP persistence model. PostgreSQL migrations are the
authoritative schema; the diagram shows ownership and security boundaries,
not a production approval of roles, retention or backup policy.

```mermaid
erDiagram
  TENANTS ||--o{ USERS : owns
  TENANTS ||--o{ TENANT_DOMAINS : allowlists
  TENANTS ||--o{ PERSONA_VERSIONS : versions
  TENANTS ||--o{ SOURCES : owns
  SOURCES ||--o{ SOURCE_VERSIONS : has
  SOURCE_VERSIONS ||--o{ CHUNKS : indexes
  TENANTS ||--o{ INGESTION_JOBS : queues
  TENANTS ||--o{ CHAT_SESSIONS : scopes
  CHAT_SESSIONS ||--o{ MESSAGES : contains
  CHAT_SESSIONS ||--o{ ACTIONS : proposes
  TENANTS ||--o{ ACTIONS : authorizes
  TENANTS ||--o{ AUDIT_EVENTS : records
  USERS ||--o{ AUTH_SESSIONS : issues

  TENANTS { uuid id PK; text slug UK; text status; text public_origin; boolean public_chat_enabled }
  USERS { uuid id PK; uuid tenant_id FK; text email UK; text role; text password_hash }
  TENANT_DOMAINS { uuid id PK; uuid tenant_id FK; text hostname UK }
  PERSONA_VERSIONS { uuid id PK; uuid tenant_id FK; int version; text status }
  SOURCES { uuid id PK; uuid tenant_id FK; uuid version_id; text status; text audience; text content_hash }
  SOURCE_VERSIONS { uuid version_id PK; uuid source_id FK; uuid tenant_id FK; text content_hash }
  CHUNKS { uuid id PK; uuid source_id FK; uuid tenant_id FK; uuid version_id FK; int ordinal; vector embedding }
  INGESTION_JOBS { uuid id PK; uuid tenant_id FK; uuid source_id FK; text status; text lease_expires_at }
  AUTH_SESSIONS { text token_hash PK; uuid user_id FK; timestamptz expires_at; timestamptz revoked_at }
  CHAT_SESSIONS { uuid id PK; uuid tenant_id FK; uuid persona_version_id FK; timestamptz created_at; timestamptz last_activity_at; timestamptz closed_at }
  MESSAGES { uuid id PK; uuid session_id FK; uuid tenant_id FK; text role; text masked_content }
  ACTIONS { uuid id PK; uuid tenant_id FK; uuid session_id FK; text state; text opaque_reference }
  AUDIT_EVENTS { uuid id PK; uuid tenant_id FK; uuid actor_id FK; text event_name; jsonb metadata }
```

Security invariants:

- Every tenant-owned query carries the authenticated tenant ID or the explicit
  platform-admin privilege; client-supplied tenant IDs are not authorization.
- Public retrieval can select only active `public` source versions. Authenticated
  tenant users may select the tenant's approved `internal` evidence.
- `MESSAGES` and workflow payloads persist masked content or opaque references;
  reversible token mappings remain session/server controlled.
- Source publication, revocation, purge, persona publication, lifecycle changes
  and workflow callbacks are audited without storing raw customer values.
- A session pins its persona version so later publication cannot rewrite an
  existing conversation's behavior.

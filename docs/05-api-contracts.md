# Local API contracts

The local vertical slice implements these routes with runtime Zod validation and tenant-scoped repository checks. The development JWT is a local authentication adapter; production identity, TLS and deployment policy remain separate decisions.

## External web API
| Route | Purpose | Required controls |
| --- | --- | --- |
| POST /api/v1/chat/sessions | Start or resume channel session | Origin controls, throttling, scoped opaque IDs |
| POST /api/v1/chat/messages | Submit user turn and receive grounded answer | Message size, session scope, mask→retrieve→verify |
| GET /api/v1/chat/sessions/:id | Get permitted sanitized history (default 100, maximum 200 messages; newest window returned in chronological order) | Session ownership, bounded response |
| POST /api/v1/chat/actions/:proposalId/confirm | Confirm sensitive action | Explicit confirmation, expiry, idempotency |
| GET /api/v1/chat/actions/:id | Poll authorized action outcome | Session ownership, no PII leak |
| GET /api/v1/health/live | Lightweight liveness | No secrets/dependency disclosure |
| GET /api/v1/health/ready | Restricted readiness | Safe dependency status |

## Authentication and platform administration

| Route | Purpose | Required controls |
| --- | --- | --- |
| POST /api/v1/auth/register-platform | One-time local bootstrap | Disabled in production; first-user guard |
| POST /api/v1/auth/login | Issue a tenant/platform session | Password verification and durable session record |
| GET /api/v1/auth/me | Return the verified current user context | Authentication middleware; no password or token material |
| POST /api/v1/auth/logout | Revoke the current session | Server-side revocation |
| POST /api/v1/admin/tenants | Provision a tenant and owner | Platform-admin RBAC, unique slug/email, audit |
| GET /api/v1/admin/platform/overview | Aggregate tenant metrics | Platform-admin RBAC; no customer content |
| PATCH /api/v1/admin/tenants/:id/status | Suspend/reactivate/archive a tenant | Platform-admin RBAC, audited lifecycle transition |
| GET/PUT /api/v1/admin/tenants/:tenantId/persona | Platform admin reads/updates a tenant AI agent | Platform-admin RBAC, explicit tenant target, archived-tenant guard, audited update |

## Admin API (authenticated role-based access)
| Route | Purpose | Required controls |
| --- | --- | --- |
| POST /api/v1/admin/sources | Stage validated file/metadata | Tenant-admin/editor RBAC and active tenant |
| GET /api/v1/admin/sources | Tenant-filtered source catalog | Tenant scope from the session |
| POST /api/v1/admin/sources/:id/publish | Approve and activate version | Tenant-admin RBAC and source ownership |
| POST /api/v1/admin/sources/:id/revoke | Immediately exclude source from retrieval | Tenant-admin RBAC and source ownership |
| GET /api/v1/admin/ingestion-jobs/:id | Sanitized job progress | Tenant scope and no raw staged bytes |
| GET /api/v1/admin/workflow-runs | Tenant-scoped redacted status/audit | Tenant scope and no vault values |
| GET /api/v1/admin/dashboard/overview | Tenant-scoped operational counters | Tenant identity from the session |
| GET /api/v1/admin/services/health | Redacted service and telemetry status | Platform/tenant-admin RBAC |
| GET/PATCH /api/v1/admin/channel | Configure exact public origin and enablement | Tenant-admin RBAC, origin validation, audited |
| GET/PUT /api/v1/admin/persona | Read/update the active persona | Tenant scope, persona safety validation |
| POST /api/v1/admin/persona/drafts | Create a persona version | Tenant-admin RBAC, bounded fields |
| GET /api/v1/admin/persona/versions | List tenant persona history | Tenant scope |
| POST /api/v1/admin/persona/versions/:id/publish | Publish or roll back to a version | Tenant-admin RBAC, tenant-bound version |
| POST /api/v1/admin/sources/upload | Queue a bounded private file for Python ingestion | Tenant-admin/editor RBAC, type/size/base64 validation |
| POST /api/v1/admin/retention/purge-sessions | Purge sessions before an explicit cutoff | Tenant-admin RBAC, audited retention action |

Enforce server-side RBAC/ABAC for each handler. Browser cannot choose an arbitrary tenant or receive a vault mapping.

## Suggested message request example
```json
{
  "sessionId": "opaque-session-id",
  "message": "What services are available?",
  "clientMessageId": "idempotent-client-turn-id",
  "channel": "web"
}
```

Action confirmation requests must include the originating `sessionId` alongside `confirmed: true`; Node verifies that the action and session belong together before executing it.

## Suggested response shape
```json
{
  "messageId": "opaque-server-id",
  "sessionId": "opaque-session-id",
  "answer": "Only an evidence-grounded answer is returned here.",
  "grounded": true,
  "conversational": false,
  "citations": [
    {
      "sourceId": "approved-source-id",
      "versionId": "approved-version-id",
      "chunkId": "authorized-chunk-id",
      "locator": "page 2",
      "title": "Approved brochure"
    }
  ],
  "actionProposal": null,
  "requestId": "trace-correlation-id"
}
```
Examples illustrate schema only; they are not live data and do not imply a shipped API.

## Response and action semantics
- **answer** is user-safe text; may include a disclosure when evidence is missing; **grounded=false** must not imply factual business assertions. **conversational=true** identifies a short greeting answered from the tenant persona when no matching approved evidence exists. If matching evidence exists, the response is grounded and reported with `conversational=false` and validated citations.
- **citations** are validated and tenant-authorized; never include storage credentials, private paths, original customer PII or internal embedding data.
- **actionProposal** contains opaque ID, canonical action type, user-readable confirmation requirement and expiry; never arbitrary executable instructions.
- **errors**: consistent code, generic message and correlation ID; no traces, raw model output, SQL or PII. Use appropriate 400/401/403/404/409/413/422/429/5xx statuses.
- **streaming**: optional later SSE design; do not stream unchecked model tokens that may contain PII or unverified claims. Buffer and validate or build a secure streaming gate before enabling.

## Backend-only action contract
Node → n8n: workflow allowlist ID, tenant-scoped opaque business reference, correlation ID, idempotency key, validated minimal payload and authenticated signature/service identity. n8n → Node: schema-validated status (accepted, completed, failed, unknown), a bounded opaque external identifier (`[A-Za-z0-9][A-Za-z0-9._:-]{0,199}`) and sanitized error reason. No direct client webhook path; arbitrary text or customer identifiers are rejected at the callback/adapter boundary.

## Anti-replay
Duplicate clientMessageId or action idempotency key must not create duplicate customer contacts or repeated workflow effects. Use transactional reservations, action state machine and TTLs. Failed executions should be recoverable without unknown double delivery.

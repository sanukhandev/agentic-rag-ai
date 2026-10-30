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

## Omnichannel channel gateway

For the maintained signed connector contract, see [Omnichannel connector API](21-omnichannel-connector-api-spec.md) and the implemented [OpenAPI document](openapi.yaml).

Tenant admins issue one credential per channel through `POST /api/v1/admin/channels`. The response contains the generated secret once; the database stores only encrypted secret material. `GET /api/v1/admin/channels` returns metadata without secrets and `POST /api/v1/admin/channels/:id/revoke` immediately disables a credential.

Signed channel clients reuse the external chat routes (`sessions`, `messages`, `history`, `actions/:id/confirm`, and `actions/:id`) with these headers:

| Header | Value |
| --- | --- |
| `X-Agentic-Key-Id` | Issued public key ID |
| `X-Agentic-Timestamp` | Unix timestamp in seconds |
| `X-Agentic-Nonce` | Per-request unique value, 8–128 safe characters |
| `X-Agentic-Signature` | Base64url HMAC-SHA256 signature |

The signature is calculated over `METHOD\nREQUEST_TARGET\nTIMESTAMP\nNONCE\nJSON_BODY`, with the method uppercased, `REQUEST_TARGET` including the raw query string when present, and the exact JSON body sent to Node. Requests older than five minutes or with a reused nonce are rejected. The tenant and channel come from the credential, not request fields; signed session creation therefore uses `{}` as its body. This is server-to-server channel authentication and does not replace HTTPS, rate limiting, idempotency or Node-side intent/workflow authorization.

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
| GET /api/v1/admin/channels | List tenant channel credential metadata | Tenant-admin RBAC; secrets excluded |
| POST /api/v1/admin/channels | Issue one credential for a channel | Tenant-admin RBAC, encrypted-at-rest secret, audit; secret returned once |
| POST /api/v1/admin/channels/:id/revoke | Revoke a channel credential | Tenant-admin RBAC, tenant ownership, audit |
| GET/PUT /api/v1/admin/persona | Read/update the active persona | Tenant scope, persona safety validation |
| POST /api/v1/admin/persona/drafts | Create a persona version | Tenant-admin RBAC, bounded fields |
| GET /api/v1/admin/persona/versions | List tenant persona history | Tenant scope |
| POST /api/v1/admin/persona/versions/:id/publish | Publish or roll back to a version | Tenant-admin RBAC, tenant-bound version |
| POST /api/v1/admin/sources/upload | Queue a bounded private file for Python ingestion | Tenant-admin/editor RBAC, type/size/base64 validation |
| POST /api/v1/admin/retention/purge-sessions | Purge sessions before an explicit cutoff | Tenant-admin RBAC, audited retention action |

Enforce server-side RBAC/ABAC for each handler. Browser cannot choose an arbitrary tenant or receive a vault mapping.

## Chat message request (current Node Zod contract)

`POST /api/v1/chat/messages` parses `services/api/src/http/schemas.ts` `messageSchema`. `sessionId` must be an authorized UUID and `clientMessageId` is mandatory for message idempotency. The optional `type` defaults to `text` (`text`, `postback`, `attachment`); `message` defaults to an empty string but is required for non-postback turns. `postbackValue` and `replyToPromptId` apply where relevant. Do **not** put a `channel` selector in the request body: channel authentication/context comes from the verified request origin or signed channel credential.

```json
{
  "sessionId": "00000000-0000-4000-8000-000000000001",
  "type": "text",
  "message": "What services are available?",
  "clientMessageId": "synthetic-message-001"
}
```

Action confirmation uses the existing `POST /api/v1/chat/actions/:id/confirm` endpoint with the originating `sessionId` and `confirmed: true`; Node verifies the authenticated session, action/opportunity identity, consent, revision and current state.

CRM summary writes remain backend-normalized and sanitized. They do not grant action or provider status.

## Chat response (existing public contract)

```json
{
  "messageId": "opaque-message-id",
  "sessionId": "opaque-session-id",
  "answer": "An authorized source-grounded response, follow-up, or safe abstention.",
  "grounded": false,
  "conversational": true,
  "citations": [],
  "actionProposal": null,
  "pendingPromptId": null,
  "pendingIntentKey": null,
  "pendingRequirementKey": null,
  "requestId": "opaque-request-correlation-id"
}
```

**Schema illustration only:** the example flags, null fields and IDs are placeholders, not asserted results. The response fields and types must remain unchanged. When allowed, `answer` comes from validated Foundry `response.output_text`; Node calculates citation, action, grounding and pending-requirement metadata. A Foundry conversation ID or function-call trace is never a public response field. The API remains synchronous for message replies; confirmed business actions are dispatched asynchronously via the **PostgreSQL transactional outbox → Redis Streams → event worker → n8n** path. Provider completion is reported separately from accepted/queued state.

## Response and action semantics
- **answer** is user-safe text; may include a disclosure when evidence is missing; **grounded=false** must not imply factual business assertions. **conversational=true** identifies a short greeting answered from the tenant persona when no matching approved evidence exists. If matching evidence exists, the response is grounded and reported with `conversational=false` and validated citations.
- **citations** are validated and tenant-authorized; never include storage credentials, private paths, original customer PII or internal embedding data.
- **actionProposal** contains opaque ID, canonical action type, user-readable confirmation requirement and expiry; `consentRequired=true` means the same button records explicit visitor consent and approves the action. It never infers consent from an email address or detected intent.
- **errors**: consistent code, generic message and correlation ID; no traces, raw model output, SQL or PII. Use appropriate 400/401/403/404/409/413/422/429/5xx statuses.
- **streaming**: optional later SSE design; do not stream unchecked model tokens that may contain PII or unverified claims. Buffer and validate or build a secure streaming gate before enabling.

## Backend-only action contract
Node → n8n: workflow allowlist ID, tenant-scoped opaque business reference, correlation ID, idempotency key, validated minimal payload and authenticated signature/service identity. n8n → Node: schema-validated status (accepted, completed, failed, unknown), a bounded opaque external identifier (`[A-Za-z0-9][A-Za-z0-9._:-]{0,199}`) and sanitized error reason. No direct client webhook path; arbitrary text or customer identifiers are rejected at the callback/adapter boundary.

## Anti-replay
Duplicate clientMessageId or action idempotency key must not create duplicate customer contacts or repeated workflow effects. Use transactional reservations, action state machine and TTLs. Failed executions should be recoverable without unknown double delivery.

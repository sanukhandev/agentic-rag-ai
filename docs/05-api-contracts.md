# Provisional API contracts (design only)

**These routes do not yet exist.** They describe a target versioned boundary; finalize OpenAPI and runtime validators during API bootstrap.

## External web API
| Route | Purpose | Required controls |
| --- | --- | --- |
| POST /api/v1/chat/sessions | Start or resume channel session | Origin controls, throttling, scoped opaque IDs |
| POST /api/v1/chat/messages | Submit user turn and receive grounded answer | Message size, session scope, mask→retrieve→verify |
| GET /api/v1/chat/sessions/:id | Get permitted sanitized history | Session ownership, pagination |
| POST /api/v1/chat/actions/:proposalId/confirm | Confirm sensitive action | Explicit confirmation, expiry, idempotency |
| GET /api/v1/chat/actions/:id | Poll authorized action outcome | Session ownership, no PII leak |
| GET /api/v1/health/live | Lightweight liveness | No secrets/dependency disclosure |
| GET /api/v1/health/ready | Restricted readiness | Safe dependency status |

## Admin API (authenticated role-based access)
| Route | Purpose |
| --- | --- |
| POST /api/v1/admin/sources | Stage validated file/metadata |
| GET /api/v1/admin/sources | Tenant-filtered source catalog |
| POST /api/v1/admin/sources/:id/publish | Approve and activate version |
| POST /api/v1/admin/sources/:id/revoke | Immediately exclude source from retrieval |
| GET /api/v1/admin/ingestion-jobs/:id | Sanitized job progress |
| GET /api/v1/admin/workflow-runs | Tenant-scoped redacted status/audit |

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

## Suggested response shape
```json
{
  "messageId": "opaque-server-id",
  "sessionId": "opaque-session-id",
  "answer": "Only an evidence-grounded answer is returned here.",
  "grounded": true,
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
- **answer** is user-safe text; may include a disclosure when evidence is missing; **grounded=false** must not imply factual business assertions.
- **citations** are validated and tenant-authorized; never include storage credentials, private paths, original customer PII or internal embedding data.
- **actionProposal** contains opaque ID, canonical action type, user-readable confirmation requirement and expiry; never arbitrary executable instructions.
- **errors**: consistent code, generic message and correlation ID; no traces, raw model output, SQL or PII. Use appropriate 400/401/403/404/409/413/422/429/5xx statuses.
- **streaming**: optional later SSE design; do not stream unchecked model tokens that may contain PII or unverified claims. Buffer and validate or build a secure streaming gate before enabling.

## Backend-only action contract
Node → n8n: workflow allowlist ID, tenant-scoped opaque business reference, correlation ID, idempotency key, validated minimal payload and authenticated signature/service identity. n8n → Node: schema-validated status (accepted, completed, failed, unknown), external reference and sanitized error reason. No direct client webhook path.

## Anti-replay
Duplicate clientMessageId or action idempotency key must not create duplicate customer contacts or repeated workflow effects. Use transactional reservations, action state machine and TTLs. Failed executions should be recoverable without unknown double delivery.

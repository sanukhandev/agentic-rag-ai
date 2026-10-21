# Omnichannel connector API specification

This document defines how server-side channel connectors use the Agentic RAG chat API. It is derived from [12-omnichannel-chat-api.md](12-omnichannel-chat-api.md) and is intended for WhatsApp, Telegram, email, CRM widgets, call-center adapters, and other channel services.

The connector talks only to the API server. It must not call PostgreSQL, n8n, Azure, or the browser chat service directly.

## 1. Server URI and environments

Configure the API origin once in the connector:

```bash
export CHAT_API_BASE='https://api.example.com'
```

For a connector running on the VM, the local binding is normally:

```bash
export CHAT_API_BASE='http://127.0.0.1:4000'
```

Use the HTTPS reverse-proxy URI for any connector outside the VM. Do not publish the raw port `4000` over HTTP.

Health check:

```bash
curl -fsS "$CHAT_API_BASE/api/v1/health/live"
```

## 2. Connector credential lifecycle

Each channel gets its own credential. A tenant administrator creates it through the authenticated admin API:

```bash
curl -X POST "$CHAT_API_BASE/api/v1/admin/channels" \
  -H "Authorization: Bearer $ADMIN_SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"channel":"whatsapp"}'
```

Save the one-time `secret` in the connector's server-side secret manager. Keep `keyId` as configuration. The secret is not returned by later list calls.

Manage credentials:

```bash
curl "$CHAT_API_BASE/api/v1/admin/channels" \
  -H "Authorization: Bearer $ADMIN_SESSION_TOKEN"

curl -X POST "$CHAT_API_BASE/api/v1/admin/channels/$CHANNEL_CREDENTIAL_ID/revoke" \
  -H "Authorization: Bearer $ADMIN_SESSION_TOKEN"
```

Use one credential per independent channel or integration. Revocation blocks new and subsequent signed requests for that credential.

### Temporary static API key (development/controlled VM use)

For a short-lived connector setup, the API also accepts one server-side static key scoped to one configured tenant. Configure `OMNI_CHANNEL_API_KEY` with at least 32 random characters and exactly one of `OMNI_CHANNEL_TENANT_ID` or `OMNI_CHANNEL_TENANT_SLUG`. Production requires explicit `OMNI_ALLOW_STATIC_API_KEY=true`; signed channel credentials remain the recommended multi-connector option.

```bash
curl -sS -X POST "$CHAT_API_BASE/api/v1/chat/sessions" \
  -H "X-Agentic-Api-Key: $OMNI_CHANNEL_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

The caller must not send `tenantId` or `tenantSlug`; the server resolves the configured tenant. This key is shared by all connectors using it and cannot be independently revoked, so replace it when moving to signed channel credentials.

## 3. Signed request contract

Every server-to-server chat request uses these headers:

```text
X-Agentic-Key-Id: <keyId>
X-Agentic-Timestamp: <Unix seconds>
X-Agentic-Nonce: <unique 8–128 character value>
X-Agentic-Signature: <base64url HMAC-SHA256>
```

The signature input is exactly:

```text
METHOD\nREQUEST_TARGET\nTIMESTAMP\nNONCE\nEXACT_JSON_BODY
```

`REQUEST_TARGET` includes the path and raw query string. The JSON body used for signing must be byte-for-byte identical to the body sent. Use a fresh timestamp, nonce, and signature for every request. Reusing a nonce or sending an expired timestamp is rejected.

Minimal Bash signing helper:

```bash
sign_request() {
  method="$1"; target="$2"; body="$3"
  timestamp="$(date +%s)"
  nonce="$(cat /proc/sys/kernel/random/uuid | tr -d '-')"
  canonical="${method}\n${target}\n${timestamp}\n${nonce}\n${body}"
  signature="$(printf '%s' "$canonical" | openssl dgst -sha256 -hmac "$CHANNEL_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=')"
  printf '%s\n%s\n%s\n%s' "$timestamp" "$nonce" "$signature" "$body"
}
```

The secret must never be placed in browser JavaScript, a URL, a message, or a log line.

## 4. Conversation lifecycle

The connector should maintain this mapping in its own durable store:

```text
external channel + external conversation/thread ID -> Agentic sessionId
```

### 4.1 Create a session

Signed channel sessions must use an empty body. Tenant scope comes from the credential, not from caller input:

```bash
body='{}'
target='/api/v1/chat/sessions'
timestamp="$(date +%s)"
nonce="$(cat /proc/sys/kernel/random/uuid | tr -d '-')"
canonical="POST\n${target}\n${timestamp}\n${nonce}\n${body}"
signature="$(printf '%s' "$canonical" | openssl dgst -sha256 -hmac "$CHANNEL_SECRET" -binary | base64 | tr '+/' '-_' | tr -d '=')"

curl -sS -X POST "$CHAT_API_BASE$target" \
  -H 'Content-Type: application/json' \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature" \
  --data-raw "$body"
```

Response:

```json
{
  "sessionId": "opaque-session-id",
  "tenantId": "opaque-tenant-id",
  "createdAt": "2026-10-21T06:00:00.000Z"
}
```

Store only the `sessionId` mapping. Do not expose `tenantId` to the visitor.

### 4.2 Send a visitor turn

Use a new UUID for `clientMessageId` on each new visitor turn. For a network retry, reuse the same `clientMessageId` and exact body:

```bash
body='{"sessionId":"opaque-session-id","message":"I need a demo for an ERP solution","clientMessageId":"8b6f5d7d-4fa5-4f71-8c2a-19dd6a5c7f11"}'
target='/api/v1/chat/messages'
# Generate timestamp, nonce, signature with sign_request before sending.

curl -sS -X POST "$CHAT_API_BASE$target" \
  -H 'Content-Type: application/json' \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature" \
  --data-raw "$body"
```

Response fields:

```json
{
  "messageId": "opaque-message-id",
  "sessionId": "opaque-session-id",
  "answer": "What name should I use?",
  "grounded": false,
  "conversational": true,
  "citations": [],
  "actionProposal": null,
  "requestId": "correlation-id"
}
```

Render `answer`, then any approved citations or action prompt. Do not display raw model data or internal IDs.

### 4.3 Read history

```bash
curl -sS "$CHAT_API_BASE/api/v1/chat/sessions/$SESSION_ID?limit=100" \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature"
```

Use history only to restore a channel thread. The connector remains responsible for mapping the external thread to the session.

## 5. Intent actions, consent, and async completion

The API returns an `actionProposal` only after server-side catalog scoring, required-slot validation, tenant authorization, and workflow allowlisting:

```json
{
  "id": "opaque-action-id",
  "intent": "crm.lead.create",
  "confirmation": "Consent to contact you and register this request.",
  "consentRequired": true,
  "expiresAt": "2026-10-21T06:15:00.000Z"
}
```

When `consentRequired` is `true`, render one explicit visitor action such as `Consent & Submit`. Do not ask a second “Should I submit?” question. The button confirmation records explicit consent and moves the existing action into the asynchronous workflow queue. It does not infer consent from an email address, phone number, or detected intent.

Confirm the action:

```bash
body="{\"sessionId\":\"$SESSION_ID\",\"confirmed\":true}"
target="/api/v1/chat/actions/$PROPOSAL_ID/confirm"
# Sign this exact method, target, and body with a fresh timestamp and nonce.

curl -sS -X POST "$CHAT_API_BASE$target" \
  -H 'Content-Type: application/json' \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature" \
  --data-raw "$body"
```

The response normally enters `approved`; the n8n poll/claim path changes it to `processing`, then `completed` or `failed`. Tell the visitor that the request is registered and continue the channel interaction without blocking on n8n, CRM, or a summary workflow.

Poll status when the channel needs a final state:

```bash
curl -sS "$CHAT_API_BASE/api/v1/chat/actions/$PROPOSAL_ID?sessionId=$SESSION_ID" \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature"
```

Never retry a timed-out external CRM create by posting directly. The backend/n8n workflow owns idempotency and reconciliation.

## 6. Optional supporting documents

Use the signed session routes only when the tenant's published catalog exposes document intake. The upload requires `processingConsent: true`, is accepted asynchronously with `202`, and must not block the conversation:

```bash
curl -sS -X POST "$CHAT_API_BASE/api/v1/chat/sessions/$SESSION_ID/documents" \
  -H 'Content-Type: application/json' \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature" \
  --data '{"fileName":"requirements.pdf","mimeType":"application/pdf","contentBase64":"<base64 bytes>","processingConsent":true,"primaryIntentKey":"anc.erp.requirements"}'
```

Poll the sanitized status route:

```bash
curl -sS "$CHAT_API_BASE/api/v1/chat/sessions/$SESSION_ID/documents" \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $timestamp" \
  -H "X-Agentic-Nonce: $nonce" \
  -H "X-Agentic-Signature: $signature"
```

Do not log or forward file bytes, extracted text, or private document URLs.

## 7. Connector adapter contract

Each connector should implement these operations:

```text
ensureSession(externalConversationId) -> sessionId
sendVisitorTurn(externalConversationId, text) -> answer/citations/actionProposal
confirmAction(externalConversationId, proposalId) -> actionState
getHistory(externalConversationId) -> messages
registerDocument(externalConversationId, file) -> queued document status
```

Recommended flow:

```text
incoming event
  -> resolve external conversation mapping
  -> create/reuse signed Agentic session
  -> send message with idempotent clientMessageId
  -> render answer/citations
  -> render Consent & Submit when consentRequired=true
  -> confirm once on visitor button click
  -> acknowledge registered/processing asynchronously
```

One connector credential may not be reused to impersonate another tenant. The API derives tenant scope from the signed credential and validates session/action ownership on every request.

## 8. Error handling

Handle the structured error envelope:

```json
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "This chat session has expired.",
    "requestId": "correlation-id"
  }
}
```

| Status | Connector behavior |
| --- | --- |
| 400 | Fix request format or JSON; do not retry unchanged. |
| 401 | Rotate/reload credential configuration and re-sign. |
| 403 | Stop; verify channel credential, origin, and tenant mapping. |
| 404 | Reconcile the external-to-session/action mapping. |
| 409 | Reuse the original idempotency key or surface the conflict. |
| 410 | Start a new session and tell the visitor the thread expired. |
| 413 | Reject or resize the attachment/message before retrying. |
| 422 | Ask for corrected input or explicit consent; do not bypass validation. |
| 429 | Honor `Retry-After` and retry with the same idempotency key. |
| 5xx | Retry boundedly with the same idempotency key; preserve `requestId`. |

## 9. Security checklist

- Use HTTPS outside the VM and keep the raw API port private.
- Store `CHANNEL_SECRET` only in a server-side secret manager.
- Never accept `tenantId` from an untrusted connector payload when using a signed channel credential.
- Redact visitor text, contact fields, file bytes, signatures, and secrets from logs.
- Use a fresh nonce/signature per request and the same `clientMessageId` only for a retry.
- Do not call n8n, Salesforce, PostgreSQL, or the model from a connector.
- Treat `answer` as user-facing output, but rely on `citations` for factual business claims.
- Keep connector adapters channel-specific; share only the signed API client and external-thread mapping logic.

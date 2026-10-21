# Omnichannel chat API

This is the connector-facing API for the existing tenant chat gateway. A connector should keep one `sessionId` per external conversation/thread, send a new UUID as `clientMessageId` for every visitor turn, and pass the response back to that channel. Tenant and channel scope come from a signed channel credential; do not accept them from an untrusted connector payload.

## Base URL from the VM

Inside the VM, the local API is normally:

```bash
export CHAT_API_BASE='http://127.0.0.1:4000'
```

For a connector running outside the VM, use the HTTPS reverse-proxy URL configured for the API. The local Compose binding is intentionally not an external public API contract. Do not expose the API with a raw HTTP port when TLS is available.

## Read public chat configuration

Browser/web connectors can read the tenant presentation configuration with the approved tenant slug. Server-to-server connectors should use their signed channel credential instead of trusting a tenant ID from the caller:

```bash
curl "$CHAT_API_BASE/api/v1/chat/config?tenantSlug=anc-test" \
  -H 'Origin: https://your-channel.example'
```

The response includes the tenant persona and document-intake capability. It does not include database credentials, workflow secrets, or private document contents.

## Create a channel credential once

An authenticated tenant administrator creates one credential per connector/channel:

```bash
curl -X POST "$CHAT_API_BASE/api/v1/admin/channels" \
  -H "Authorization: Bearer $ADMIN_SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"channel":"whatsapp","authMode":"api_key"}'
```

Store the returned `keyId` and one-time `secret` in the connector secret store. API-key secrets use `zv3_<tenant_slug>-<36-character-crypto-random>`. The secret is not returned by later list calls. Use a separate credential for each tenant/channel or integration. The signed HMAC contract below remains available for connectors that choose `authMode: "hmac"`.

For an API-key connector, tenant scope is resolved from the database credential:

```bash
export CHANNEL_API_KEY='<one-time secret from the create response>'
curl -sS -X POST "$CHAT_API_BASE/api/v1/chat/sessions" \
  -H "X-Agentic-Api-Key: $CHANNEL_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{}'
```

## Request signing

Every signed request sends these headers:

```text
X-Agentic-Key-Id: issued keyId
X-Agentic-Timestamp: Unix seconds
X-Agentic-Nonce: unique 8–128 character value
X-Agentic-Signature: base64url(HMAC-SHA256(secret, canonical request))
```

The canonical value is exactly:

```text
METHOD\nREQUEST_TARGET\nTIMESTAMP\nNONCE\nEXACT_JSON_BODY
```

`REQUEST_TARGET` includes the raw query string. Requests outside the replay window or with a reused nonce are rejected. The body used for signing must be byte-for-byte identical to the body sent by `curl`.

The following PowerShell helper creates a signed session request from inside the VM. It uses `{}` because the credential already determines the tenant:

```powershell
$path = '/api/v1/chat/sessions'
$body = '{}'
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$nonce = [guid]::NewGuid().ToString('N')
$canonical = "POST`n$path`n$timestamp`n$nonce`n$body"
$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($env:CHANNEL_SECRET))
$raw = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))
$signature = $raw.TrimEnd('=').Replace('+','-').Replace('/','_')

curl.exe -X POST "$env:CHAT_API_BASE$path" `
  -H 'Content-Type: application/json' `
  -H "X-Agentic-Key-Id: $env:CHANNEL_KEY_ID" `
  -H "X-Agentic-Timestamp: $timestamp" `
  -H "X-Agentic-Nonce: $nonce" `
  -H "X-Agentic-Signature: $signature" `
  --data-raw $body
```

For Linux, use the same canonical string and base64url HMAC calculation in the connector runtime; do not put the channel secret in browser JavaScript.

## Start a session

The response contains the opaque `sessionId`. Map it to the external conversation ID in the connector's own store:

```json
{
  "sessionId": "opaque-session-id"
}
```

## Send a chat message

Sign and send the exact JSON body. `clientMessageId` makes retries idempotent:

```powershell
$path = '/api/v1/chat/messages'
$body = '{"sessionId":"opaque-session-id","message":"I need an ERP solution for my company","clientMessageId":"8b6f5d7d-4fa5-4f71-8c2a-19dd6a5c7f11"}'
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
$nonce = [guid]::NewGuid().ToString('N')
$canonical = "POST`n$path`n$timestamp`n$nonce`n$body"
$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($env:CHANNEL_SECRET))
$raw = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))
$signature = $raw.TrimEnd('=').Replace('+','-').Replace('/','_')

curl.exe -X POST "$env:CHAT_API_BASE$path" `
  -H 'Content-Type: application/json' `
  -H "X-Agentic-Key-Id: $env:CHANNEL_KEY_ID" `
  -H "X-Agentic-Timestamp: $timestamp" `
  -H "X-Agentic-Nonce: $nonce" `
  -H "X-Agentic-Signature: $signature" `
  --data-raw $body
```

Typical response fields are `messageId`, `sessionId`, `answer`, `grounded`, `citations`, `actionProposal`, and `requestId`. The connector should display only `answer` and approved citations/action prompts; it should not expose internal IDs or raw model output. When `actionProposal.consentRequired` is `true`, render the proposal as one explicit `Consent & Submit` button; its approval records consent and enters the existing asynchronous workflow queue, so no second submit question is needed.

## Read history and confirm an approved action

```bash
curl "$CHAT_API_BASE/api/v1/chat/sessions/$SESSION_ID?limit=100" \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $TIMESTAMP" \
  -H "X-Agentic-Nonce: $NONCE" \
  -H "X-Agentic-Signature: $SIGNATURE"

curl -X POST "$CHAT_API_BASE/api/v1/chat/actions/$PROPOSAL_ID/confirm" \
  -H 'Content-Type: application/json' \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $TIMESTAMP" \
  -H "X-Agentic-Nonce: $NONCE" \
  -H "X-Agentic-Signature: $SIGNATURE" \
  --data "{\"sessionId\":\"$SESSION_ID\",\"confirmed\":true}"
```

Each request must use a fresh timestamp, nonce, signature, and exact request body. The examples above show the routes; a production connector should generate the headers for every request rather than reuse them.

## Document attachments

If the tenant's published intent catalog enables document intake, the connector can inspect configuration and register an explicit-consent upload:

```bash
curl "$CHAT_API_BASE/api/v1/chat/sessions/$SESSION_ID/documents/config" \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $TIMESTAMP" \
  -H "X-Agentic-Nonce: $NONCE" \
  -H "X-Agentic-Signature: $SIGNATURE"

curl -X POST "$CHAT_API_BASE/api/v1/chat/sessions/$SESSION_ID/documents" \
  -H 'Content-Type: application/json' \
  -H "X-Agentic-Key-Id: $CHANNEL_KEY_ID" \
  -H "X-Agentic-Timestamp: $TIMESTAMP" \
  -H "X-Agentic-Nonce: $NONCE" \
  -H "X-Agentic-Signature: $SIGNATURE" \
  --data '{"fileName":"requirements.pdf","mimeType":"application/pdf","contentBase64":"<base64 bytes>","processingConsent":true,"primaryIntentKey":"anc.erp.requirements"}'
```

The upload response is asynchronous (`202`). Poll `GET /api/v1/chat/sessions/:id/documents`; the connector should tell the visitor that the document was registered and continue the conversation without waiting for OCR. Raw files and extracted text remain backend-controlled and are not sent to the connector by the public list route.

## Connector rules

- Keep external conversation/thread ID → `sessionId` mapping in the connector.
- Retry with the same `clientMessageId`; never create a new one for a network retry.
- Generate a new nonce/signature for every request.
- Store channel secrets only in a server-side secret manager.
- Redact message content, email, phone, file bytes, and signatures from logs.
- Treat `401`, `403`, `409`, `413`, `422`, and `429` as actionable connector errors; retain `requestId` for support.
- Do not call n8n or PostgreSQL directly. All tenant checks, grounding, intent qualification, consent, and workflows remain behind the API.

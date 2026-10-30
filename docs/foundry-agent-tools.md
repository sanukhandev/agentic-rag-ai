# Microsoft Foundry OpenAPI agent tools

The Node API exposes two read-only operations:

- `POST /api/v1/foundry/tools/search-knowledge` (`search_knowledge`)
- `POST /api/v1/foundry/tools/get-journey-state` (`get_journey_state`)

The implementation is in `services/api/src/routes/foundry-tools.ts`. Knowledge retrieval reuses the existing tenant/source-filtered store queries and vector ranking in `services/api/src/knowledge.ts`; it does not create a second vector store or call n8n/CRM providers. The route writes only redacted audit metadata.

Full-text query input is normalized centrally into safe `simple`-configuration terms before PostgreSQL `to_tsquery` is called. Raw input such as `company formation packages ANC` previously caused PostgreSQL to raise a tsquery syntax error; after normalization the gateway returns the normal grounded/no-evidence contract instead of a generic retrieval failure. The live database reports `vector(1536)` and its stored vectors are 1536-dimensional, matching `AZURE_AI_EMBEDDING_DIMENSION=1536` and the configured Azure embedding provider.

The Foundry route timeout remains 5 seconds, while the Azure embedding adapter allows up to 60 seconds per request and retries throttling. A timeout is logged internally as `category: "timeout"` and returned as `FOUNDRY_TOOL_TIMEOUT`; embedding and database failures are logged separately as `embedding` or `database` without exposing provider details to clients. The observed failure was the PostgreSQL tsquery syntax error, not a timeout.

## Authentication

The production contract is Microsoft Entra ID bearer-token validation:

| Setting | Purpose |
| --- | --- |
| `FOUNDRY_TOOLS_ENTRA_TENANT_ID` | Entra tenant used to derive the issuer and JWKS URL, unless those are explicitly set. |
| `FOUNDRY_TOOLS_AUDIENCE` | Exact audience accepted by the Node API. |
| `FOUNDRY_TOOLS_ALLOWED_APP_IDS` | Comma-separated Foundry project/application IDs allowed to call the gateway. |
| `FOUNDRY_TOOLS_ALLOWED_OBJECT_IDS` | Optional comma-separated managed-identity object IDs; when set, the verified `oid` claim must also match. |
| `FOUNDRY_TOOLS_TENANT_ID` | Explicit server-side tenant scope for the initial single-development-tenant integration. |
| `FOUNDRY_TOOLS_IDENTITY_TENANT_MAP` | Optional JSON object mapping allowed application IDs to tenant IDs for a reviewed multi-tenant deployment. |
| `FOUNDRY_TOOLS_ISSUER` / `FOUNDRY_TOOLS_JWKS_URL` | Optional exact issuer/key endpoints when the tenant uses a verified non-default configuration. |
| `FOUNDRY_TOOLS_INTERNAL_ROLE` | Optional app role required before internal sources are eligible; default `foundry.tools.internal`. |

Tenant scope is selected from server configuration, never from the request body or model output. The gateway verifies issuer, audience, signature, expiry, key ID, application ID, and configured tenant mapping. Azure resource Reader permissions are not treated as business-data authorization.

For controlled development only, set `FOUNDRY_TOOLS_ALLOW_API_KEY=true`, `FOUNDRY_TOOLS_API_KEY` (or comma-separated `FOUNDRY_TOOLS_API_KEYS` during rotation), and `FOUNDRY_TOOLS_API_KEY_TENANT_ID` outside source control. The API-key variant is in `openapi/foundry-agent-tools.api-key.openapi.json`; it is rejected by the application in production. Keep both old and new keys only for the overlap window, then remove the old key and restart the API.

## Hosted tools and customer chat

The two read-only routes in this document remain a separately authenticated Foundry OpenAPI tool gateway. They are not the customer chat generation path. Customer chat now calls the existing `POST /api/v1/chat/messages` route, which loads tenant-scoped persona/catalog/journey state and approved evidence in Node, then invokes the named `agentic-rag-core-dev` agent through the official SDK and Azure CLI. The adapter does not register or dispatch hosted tools, and it never sends tenant or session identifiers to the model.

The local runtime configuration is documented in [foundry-local-development.md](foundry-local-development.md). Keep this hosted-tool authentication and its routes because existing Foundry tool integrations still reference them; remove or detach any unsafe remote OpenAPI attachment only through a separately authorized Foundry change.

## Foundry portal setup

The customer-facing agent must not have the historical development-tunnel OpenAPI attachment. Keep the remote serving selector on the reviewed tool-free version, or independently validate an explicitly referenced candidate with only the application function schemas documented in [the single-journey verification](verification/ancfz-single-journey-tool-calling.md).

The checked-in OpenAPI contracts and their API-key/Entra authentication code remain compatibility-only because existing operator integrations still reference them. Do not attach `agentic_rag_knowledge`, a development tunnel, or `foundryApiKey` to the customer-facing agent. Any remote attachment change requires an authorized Foundry change, independent metadata verification, and a rollback version.

For an authorized compatibility gateway test, deploy the Node API behind a verified HTTPS hostname, configure the authentication values above, and verify tenant mapping and redacted responses. Do not expose localhost, Postgres, Redis, n8n, or the mock payment service. Foundry connection/resource IDs, audience, managed-identity claims, and live reachability remain Azure-side values; none are committed here.

For the application broker, the rollout order is: verify the Foundry project endpoint and managed-identity permissions; apply migration `054-foundry-conversation-bindings.sql`; set the feature flag only in the intended environment; create a session through the Node API; call the application route with its returned session token; then review the API request ID and Foundry trace. Do not reuse the hosted API key as the customer-session credential.

## Safe examples

Grounded search:

```json
{
  "status": "grounded",
  "answer": "<bounded text copied from approved source excerpts>",
  "citations": [
    {
      "sourceId": "<authorized-source-id>",
      "title": "<authorized-source-title>",
      "chunkId": "<authorized-chunk-id>",
      "locator": "section 2",
      "excerpt": "<redacted approved excerpt>"
    }
  ]
}
```

No binding:

```json
{
  "status": "not_linked",
  "currentStage": null,
  "completedStages": [],
  "nextRequirement": null
}
```

No evidence returns `status: "no_evidence"`, a bounded abstention, and an empty citation list. The gateway never advances a stage, mutates intent, creates an action, or calls an external business provider.

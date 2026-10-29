# Microsoft Foundry OpenAPI agent tools

The Node API exposes two read-only operations:

- `POST /api/v1/foundry/tools/search-knowledge` (`search_knowledge`)
- `POST /api/v1/foundry/tools/get-journey-state` (`get_journey_state`)

The implementation is in `services/api/src/routes/foundry-tools.ts`. Knowledge retrieval reuses the existing tenant/source-filtered store queries and vector ranking in `services/api/src/knowledge.ts`; it does not create a second vector store or call n8n/CRM providers. The route writes only redacted audit metadata.

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

For controlled development only, set `FOUNDRY_TOOLS_ALLOW_API_KEY=true`, `FOUNDRY_TOOLS_API_KEY`, and `FOUNDRY_TOOLS_API_KEY_TENANT_ID` outside source control. The API-key variant is in `openapi/foundry-agent-tools.api-key.openapi.json`; it is rejected by the application in production.

## Journey-state binding

`get_journey_state` never accepts a session ID. It returns `not_linked` unless the application is constructed with a trusted `foundrySessionBinding` resolver. That resolver must derive a session binding from the verified integration identity and an approved server-side correlation, then return the session ID; it must not use model-supplied input. No live customer-session binding is configured by this change, so a real Foundry call will safely return `not_linked` until that boundary is implemented and reviewed.

## Foundry portal setup

1. Deploy the Node API behind a verified HTTPS hostname. Do not expose localhost, HTTP, Postgres, Redis, n8n, or the mock payment service.
2. Set the authentication environment values above, map the Foundry project identity to the approved development tenant, and restart the API. Obtain the real values from the Azure/Foundry operator; none are committed here.
3. Open `agentic-rag-core-dev` in Microsoft Foundry.
4. Select **Tools → Add → Custom → OpenAPI tool**.
5. Use a tool name such as `agentic_rag_read_only` and import `openapi/foundry-agent-tools.openapi.json` after replacing `YOUR_VERIFIED_API_HOSTNAME` with the actual API origin.
6. Select or create a project managed identity connection. Enter the API target URL and the exact registered Microsoft Entra Application ID URI as the audience; the audience is the target API resource, not the Foundry project endpoint. The current Foundry OpenAPI guidance keeps API key, bearer token, and project managed identity as separate variants and requires a project connection for each. See [Microsoft's OpenAPI tool guidance](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/tools/openapi?view=foundry).
7. Ensure the API's allowed application/object identity configuration matches the managed identity token claims (`azp` and, when configured, `oid`). Do not use an administrator token or a connection that is not mapped to the approved tenant.
8. Save and attach the tool. Test `search_knowledge` with `{ "query": "What company formation packages are available?", "maxResults": 4 }`.
9. Test `get_journey_state` with `{}` and expect `not_linked` until the trusted session-binding resolver is configured.
10. Review the Foundry trace and the API `x-request-id`; confirm the response contains only approved citations, no private tenant data, no customer PII, and no write/action calls.

The deployment hostname and Foundry connection/resource IDs are intentionally unresolved because no verified HTTPS deployment or Azure-side configuration was available in this local implementation task.

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

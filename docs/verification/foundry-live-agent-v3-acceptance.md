# Historical: Foundry live agent v3 acceptance

> Superseded by the pinned v4 runtime and the isolated v6 application-function candidate documented in [the current single-journey verification](ancfz-single-journey-tool-calling.md). This file is retained as historical evidence; its v3 hosted-tool configuration is not a current deployment instruction.

Date: 2026-10-29

## Result

**BLOCKED — the Node broker was not activated and no live broker success is claimed.**

The saved agent is reachable with the existing Windows Azure CLI login, but version 3 still has a hosted OpenAPI tool attached. That tool points at the development tunnel and uses the `foundryApiKey` security scheme. The Node-side dispatcher cannot remove or constrain a hosted Foundry tool at request time, so enabling the generic multi-tenant broker would leave a tenant-authorization bypass path.

No Azure resource, agent, endpoint, permission, or version-selector change was made.

## Configuration

The ignored local `.env` now contains the following non-secret development settings:

| Setting | Value/status |
| --- | --- |
| `FOUNDRY_APPLICATION_PROVIDER` | `foundry_agent_entra` |
| `FOUNDRY_APPLICATION_ENABLED` | `false` |
| `FOUNDRY_PROJECT_ENDPOINT` | `https://foundry-aipoc-sc.services.ai.azure.com/api/projects/proj-ai-poc-sc` |
| `FOUNDRY_AGENT_NAME` | `agentic-rag-core-dev` |
| `FOUNDRY_AGENT_VERSION` | `3` |
| `FOUNDRY_AZURE_CREDENTIAL` | `azure_cli` |
| `FOUNDRY_ISOLATION_MODE` | `entra` |

The provider remains disabled until the hosted-tool and version-routing gates are resolved. The existing Azure OpenAI API-key adapter remains available as a separate, explicitly selected development provider.

## Read-only live verification

- Azure CLI `2.91.0` is installed and an existing user login is present.
- A token for `https://ai.azure.com/.default` was acquired without printing the token.
- `AzureCliCredential` acquired the same scope successfully when the Azure CLI directory was present on the host `PATH`.
- Available agent versions are `1`, `2`, and `3`; version `3` is active and uses `gpt-4.1-mini`.
- The agent endpoint exposes the Responses protocol and Entra authorization/isolation.
- The endpoint selector currently routes `100%` to `@latest`. Version `3` is currently the latest version, but the endpoint is not pinned to `3`; pinning would require an approved Azure-side change.

## Attached-tool security finding

Version `3` has one attached tool:

- type: `openapi`
- name: `agentic_rag_knowledge`
- operations: `get_journey_state`, `search_knowledge`
- server host: `c3srnt4h-80.inc1.devtunnels.ms`
- authentication: project connection plus OpenAPI `foundryApiKey`

Although the operations are read-only, this is the previously ANC-bound hosted connection. It must be removed from the generic agent version or replaced with a separately approved isolated configuration before the same saved agent can be used by the multi-tenant application broker. This report intentionally does not expose connection identifiers or credentials.

## Node implementation and tests

Implemented locally:

- Explicit `AzureCliCredential` selection for host-based development.
- Production rejection of the Azure CLI credential mode.
- `.env.example` and Compose configuration for the credential selector.
- Existing persisted-agent adapter, API-key adapter, tenant/session binding, and Node function dispatcher preserved.

Checks completed:

- Foundry application tests: **9 passed**.
- API typecheck: **passed**.
- Full workspace tests: **241 passed, 12 skipped**.
- Workspace typecheck, lint, build, and Compose verification: **passed**.
- Docker API was rebuilt and is healthy with the broker disabled.
- Host API boot was verified on port `4100` against Postgres and Redis bound to localhost, with the broker disabled; health returned `{"status":"ok"}`.

Not run as a live acceptance because activation is blocked:

- Node host broker first turn.
- Second-turn durable Foundry conversation continuity.
- Live Node-dispatched RAG citation verification.
- Runtime cross-tenant and unauthorized-session acceptance against the saved agent.

## Required unblock steps

1. Obtain approval to remove the ANC hosted OpenAPI tool from the generic agent path, or provide a separately isolated agent version/endpoint whose only customer-data access is the Node-authorized dispatcher.
2. Pin the endpoint selector to agent version `3` if stable v3 routing is required; do this manually through the approved Foundry change process.
3. Confirm that any previously exposed Azure/API and channel credentials have been rotated before enabling any integration that depends on them.
4. Run the host API with the Azure CLI directory on `PATH`, Postgres on `127.0.0.1:54329`, Redis on its existing local port, and `FOUNDRY_APPLICATION_ENABLED=true` only in the isolated development process.
5. Re-run the authenticated first-turn, second-turn, citation, and session-isolation tests, then return this report to PASS only with real broker evidence.

Host-run command after the hosted-tool gate is cleared:

```powershell
$env:Path = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin;$env:Path"
docker compose -f docker-compose.yml -f docker-compose.local-db.yml up -d postgres redis
Push-Location services/api
$env:PORT = "4100"
$env:STORE = "postgres"
$env:DATABASE_URL = "postgres://agentic:agentic_local_only@127.0.0.1:54329/agentic_rag"
$env:REDIS_URL = "redis://127.0.0.1:6379"
$env:FOUNDRY_APPLICATION_ENABLED = "true"
node --env-file=../../.env --import tsx/esm src/index.ts
Pop-Location
```

The host process must be stopped and the broker disabled again after the isolated test. The command does not expose Azure CLI credentials to Docker.

## References

- Microsoft Foundry agent endpoint configuration and version selectors: <https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/configure-agent>
- Microsoft Foundry REST API reference: <https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/aiproject>

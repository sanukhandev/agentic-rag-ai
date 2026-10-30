# Local Foundry agent development

The customer path is:

`Customer → Node Chat API → tenant persona/catalog/journey + approved pgvector evidence → named Foundry agent → existing Chat API response`

Node performs authorization, PII masking, retrieval, intent/catalog evaluation, journey gates, response validation and action authorization. The agent only supplies conversational wording. Admin and customer APIs are unchanged; Foundry conversation IDs are stored only in the tenant/session-scoped `foundry_conversation_bindings` table.

## Docker and Azure CLI

Start the local stack with the development-only API image:

```powershell
docker compose -f docker-compose.yml -f docker-compose.foundry.local.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.foundry.local.yml exec --user node api az login --use-device-code
docker compose -f docker-compose.yml -f docker-compose.foundry.local.yml exec --user node api az account show
```

The API image is `api-foundry-local`; the production `api-runtime` image has no Azure CLI. CLI state is stored in the private named volume `foundry-azure-cli-config` at `/home/node/.azure`. Tokens are not copied into the image, `.env`, logs or the repository.

The override requires:

```text
CHAT_MODEL_PROVIDER=foundry-agent
FOUNDRY_AUTH_MODE=azure-cli
FOUNDRY_PROJECT_ENDPOINT=https://foundry-aipoc-sc.services.ai.azure.com/api/projects/proj-ai-poc-sc
FOUNDRY_AGENT_NAME=agentic-rag-core-dev
FOUNDRY_EXPECTED_AGENT_VERSION=4
FOUNDRY_HOSTED_TOOLS_ENABLED=false
```

The stable local serving configuration remains pinned to v4. A candidate with application-executed function tools can be tested without promotion by setting `FOUNDRY_EXPECTED_AGENT_VERSION` and `FOUNDRY_INVOCATION_VERSION` to the candidate, `FOUNDRY_APPLICATION_TOOLS_ENABLED=true`, and `FOUNDRY_REQUIRE_SERVING_VERSION=false` in an isolated development container. The candidate is still checked against the explicit function registry; hosted OpenAPI, MCP, browser, code-execution and unknown tools fail closed.

The API verifies the expected agent version with the Foundry project client before the first response. It does not create or modify an agent. The current SDK routes the Responses client to the named agent endpoint; remote hosted-tool attachments remain an Azure-side safety gate and are not disabled by a local environment variable.

## Request sequence and contract

`POST /api/v1/chat/sessions` creates the application session. `POST /api/v1/chat/messages` keeps its existing request and response schema. The adapter creates one Foundry conversation for the session, reuses the durable binding on later turns, sends each masked turn once, and maps `response.output_text` to `answer`. `messageId`, `sessionId`, `grounded`, `conversational`, `citations`, `actionProposal`, pending prompt fields and `requestId` remain Node-owned. Foundry IDs never leave the backend.

The context sent to Foundry is bounded and contains the configured persona, latest masked message, rolling masked summary, current catalog/journey requirement, validated masked facts and approved evidence with citation IDs. Intent selection, stage transitions, consent and n8n/Salesforce actions remain deterministic server behavior.

When a candidate agent emits a Responses `function_call`, Node validates the function name and strict JSON arguments, derives tenant/session/opportunity scope from PostgreSQL, executes only the read-only registry handler, bounds and sanitizes the result, records a redacted audit event, and sends a `function_call_output` on the same Foundry conversation. The current registry is `search_knowledge`, `get_journey_state`, `get_available_packages`, `get_document_requirements`, and `get_action_status`. No function accepts a model-supplied tenant, session, opportunity, provider, payment or contract identifier.

## Verification

```powershell
npm run typecheck
npm test
npm run lint
npm run build
npm run verify:compose
docker compose -f docker-compose.yml -f docker-compose.foundry.local.yml config
npm run qa:ancfz-single-journey
```

Live smoke testing additionally requires an Azure CLI identity with access to the project and the expected agent version. Verify `az account show` and a non-empty response for `Hi`, followed by a second message in the same session. A 401/403, missing version, or attached unsafe hosted tool is a blocker; do not fall back to an API key or a model deployment.

Host-mode development may run the API with Windows Azure CLI while PostgreSQL, Redis and n8n stay in the existing local Docker override. It is a fallback only; production networking and credentials are unchanged.

# Historical: Foundry tenant/session binding verification

> Historical verification evidence. The current customer path uses the official Conversations/Responses client with the pinned v4 serving configuration and the explicit application-function candidate boundary described in [the current single-journey verification](ancfz-single-journey-tool-calling.md).

Date: 2026-10-29
Branch: `feat/open-foundry-agent-upgrade`

## Result

The locally testable Node-side broker is implemented, with the existing hosted ANC OpenAPI tools preserved separately. The application broker is feature-flagged off by default. No Azure resource was changed and no live authenticated Foundry Responses API invocation was claimed.

## Implemented boundary

- `POST /api/v1/chat/foundry/messages` accepts only a server-created `sessionId`, message, and client message ID.
- `POST /api/v1/chat/sessions` returns a session access token only at creation; only its SHA-256 hash is persisted.
- The application route reuses existing chat session authorization, tenant ownership, PII masking, answer safety checks, and response rehydration.
- Foundry conversation bindings persist tenant, application session, Foundry conversation, agent/version, status, revision, timestamps, expiry, and revocation state.
- `search_knowledge` and `get_journey_state` are dispatched in Node with an immutable server-resolved tenant/session context. Model arguments cannot supply authoritative tenant or session identifiers.
- The adapter now targets the saved agent endpoint at `/agents/agentic-rag-core-dev/endpoint/protocols/openai/...` and no longer sends the older project-level `agent_reference` request. There is no silent generic-model fallback.
- Retrieval remains the existing PostgreSQL/pgvector path with approved-source filters, citations, ranking, and the shared safe full-text normalizer.
- The hosted ANC OpenAPI route remains available for its isolated development test. Without a separately reviewed trusted hosted-session resolver, its journey operation safely returns `not_linked`.

## Changed files

- `services/api/src/foundry-responses.ts`
- `services/api/src/foundry-functions.ts`
- `services/api/src/routes/foundry-application.ts`
- `services/api/src/types.ts`
- `services/api/src/store-memory.ts`
- `services/api/src/store-postgres.ts`
- `infra/postgres/054-foundry-conversation-bindings.sql`
- `services/api/src/foundry-application.test.ts`
- `services/api/src/app.ts`
- `docker-compose.yml`
- `docs/foundry-agent-tools.md`

The same working tree also contains the earlier full-text query and hosted-tool diagnostics changes. No commit, push, merge, public deployment, or Azure resource mutation was performed.

## Verification evidence

- API typecheck: passed.
- Focused application broker tests: 5 passed.
- Focused persisted-agent URL contract test: passed; the fake upstream saw the saved-agent endpoint and no `agent_reference` field.
- PostgreSQL integration tests: 10 passed, including multiword full-text normalization and tenant isolation.
- Full API regression suite: 237 passed, 12 skipped across 35 test files.
- API lint and repository lint: passed.
- Repository typecheck: passed.
- Repository production build: passed for admin, web, API, chat-utils, and contracts.
- Rebuilt Docker API image and container: passed; container became healthy.
- Local authenticated hosted-tool smoke test: `search_knowledge` returned HTTP 200 with `grounded` and 4 citations; `get_journey_state` returned HTTP 200 with `not_linked`.
- VS Code tunnel authenticated hosted-tool smoke test: `search_knowledge` returned HTTP 200 with `grounded` and 4 citations; `get_journey_state` returned HTTP 200 with `not_linked`.
- The application tests cover distinct tenant/session bindings, forged session/token rejection, revoked/expired access, rejection of model-supplied identity arguments, prompt masking before upstream dispatch, and no business-state mutation from the two read-only functions.
- Migration applied locally; `chat_session_access_tokens` and `foundry_conversation_bindings` were present in PostgreSQL.

A live Foundry call is not a local verification substitute and remains pending Azure configuration.

## Azure and rollout blockers

Before enabling `FOUNDRY_APPLICATION_ENABLED`, an operator must verify the real HTTPS project endpoint, the agent/version, the project managed identity assignment, token audience/scope, and Foundry project access. The adapter uses the current Foundry Responses API shape and `https://ai.azure.com/.default`, but these values were not verified against the configured Azure project in this run.

The local machine has no `az`/`azd` command and `DefaultAzureCredential` could not acquire a token because no supported environment, managed identity, or CLI credential is available. Therefore the saved agent, available versions, endpoint protocol, authorization scheme, isolation scheme, attached tools, RBAC, and live response were not independently verified.

The selected agent must also be checked for its existing ANC hosted OpenAPI tool. A Node dispatcher does not remove tools attached to the persisted agent. If that ANC-only tool is still attached to the version served by the stable endpoint, generic activation remains blocked until an authorized Foundry operator provides a safe agent version/endpoint configuration without that tool.

The existing development tunnel hostname is only the hosted ANC OpenAPI target. It is not proof that the new application broker is reachable or that managed-identity authentication works. Keep the feature flag false until an authenticated end-to-end test succeeds.

## Security notes

The API key used by the hosted ANC development route is not a customer identity and must not be used to bind every caller to one mutable session. Session access tokens are scoped to one Node session and are not accepted as tenant claims. Responses contain bounded, sanitized tool output; no customer PII, token values, or Foundry bearer tokens are intentionally logged or returned.

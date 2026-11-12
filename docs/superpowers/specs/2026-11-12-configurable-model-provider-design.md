# Configurable OpenAI/Azure Model Provider Design

## Intent

Make the private Python model gateway select either OpenAI or Azure OpenAI/Foundry from environment configuration, so the conversation code and Node boundary remain unchanged while local development can switch providers safely.

## Goals

- Support `AI_PROVIDER=openai|azure`.
- Use provider-specific endpoint, API key, and model/deployment configuration.
- Keep existing `AZURE_OPENAI_*` variables working for rollback and existing deployments.
- Report provider readiness without returning credentials.
- Test provider selection and model-name propagation without making live provider calls.

## Non-goals

- Provider load balancing or automatic failover.
- Moving secrets into source control, Docker layers, logs, tests, or Node/UI.
- Changing conversation planning, tool authorization, retries, or public API contracts.
- Updating VM/production credentials.

## Chosen approach

Use one `AsyncOpenAI` client with a provider-selected base URL, key, and model. OpenAI uses `https://api.openai.com/v1` by default and the active OpenAI profile uses `gpt-5.4`; Azure uses the configured `/openai/v1` endpoint and keeps `gpt-5.4` as its deployment profile. The active provider is selected at gateway startup/restart; no provider credentials are combined or exposed.

## Configuration contract

- `AI_PROVIDER`: `openai` or `azure`; legacy `MODEL_MODE=mock` still selects the mock client.
- `AI_MODEL`: active provider model; falls back to `OPENAI_MODEL` for OpenAI or `AZURE_OPENAI_DEPLOYMENT` for Azure.
- `AI_API_KEY`: active provider key; falls back to `OPENAI_API_KEY` or `AZURE_OPENAI_API_KEY`.
- `AI_BASE_URL`: optional active provider endpoint; defaults to `https://api.openai.com/v1` for OpenAI and `AZURE_OPENAI_BASE_URL` for Azure.
- Existing Azure variables remain supported unchanged.

## Safety and acceptance

The pasted key is not written to the repository or `.env`. A rotated key must be supplied through the local secret environment. Unit tests assert configuration/readiness behavior and secret non-disclosure; the test run must include the model-gateway suite and repository checks that do not require external credentials.

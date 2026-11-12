# Configurable OpenAI/Azure Model Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the private Python model gateway select OpenAI or Azure OpenAI/Foundry by environment configuration while preserving existing Azure configuration and keeping secrets private.

**Architecture:** Keep the existing `AsyncOpenAI` Responses API and reliability path. Add one provider-resolution function in `services/model-gateway/gateway/app.py`; use its selected base URL, API key, and model for client creation, readiness, normal model calls, and the conversation agent. OpenAI defaults to `https://api.openai.com/v1`; Azure keeps the configured `/openai/v1` endpoint and `gpt-5.4` deployment profile.

**Tech Stack:** Python 3.12, FastAPI, OpenAI Python SDK, pytest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-12-configurable-model-provider-design.md`

## Global Constraints

- Never write or echo the user-provided API key; it must be rotated and supplied through the private runtime environment.
- Preserve `MODEL_MODE=mock` and existing `AZURE_OPENAI_*` compatibility.
- Do not alter Node/API conversation contracts, retries, tool authorization, data, SSL files, or VM/production credentials.
- The gateway must not expose API keys in readiness output, logs, tests, or Docker images.
- Use TDD: add and run failing tests before production code, then run the full model-gateway suite.

## Review Focus

- OpenAI selection must use the OpenAI default endpoint and active model without requiring Azure variables.
- Azure selection must continue to use the existing endpoint/deployment/key variables and accept the new aliases.
- Invalid provider or endpoint configuration must fail closed with `MODEL_NOT_CONFIGURED`/`not_configured`.
- Readiness must identify the active provider/model without leaking credentials.
- The v2 conversation agent must receive the same selected model as `/plan` and `/normalize`.

### Task 1: Provider configuration and gateway tests

**Files:**
- Modify: `services/model-gateway/tests/test_app.py`
- Modify: `services/model-gateway/gateway/app.py`

**Interfaces:**
- Produce `model_provider_config() -> dict[str, str]` with `provider`, `base_url`, `model`, and `api_key` for internal use only.

- [ ] Step 1: Add tests for OpenAI selection, Azure legacy selection, Azure alias selection, invalid provider, and secret-safe readiness.
- [ ] Step 2: Run the focused tests and verify they fail because the provider resolver does not exist or still reports Azure-only behavior.
- [ ] Step 3: Implement the minimal resolver and use it in `_client_get()`, `model_readiness()`, `_model()`, and the v2 agent constructor; keep mock mode unchanged.
- [ ] Step 4: Run the focused tests and verify they pass.
- [ ] Step 5: Run `python -m pytest services/model-gateway/tests -q` and fix only regressions caused by this change.

### Task 2: Runtime configuration templates and documentation

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `services/model-gateway/README.md`
- Modify: `docs/model-gateway.md`

- [ ] Step 1: Add non-secret `AI_PROVIDER`, `AI_MODEL`, `AI_BASE_URL`, and `AI_API_KEY` environment pass-through; retain Azure variables.
- [ ] Step 2: Document the OpenAI and Azure profiles, fallback order, restart requirement, and secret rotation rule.
- [ ] Step 3: Verify templates contain no credential values and Compose interpolation remains valid.

### Task 3: Local verification

- [ ] Step 1: Run `python -m pytest services/model-gateway/tests -q`.
- [ ] Step 2: Run the repository typecheck/lint/build checks that are available without external provider credentials.
- [ ] Step 3: Build the model-gateway image and start/recreate only the local model-gateway service if Docker is available.
- [ ] Step 4: Check `/internal/health/ready` in mock mode and in configured-provider mode without sending a live request unless a rotated key is present.
- [ ] Step 5: Report exact pass/fail results and distinguish configuration readiness from live provider connectivity.

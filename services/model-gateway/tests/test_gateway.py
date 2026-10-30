import asyncio
import logging

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from gateway import app as module
from gateway.reliability import CircuitBreaker, SlidingWindowRateLimiter

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MODEL_GATEWAY_SERVICE_KEY", "test-private-key")
    return TestClient(module.app)

def test_internal_auth_required(client):
    res = client.post("/internal/v1/model/plan", json={"requestId": "auth-test", "message": "test"})
    assert res.status_code == 401

def test_no_fabricated_knowledge_when_evidence_missing(client, monkeypatch):
    async def fake_model(system, payload, schema, name):
        return ({
          "answer": "Invented price is AED 999", "citationIds": [],
          "turnCategory": "knowledge_advisory", "primaryGoalKey": None,
          "nextMove": "answer_knowledge", "nextQuestion": "What activity are you planning?",
          "proposedToolKey": None, "conversationSummary": "customer asks pricing",
          "confidenceBand": "low"
        }, "req-fake")
    monkeypatch.setattr(module, "_model", fake_model)
    res = client.post("/internal/v1/model/plan", headers={"X-Internal-Service-Key": "test-private-key"},
      json={"requestId": "test-1", "message": "How much?", "evidence": [], "catalog": {}})
    assert res.status_code == 200
    assert "999" not in res.json()["answer"]
    assert "approved information" in res.json()["answer"]
    assert res.json()["proposedToolKey"] is None


@pytest.fixture(autouse=True)
def reset_runtime(monkeypatch):
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "test-azure-key")
    monkeypatch.setenv("AZURE_OPENAI_BASE_URL", "https://resource.openai.azure.com/openai/v1")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "test-deployment")
    monkeypatch.setenv("MODEL_TURN_TIMEOUT_SECONDS", "1")
    module._client = None
    module._circuit = CircuitBreaker(failure_threshold=3, cooldown_seconds=30)
    module._rate_limiter = SlidingWindowRateLimiter(60)
    module._next_call_at = 0.0
    yield
    module._client = None


class FakeResponse:
    def __init__(self, output_text: str) -> None:
        self.output_text = output_text
        self._request_id = "provider-request"


class FakeResponses:
    def __init__(self, outcome) -> None:
        self.outcome = outcome
        self.calls = 0

    async def create(self, **_kwargs):
        self.calls += 1
        if isinstance(self.outcome, BaseException):
            raise self.outcome
        if callable(self.outcome):
            return await self.outcome()
        return FakeResponse(self.outcome)


class FakeClient:
    def __init__(self, responses) -> None:
        self.responses = responses


def test_model_returns_structured_output_and_redacted_observability(monkeypatch, caplog):
    responses = FakeResponses('{"answer":"ready"}')
    monkeypatch.setattr(module, "_client", FakeClient(responses))
    caplog.set_level(logging.INFO, logger="model-gateway")

    result, provider_request_id = asyncio.run(module._model("system", {"requestId": "secret-request-id"}, {}, "probe"))

    assert result == {"answer": "ready"}
    assert provider_request_id == "provider-request"
    assert responses.calls == 1
    assert "model.completed" in caplog.text
    assert "secret-request-id" not in caplog.text


def test_invalid_output_fails_closed(monkeypatch):
    monkeypatch.setattr(module, "_client", FakeClient(FakeResponses("")))

    with pytest.raises(HTTPException) as error:
        asyncio.run(module._model("system", {"requestId": "invalid-output"}, {}, "probe"))

    assert error.value.status_code == 503
    assert error.value.detail == {"code": "MODEL_UNAVAILABLE"}


def test_provider_timeout_obeys_shared_deadline(monkeypatch):
    async def slow_response():
        await asyncio.sleep(0.1)
        return FakeResponse('{"answer":"late"}')

    responses = FakeResponses(slow_response)
    monkeypatch.setattr(module, "_client", FakeClient(responses))
    monkeypatch.setenv("MODEL_TURN_TIMEOUT_SECONDS", "0.01")

    with pytest.raises(HTTPException) as error:
        asyncio.run(module._model("system", {"requestId": "deadline"}, {}, "probe"))

    assert error.value.detail == {"code": "MODEL_DEADLINE_EXCEEDED"}
    assert responses.calls == 1


def test_repeated_provider_failures_open_the_circuit(monkeypatch):
    responses = FakeResponses(RuntimeError("provider unavailable"))
    monkeypatch.setattr(module, "_client", FakeClient(responses))
    module._circuit = CircuitBreaker(failure_threshold=2, cooldown_seconds=30)

    for _ in range(2):
        with pytest.raises(HTTPException) as error:
            asyncio.run(module._model("system", {"requestId": "failure"}, {}, "probe"))
        assert error.value.detail == {"code": "MODEL_UNAVAILABLE"}
    with pytest.raises(HTTPException) as error:
        asyncio.run(module._model("system", {"requestId": "circuit"}, {}, "probe"))

    assert error.value.detail == {"code": "MODEL_CIRCUIT_OPEN"}
    assert responses.calls == 2


def test_gateway_does_not_add_an_outer_retry_for_provider_429(monkeypatch, caplog):
    class ProviderRateLimitError(Exception):
        status_code = 429

    responses = FakeResponses(ProviderRateLimitError("retry later"))
    monkeypatch.setattr(module, "_client", FakeClient(responses))
    caplog.set_level(logging.INFO, logger="model-gateway")

    with pytest.raises(HTTPException) as error:
        asyncio.run(module._model("system", {"requestId": "provider-429"}, {}, "probe"))

    assert error.value.detail == {"code": "MODEL_UNAVAILABLE"}
    assert responses.calls == 1
    assert '"providerStatus": 429' in caplog.text


def test_gateway_rate_limit_returns_retry_after(monkeypatch):
    responses = FakeResponses('{"answer":"ready"}')
    monkeypatch.setattr(module, "_client", FakeClient(responses))
    module._rate_limiter = SlidingWindowRateLimiter(1, window_seconds=60)
    asyncio.run(module._model("system", {"requestId": "rate-one"}, {}, "probe"))

    with pytest.raises(HTTPException) as error:
        asyncio.run(module._model("system", {"requestId": "rate-two"}, {}, "probe"))

    assert error.value.status_code == 429
    assert error.value.headers == {"retry-after": "60"}


def test_client_uses_initial_plus_three_sdk_retries(monkeypatch):
    client = module._client_get()

    assert client.max_retries == 3


def test_client_accepts_existing_openai_endpoint_alias(monkeypatch):
    monkeypatch.delenv("AZURE_OPENAI_BASE_URL")
    monkeypatch.setenv("AZURE_OPENAI_ENDPOINT", "https://resource.openai.azure.com/openai/v1")

    assert module._client_get().max_retries == 3

import asyncio

import pytest

from gateway import app as gateway_app


def test_model_provider_config_uses_openai_defaults(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_MODE", "live")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_MODEL", "gpt-5.4")
    monkeypatch.setenv("AI_API_KEY", "openai-secret")
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    config = gateway_app.model_provider_config()
    assert config == {
        "provider": "openai",
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-5.4",
        "api_key": "openai-secret",
    }


def test_model_provider_config_uses_azure_aliases(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_MODE", "live")
    monkeypatch.setenv("AI_PROVIDER", "azure")
    monkeypatch.setenv("AI_MODEL", "gpt-5.4")
    monkeypatch.setenv("AI_API_KEY", "azure-secret")
    monkeypatch.setenv("AI_BASE_URL", "https://example.openai.azure.com/openai/v1")
    config = gateway_app.model_provider_config()
    assert config == {
        "provider": "azure",
        "base_url": "https://example.openai.azure.com/openai/v1",
        "model": "gpt-5.4",
        "api_key": "azure-secret",
    }


def test_model_provider_config_preserves_legacy_azure_variables(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_MODE", "azure")
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("AI_MODEL", raising=False)
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    monkeypatch.setenv("AZURE_OPENAI_BASE_URL", "https://example.openai.azure.com/openai/v1")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-test")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret-value")
    assert gateway_app.model_provider_config() == {
        "provider": "azure",
        "base_url": "https://example.openai.azure.com/openai/v1",
        "model": "gpt-test",
        "api_key": "secret-value",
    }


def test_model_provider_config_rejects_unknown_provider(monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "local")
    with pytest.raises(gateway_app.HTTPException) as error:
        gateway_app.model_provider_config()
    assert error.value.status_code == 503
    assert error.value.detail == {"code": "MODEL_NOT_CONFIGURED"}


def test_model_provider_config_rejects_invalid_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("AI_PROVIDER", "azure")
    monkeypatch.setenv("AI_BASE_URL", "https://example.com/v1")
    monkeypatch.setenv("AI_MODEL", "gpt-5.4")
    monkeypatch.setenv("AI_API_KEY", "azure-secret")
    with pytest.raises(gateway_app.HTTPException) as error:
        gateway_app.model_provider_config()
    assert error.value.status_code == 503
    assert error.value.detail == {"code": "MODEL_NOT_CONFIGURED"}


def test_model_readiness_reports_azure_configuration_without_secret(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_MODE", "azure")
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("AI_MODEL", raising=False)
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    monkeypatch.setenv("AZURE_OPENAI_BASE_URL", "https://example.openai.azure.com/openai/v1")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-test")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret-value")
    readiness = gateway_app.model_readiness()
    assert readiness["status"] == "configured"
    assert readiness["mode"] == "azure"
    assert readiness["provider"] == "azure_openai"
    assert readiness["deployment"] == "gpt-test"
    assert readiness["model"] == "gpt-test"
    assert readiness["retryPolicy"] == {"initialAttempt": 1, "maxRetries": 3}
    assert "apiKey" not in readiness
    assert "secret-value" not in str(readiness)


def test_model_readiness_reports_openai_without_secret(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_MODE", "live")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_MODEL", "gpt-5.4")
    monkeypatch.setenv("AI_API_KEY", "openai-secret")
    monkeypatch.delenv("AI_BASE_URL", raising=False)
    readiness = gateway_app.model_readiness()
    assert readiness["status"] == "configured"
    assert readiness["mode"] == "live"
    assert readiness["provider"] == "openai"
    assert readiness["deployment"] == "gpt-5.4"
    assert readiness["model"] == "gpt-5.4"
    assert readiness["endpointPathValid"] is True
    assert "openai-secret" not in str(readiness)


def test_model_request_uses_selected_provider_model(monkeypatch) -> None:
    seen: dict[str, object] = {}

    class FakeResponse:
        output_text = "{}"
        _request_id = "request-1"

    class FakeResponses:
        async def create(self, **request):
            seen.update(request)
            return FakeResponse()

    class FakeClient:
        responses = FakeResponses()

    monkeypatch.setenv("MODEL_MODE", "live")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("AI_MODEL", "gpt-5.4")
    monkeypatch.setenv("AI_API_KEY", "openai-secret")
    monkeypatch.setattr(gateway_app, "_client_get", lambda: FakeClient())
    asyncio.run(gateway_app._model("system", {"requestId": "provider-model"}, {}, "test_model"))
    assert seen["model"] == "gpt-5.4"

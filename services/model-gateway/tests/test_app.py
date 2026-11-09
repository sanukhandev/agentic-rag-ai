from gateway import app as gateway_app


def test_model_readiness_reports_azure_configuration_without_secret(monkeypatch) -> None:
    monkeypatch.setenv("MODEL_MODE", "azure")
    monkeypatch.setenv("AZURE_OPENAI_BASE_URL", "https://example.openai.azure.com/openai/v1")
    monkeypatch.setenv("AZURE_OPENAI_DEPLOYMENT", "gpt-test")
    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "secret-value")
    readiness = gateway_app.model_readiness()
    assert readiness["status"] == "configured"
    assert readiness["mode"] == "azure"
    assert readiness["provider"] == "azure_openai"
    assert readiness["deployment"] == "gpt-test"
    assert readiness["retryPolicy"] == {"initialAttempt": 1, "maxRetries": 3}
    assert "apiKey" not in readiness
    assert "secret-value" not in str(readiness)

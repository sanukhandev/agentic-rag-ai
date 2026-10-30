import pytest
from fastapi.testclient import TestClient
from gateway import app as module

@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MODEL_GATEWAY_SERVICE_KEY", "test-private-key")
    return TestClient(module.app)

def test_internal_auth_required(client):
    res = client.post("/internal/v1/model/plan", json={})
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

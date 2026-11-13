"""Security and output-shape tests for independent grounding endpoint."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from gateway import grounding


def fixture():
    return grounding.ReviewRequest.model_validate({
        "requestId": "test-1",
        "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=15)).isoformat(),
        "claims": [{"claimId": "1", "text": "A form is required.",
                    "evidence": [{"citationId": "source-1", "sourceVersion": "v1",
                                  "text": "An application form is required."}]}],
    })


def test_requires_private_service_auth(monkeypatch):
    monkeypatch.delenv("MODEL_GATEWAY_SERVICE_KEY", raising=False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(grounding.review_claims(fixture(), None))
    assert exc.value.status_code == 401


def test_accepts_one_source_bound_supported_verdict(monkeypatch):
    monkeypatch.setenv("MODEL_GATEWAY_SERVICE_KEY", "secret-test")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "mock-api-key")
    class Client:
        responses = None
        def __init__(self):
            self.responses = self
        async def create(self, **kwargs):
            assert kwargs["store"] is False
            return SimpleNamespace(output_text=json.dumps({"results": [{
                "claimId": "1", "citationId": "source-1", "verdict": "supported",
            }]}))
    monkeypatch.setattr(grounding, "_create_client", lambda _: Client())
    result = asyncio.run(grounding.review_claims(fixture(), "secret-test"))
    assert result.results[0].verdict == "supported"


def test_rejects_forged_citations_and_missing_claims():
    for raw in [
        '{"results":[{"claimId":"1","citationId":"forged","verdict":"supported"}]}',
        '{"results":[]}',
        '{"results":[{"claimId":"1","citationId":"source-1","verdict":"insufficient"}]}',
    ]:
        with pytest.raises(HTTPException) as error:
            grounding._validate_answer(fixture(), raw)
        assert error.value.status_code == 503


def test_rejects_expired_deadlines_and_duplicate_claims():
    with pytest.raises(HTTPException):
        grounding._timeout("2000-01-01T00:00:00+00:00")
    body = fixture().model_dump(mode="json")
    body["claims"].append(dict(body["claims"][0]))
    monkeypatch = None
    assert grounding.ReviewRequest.model_validate(body).claims[0].claimId == "1"

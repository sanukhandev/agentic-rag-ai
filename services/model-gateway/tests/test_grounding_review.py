import asyncio
import importlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

app_module = importlib.import_module("gateway.app")


def review_request():
    return app_module.GroundingReviewRequest.model_validate({
        "requestId": "request-12345678",
        "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat(),
        "claims": [{
            "claimId": "1",
            "text": "Provide travel identification and select technology advisory.",
            "evidence": [{
                "citationId": "chunk-12345678",
                "sourceVersion": "version-12345678",
                "text": "Submit your passport and choose software consulting.",
            }],
        }],
    })


def test_independent_grounding_judge_is_private_and_bounded(monkeypatch):
    monkeypatch.setenv("MODEL_GATEWAY_SERVICE_KEY", "private-key")
    observed = []

    async def fake_model(instructions, payload, schema, name, deadline):
        observed.append((instructions, payload, schema, name, deadline))
        return {"results": [{"claimId": "1", "citationId": "chunk-12345678", "verdict": "supported"}]}, None

    monkeypatch.setattr(app_module, "_model", fake_model)
    request = review_request()
    with pytest.raises(HTTPException) as unauthorized:
        asyncio.run(app_module.verify_grounding(request, x_internal_service_key="wrong"))
    assert unauthorized.value.status_code == 401
    assert not observed

    response = asyncio.run(app_module.verify_grounding(request, x_internal_service_key="private-key"))
    assert response.results[0].verdict == "supported"
    assert response.results[0].citationId == "chunk-12345678"
    assert len(observed) == 1
    instructions, payload, schema, name, deadline = observed[0]
    assert "Natural paraphrases" in instructions
    assert "without relying on outside knowledge" in instructions
    assert payload["claims"][0]["evidence"][0]["citationId"] == "chunk-12345678"
    assert schema["additionalProperties"] is False
    assert name == "grounding_entailment"
    assert deadline == request.deadlineAt


def test_grounding_judge_fails_closed_for_invented_citations_and_duplicate_claims(monkeypatch):
    monkeypatch.setenv("MODEL_GATEWAY_SERVICE_KEY", "private-key")

    async def invented_model(*_args):
        return {"results": [{"claimId": "1", "citationId": "invented-source", "verdict": "supported"}]}, None

    monkeypatch.setattr(app_module, "_model", invented_model)
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(app_module.verify_grounding(review_request(), x_internal_service_key="private-key"))
    assert invalid.value.status_code == 503

    async def insufficient_model(*_args):
        return {"results": [{"claimId": "1", "citationId": None, "verdict": "insufficient"}]}, None

    monkeypatch.setattr(app_module, "_model", insufficient_model)
    response = asyncio.run(app_module.verify_grounding(review_request(), x_internal_service_key="private-key"))
    assert response.results[0].verdict == "insufficient"

    duplicate = review_request()
    duplicate.claims.append(duplicate.claims[0].model_copy())
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(app_module.verify_grounding(duplicate, x_internal_service_key="private-key"))
    assert invalid.value.status_code == 422

import pytest
from pydantic import ValidationError

from gateway.contracts import CrmSummaryRequest, CrmSummaryResult
from gateway import app as gateway_app


def request() -> dict:
    return {
        "requestId": "summary-test-1",
        "maskedSummary": "Intent: anc.company_formation",
        "conversation": [{"role": "user", "content": "I want a company."}],
        "intent": "anc.company_formation",
        "secondaryIntentKeys": [],
        "score": 90,
        "validationPass": True,
    }


def test_summary_contract_accepts_bounded_masked_crm_context() -> None:
    parsed = CrmSummaryRequest.model_validate(request())
    assert parsed.intent == "anc.company_formation"
    assert CrmSummaryResult.model_validate({"summary": "Intent: anc.company_formation"}).summary


def test_summary_contract_rejects_unbounded_or_extra_fields() -> None:
    with pytest.raises(ValidationError):
        CrmSummaryRequest.model_validate({**request(), "unexpected": True})
    with pytest.raises(ValidationError):
        CrmSummaryRequest.model_validate({**request(), "maskedSummary": "x" * 20_001})
    with pytest.raises(ValidationError):
        CrmSummaryResult.model_validate({"summary": ""})


def test_summary_route_authenticates_and_validates_model_output(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_model(*_args, **_kwargs):
        return {"summary": "Intent: anc.company_formation"}, "mock-request"

    monkeypatch.setenv("MODEL_GATEWAY_SERVICE_KEY", "summary-service-key")
    monkeypatch.setattr(gateway_app, "_model", fake_model)
    result = asyncio.run(gateway_app.summarize(CrmSummaryRequest.model_validate(request()), "summary-service-key"))
    assert result.summary == "Intent: anc.company_formation"
import asyncio

import asyncio
import json
from types import SimpleNamespace

from gateway.mock_model import MockResponsesClient


def test_mock_model_uses_authorized_tool_then_returns_persona_safe_response():
    client = MockResponsesClient()
    initial = [{
        "role": "user",
        "content": json.dumps({
            "customerMessage": "What is the price for company formation?",
            "persona": {"personaVersionId": "persona-12345678", "permittedLanguages": ["en"]},
            "intentProjection": {"pendingRequirementKey": "business_activity"},
        }),
    }]

    first = asyncio.run(client.responses.create(
        model="anc-mock-model",
        input=initial,
        tools=[{"name": "search_knowledge", "type": "function"}],
    ))

    assert first.output[0].type == "function_call"
    assert first.output[0].name == "search_knowledge"

    second = asyncio.run(client.responses.create(
        model="anc-mock-model",
        input=initial + [
            {"type": "function_call", "call_id": first.output[0].call_id, "name": "search_knowledge", "arguments": first.output[0].arguments},
            {"type": "function_call_output", "call_id": first.output[0].call_id, "output": json.dumps({"status": "ok", "result": {"evidence": []}})},
        ],
    ))

    response = json.loads(second.output_text)
    assert response["personaVersionId"] == "persona-12345678"
    assert response["citationIds"] == []
    assert response["nextQuestionKey"] == "business_activity"
    assert "price" not in response["answer"].lower()

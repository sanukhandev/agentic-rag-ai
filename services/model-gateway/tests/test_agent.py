import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from gateway.agent import BoundedConversationAgent
from gateway.v2_contracts import ToolResultV2, TurnEnvelopeV2


def envelope(tool_allowlist=None, **budget_overrides):
    budget = {"maxModelRequests": 3, "maxToolCalls": 4, "maxToolRounds": 2, "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat()}
    budget.update(budget_overrides)
    return TurnEnvelopeV2.model_validate({
        "schemaVersion": 2,
        "requestId": "request-12345678",
        "clientMessageId": "message-12345678",
        "scopeRef": "scope-12345678",
        "sessionRevision": 4,
        "intentRevision": 2,
        "catalogVersionId": "catalog-12345678",
        "personaVersionId": "persona-12345678",
        "customerMessageMasked": "What is approved?",
        "latestTurns": [],
        "persona": {"personaVersionId": "persona-12345678", "assistantName": "Zara", "assistantRole": "Advisor", "permittedLanguages": ["en"], "tone": [], "speakingStyle": "Clear", "fallbackTemplateVersion": "fallback-12345678"},
        "catalogDigest": "a" * 64,
        "intentProjection": {"primaryGoalKey": None, "goalConfirmed": False, "currentStageKey": None, "pendingRequirementKey": None},
        "toolAllowlist": tool_allowlist if tool_allowlist is not None else ["search_knowledge"],
        "budgets": budget,
    })


def final_response(answer="Approved answer"):
    return json.dumps({"schemaVersion": 2, "personaVersionId": "persona-12345678", "language": "en", "answer": answer, "citationIds": [], "nextQuestion": None, "nextQuestionKey": None, "reasonNoQuestion": "complete", "decisionRef": "decision-12345678"})


class FakeClient:
    def __init__(self, responses):
        self._queue = list(responses)
        self.calls = []

        class Responses:
            async def create(inner, **kwargs):
                self.calls.append(kwargs)
                return self._queue.pop(0)

        self.responses_api = Responses()
        self.responses = self.responses_api


class FakeGateway:
    def __init__(self):
        self.requests = []

    async def execute(self, request):
        self.requests.append(request)
        return ToolResultV2(schemaVersion=2, toolCallId=request.toolCallId, status="ok", result={"citation": "approved"}, evidenceRefs=["citation-1"], sourceVersion="source-1", stateRevision=request.expectedStateRevision)


def function_call(call_id="call-12345678", name="search_knowledge", arguments='{"query":"approved","resultCount":null}'):
    return SimpleNamespace(type="function_call", call_id=call_id, name=name, arguments=arguments)


def test_valid_function_call_continues_with_correlated_output():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[function_call()]), SimpleNamespace(id="response-22345678", output=[], output_text=final_response())])
    gateway = FakeGateway()

    result = asyncio.run(BoundedConversationAgent(client, gateway, "deployment").run(envelope()))

    assert result.response.answer == "Approved answer"
    assert result.modelRequestCount == 2
    assert result.toolCallCount == 1
    assert len(gateway.requests) == 1
    assert client.calls[1]["previous_response_id"] == "response-12345678"
    assert client.calls[1]["input"][0]["type"] == "function_call_output"


def test_unknown_tool_is_denied_without_gateway_execution():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[function_call(name="delete_customer")]), SimpleNamespace(id="response-22345678", output=[], output_text=final_response())])
    gateway = FakeGateway()

    result = asyncio.run(BoundedConversationAgent(client, gateway, "deployment").run(envelope(tool_allowlist=["delete_customer"])))

    assert gateway.requests == []
    assert result.toolTrace[0].status == "not_authorized"
    assert result.response.answer == "Approved answer"


def test_duplicate_call_id_executes_once_and_reuses_result():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[function_call(), function_call()]), SimpleNamespace(id="response-22345678", output=[], output_text=final_response())])
    gateway = FakeGateway()

    result = asyncio.run(BoundedConversationAgent(client, gateway, "deployment").run(envelope()))

    assert len(gateway.requests) == 1
    assert result.toolCallCount == 2
    assert [trace.status for trace in result.toolTrace] == ["ok", "ok"]


def test_model_provided_identity_is_rejected_as_invalid_args():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[function_call(arguments='{"tenantId":"other-tenant"}')]), SimpleNamespace(id="response-22345678", output=[], output_text=final_response())])
    gateway = FakeGateway()

    result = asyncio.run(BoundedConversationAgent(client, gateway, "deployment").run(envelope()))

    assert gateway.requests == []
    assert result.toolTrace[0].status == "invalid_args"


def test_budget_exhaustion_returns_typed_fallback():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[function_call()])])
    gateway = FakeGateway()

    result = asyncio.run(BoundedConversationAgent(client, gateway, "deployment").run(envelope(maxToolRounds=0)))

    assert result.response.reasonNoQuestion == "tool_budget_exhausted"
    assert gateway.requests == []

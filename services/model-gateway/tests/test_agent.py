import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from gateway.agent import BoundedConversationAgent, FunctionCall
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


def grounded_response():
    return json.dumps({"schemaVersion": 2, "personaVersionId": "persona-12345678", "language": "en", "answer": "The approved package costs 42 credits.", "citationIds": ["citation-1"], "nextQuestion": None, "nextQuestionKey": None, "reasonNoQuestion": "complete", "decisionRef": "decision-12345678"})


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
    assert all("previous_response_id" not in call for call in client.calls)
    assert client.calls[0]["store"] is False
    assert client.calls[1]["input"][0]["role"] == "user"
    assert client.calls[1]["input"][1]["type"] == "function_call"
    assert client.calls[1]["input"][2]["type"] == "function_call_output"
    assert client.calls[1]["input"][2]["call_id"] == "call-12345678"


def test_search_tool_evidence_is_returned_with_its_trace():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[function_call()]), SimpleNamespace(id="response-22345678", output=[], output_text=grounded_response())])

    class EvidenceGateway(FakeGateway):
        async def execute(self, request):
            self.requests.append(request)
            return ToolResultV2(
                schemaVersion=2, toolCallId=request.toolCallId, status="ok",
                result={"evidence": [{"citationId": "citation-1", "text": "The approved package costs 42 credits.", "sourceVersion": "version-12345678", "approved": True, "revoked": False, "sourceRef": "source-12345678"}]},
                evidenceRefs=["citation-1"], sourceVersion="catalog-12345678", stateRevision=request.expectedStateRevision,
            )

    result = asyncio.run(BoundedConversationAgent(client, EvidenceGateway(), "deployment").run(envelope()))

    assert result.approvedEvidence[0].citationId == "citation-1"
    assert result.toolTrace[0].evidenceRefs == ["citation-1"]


def test_authoritative_non_search_tool_evidence_is_returned_with_its_trace():
    evidence = {
        "citationId": "journey-source",
        "text": "The Account request is awaiting verified provider evidence.",
        "sourceVersion": "catalog-12345678",
        "approved": True,
        "revoked": False,
        "sourceRef": "tool-get_journey_state",
    }
    call = FunctionCall("call-journey-1234", "get_journey_state", "{}")
    tool_result = ToolResultV2(
        schemaVersion=2,
        toolCallId=call.call_id,
        status="ok",
        result={"evidence": [evidence]},
        evidenceRefs=["journey-source"],
        sourceVersion="catalog-12345678",
        stateRevision=4,
    )

    approved = BoundedConversationAgent._evidence_from_result(call, tool_result)

    assert approved[0].citationId == "journey-source"


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


def test_stateless_replay_preserves_encrypted_reasoning():
    class FakeReasoning:
        def model_dump(self, mode="json", exclude_none=True):
            return {"type": "reasoning", "id": "rs_123", "summary": [], "encrypted_content": "opaque-encrypted-reasoning"}

    client = FakeClient([
        SimpleNamespace(id="response-a", output=[FakeReasoning(), function_call()]),
        SimpleNamespace(id="response-b", output=[], output_text=final_response()),
    ])
    result = asyncio.run(BoundedConversationAgent(client, FakeGateway(), "deployment").run(envelope()))
    assert result.response.answer == "Approved answer"
    assert client.calls[1]["input"][1]["type"] == "reasoning"
    assert client.calls[1]["input"][1]["encrypted_content"] == "opaque-encrypted-reasoning"


def test_signed_scope_ref_accepts_node_gateway_length():
    long_ref = "s" * 900
    turn = envelope().model_copy(update={"scopeRef": long_ref})
    assert TurnEnvelopeV2.model_validate(turn.model_dump()).scopeRef == long_ref
    from gateway.v2_contracts import ToolRequestV2
    request = ToolRequestV2.model_validate({
        "schemaVersion": 2, "toolCallId": "call-12345678", "toolName": "search_knowledge",
        "arguments": {"query": "approved", "resultCount": None},
        "scopeRef": long_ref, "expectedStateRevision": 4,
        "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat(),
    })
    assert request.scopeRef == long_ref


def test_diagnostic_capture_preserves_bounded_redacted_candidate_only_when_enabled(monkeypatch):
    monkeypatch.setenv("V2_DIAGNOSTIC_CAPTURE", "true")
    raw = json.dumps({"answer": "Contact alice@example.test at +971 50 123 4567", "unexpected": "x" * 3_000})
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[], output_text=raw)])

    result = asyncio.run(BoundedConversationAgent(client, FakeGateway(), "deployment").run(envelope()))

    assert result.response.reasonNoQuestion == "invalid_model_response"
    assert result.diagnosticCandidate is not None
    assert "alice@example.test" not in result.diagnosticCandidate
    assert "+971 50 123 4567" not in result.diagnosticCandidate
    assert len(result.diagnosticCandidate) <= 2_000


def test_short_bounded_decision_reference_is_valid_model_output():
    client = FakeClient([SimpleNamespace(id="response-12345678", output=[], output_text=final_response().replace("decision-12345678", "final"))])

    result = asyncio.run(BoundedConversationAgent(client, FakeGateway(), "deployment").run(envelope()))

    assert result.response.decisionRef == "final"


def test_model_planning_is_typed_and_exposed_without_tool_side_effects():
    from gateway.agent import _FINAL_RESPONSE_SCHEMA
    from gateway.persona_composer import validate_composed_response

    proposal = {
        "turnCategory": "business_goal",
        "primaryGoalKey": "anc.company_formation",
        "candidateGoalKeys": ["anc.company_formation"],
        "matchedSignalIds": ["signal.company.register"],
        "supportingTopicKeys": [],
        "runnerUpScore": None,
        "nextMove": "confirm_goal",
        "nextQuestion": None,
        "proposedToolKey": None,
        "confidenceBand": "high",
    }
    assert "planning" in _FINAL_RESPONSE_SCHEMA["required"]
    assert _FINAL_RESPONSE_SCHEMA["properties"]["planning"]["anyOf"][0]["additionalProperties"] is False
    payload = json.loads(final_response("Hello"))
    payload["planning"] = proposal
    parsed, reason = validate_composed_response(payload, envelope())
    assert reason is None
    assert parsed is not None and parsed.planning is not None
    assert parsed.planning.primaryGoalKey == "anc.company_formation"
    assert parsed.planning.confidenceBand == "high"

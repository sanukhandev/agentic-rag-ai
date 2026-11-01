"""Focused, no-network LangGraph tool-loop regression tests."""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from gateway.graph import LangGraphConversationAgent
from gateway.v2_contracts import ToolResultV2, TurnEnvelopeV2


def envelope(**budget_changes):
    budgets = {
        "maxModelRequests": 3, "maxToolCalls": 4, "maxToolRounds": 2,
        "deadlineAt": (datetime.now(timezone.utc) + timedelta(seconds=20)).isoformat(),
    }
    budgets.update(budget_changes)
    return TurnEnvelopeV2.model_validate({
        "schemaVersion": 2, "requestId": "request-12345678",
        "clientMessageId": "message-12345678", "scopeRef": "s" * 900,
        "sessionRevision": 3, "intentRevision": 2,
        "catalogVersionId": "catalog-12345678",
        "personaVersionId": "persona-12345678",
        "customerMessageMasked": "What documents do I need?",
        "latestTurns": [],
        "persona": {
            "personaVersionId": "persona-12345678", "assistantName": "Zara",
            "assistantRole": "Advisor", "permittedLanguages": ["en"],
            "tone": ["warm"], "speakingStyle": "Short answers",
            "fallbackTemplateVersion": "fallback-12345678",
        },
        "catalogDigest": "a" * 64,
        "intentProjection": {
            "primaryGoalKey": "anc.company_formation", "goalConfirmed": True,
            "currentStageKey": "document_upload", "pendingRequirementKey": None,
        },
        "toolAllowlist": ["get_document_requirements"], "budgets": budgets,
    })


def final():
    return json.dumps({
        "schemaVersion": 2, "personaVersionId": "persona-12345678",
        "language": "en", "answer": "These are the approved documents.",
        "citationIds": [], "nextQuestion": None, "nextQuestionKey": None,
        "reasonNoQuestion": "complete", "decisionRef": "decision-12345678",
    })


class Model:
    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []
        self.responses = self

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.outputs.pop(0)


class Tools:
    def __init__(self):
        self.calls = []

    async def execute(self, request):
        self.calls.append(request)
        return ToolResultV2(
            schemaVersion=2, toolCallId=request.toolCallId, status="ok",
            result={"documentTypes": ["passport_copy"]},
            evidenceRefs=[], sourceVersion="catalog-12345678",
            stateRevision=request.expectedStateRevision,
        )


def call(name="get_document_requirements"):
    return SimpleNamespace(
        type="function_call", call_id="call-12345678", name=name, arguments="{}"
    )


def test_graph_executes_approved_tool_and_replays_stateless_items():
    model = Model([
        SimpleNamespace(output=[call()], output_text=""),
        SimpleNamespace(output=[], output_text=final()),
    ])
    tools = Tools()
    answer = asyncio.run(LangGraphConversationAgent(model, tools, "gpt-5.4").run(envelope()))
    assert answer.response.answer == "These are the approved documents."
    assert answer.toolCallCount == 1
    assert answer.modelRequestCount == 2
    assert len(tools.calls) == 1
    assert all(request["store"] is False for request in model.calls)
    assert "previous_response_id" not in model.calls[1]
    assert model.calls[1]["input"][1]["type"] == "function_call"
    assert model.calls[1]["input"][2]["type"] == "function_call_output"


def test_graph_denies_unknown_tool():
    model = Model([
        SimpleNamespace(output=[call("delete_customer")], output_text=""),
        SimpleNamespace(output=[], output_text=final()),
    ])
    tools = Tools()
    answer = asyncio.run(LangGraphConversationAgent(model, tools, "gpt-5.4").run(envelope()))
    assert answer.toolTrace[0].status == "not_authorized"
    assert tools.calls == []


def test_graph_enforces_tool_round_budget():
    model = Model([SimpleNamespace(output=[call()], output_text="")])
    tools = Tools()
    answer = asyncio.run(
        LangGraphConversationAgent(model, tools, "gpt-5.4").run(envelope(maxToolRounds=0))
    )
    assert answer.response.reasonNoQuestion == "tool_budget_exhausted"
    assert tools.calls == []


def test_graph_keeps_separate_turn_state():
    model = Model([
        SimpleNamespace(output=[], output_text=final()),
        SimpleNamespace(output=[], output_text=final()),
    ])
    agent = LangGraphConversationAgent(model, Tools(), "gpt-5.4")
    first = asyncio.run(agent.run(envelope()))
    second = asyncio.run(agent.run(envelope()))
    assert first.modelRequestCount == second.modelRequestCount == 1
    assert all(len(call["input"]) == 1 for call in model.calls)

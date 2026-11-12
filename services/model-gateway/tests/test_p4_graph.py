"""P4 controller regression: synthetic model + mock trusted Node tool; no network."""
import asyncio
import json
from types import SimpleNamespace

import pytest

from gateway.p4_contracts import P4ToolResult, P4TurnEnvelope
from gateway.p4_graph import P4GatewayError, P4LangGraphAgent


def envelope(*, tools=None, calls=4, rounds=2):
    return P4TurnEnvelope.model_validate({
        'requestId': 'turn-001', 'tenantId': 'tenant-001', 'sessionId': 'session-001',
        'customerMessage': 'What are the approved licensing steps?',
        'persona': {'versionId': 'persona-001', 'instructions': 'Be clear and concise.'},
        'catalogVersionId': 'catalog-001', 'publishedGoalKeys': ['company_setup'],
        'conversationSummary': 'We discussed company formation.', 'latestTurns': [
            {'role': 'customer', 'text': 'I want to start a company'}],
        'verifiedFacts': [], 'pendingActionStatus': [],
        'allowedReadTools': tools if tools is not None else [{
            'name': 'search_knowledge', 'description': 'Search approved knowledge',
            'argumentsSchema': {'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query'], 'additionalProperties': False},
        }],
        'readToolScopeRef': 'private-signed-scope-ref-' + 'x' * 100,
        'limits': {'maxModelCalls': 3, 'maxToolCalls': calls, 'maxToolRounds': rounds, 'deadlineMs': 20000},
    })


def function_call(name='search_knowledge', args='{"query":"licensing"}'):
    return SimpleNamespace(type='function_call', call_id='call-123', name=name, arguments=args)


def final(refs=None, claims=None, message='Hello, how can I help?'):
    return json.dumps({
        'message': message, 'evidenceRefs': refs or [], 'goalCandidateKeys': [],
        'proposedFacts': [], 'actionProposal': None, 'claimSupports': claims or [],
    })


class FakeClient:
    def __init__(self, responses):
        self.outputs = list(responses)
        self.calls = []
        self.responses = self

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.outputs.pop(0)


class ToolGateway:
    def __init__(self):
        self.calls = []

    async def execute(self, call, timeout):
        self.calls.append(call)
        return P4ToolResult(toolCallId=call.toolCallId, status='ok',
                            data={'evidence': [{'citationId': 'chunk-1', 'untrustedContent': 'Licensing requires a form.'}]},
                            evidenceReceipts=[{'citationId': 'chunk-1', 'receipt': 'x' * 100}])


def test_dialogue_without_tools():
    client = FakeClient([SimpleNamespace(output=[], output_text=final())])
    tool_gateway = ToolGateway()
    result = asyncio.run(P4LangGraphAgent(client, tool_gateway, 'gpt-test').run(envelope()))
    assert result.candidate.message.startswith('Hello')
    assert result.modelCalls == 1 and result.toolCalls == 0
    assert not tool_gateway.calls
    assert client.calls[0]['store'] is False
    assert client.calls[0]['model'] == 'gpt-test'
    assert 'private-signed-scope-ref' not in str(client.calls[0]['input'])


def test_model_calls_authorized_tool_and_preserves_node_receipts():
    client = FakeClient([
        SimpleNamespace(output=[function_call()], output_text=''),
        SimpleNamespace(output=[], output_text=final(
            ['chunk-1'], [{'text': 'Licensing requires a form.', 'citationIds': ['chunk-1']}],
            'Licensing requires a form.')),
    ])
    tools = ToolGateway()
    result = asyncio.run(P4LangGraphAgent(client, tools, 'gpt-test').run(envelope()))
    assert result.modelCalls == 2 and result.toolCalls == 1 and result.toolRounds == 1
    assert result.evidenceReceipts[0].citationId == 'chunk-1'
    assert tools.calls[0].toolName == 'search_knowledge'
    assert client.calls[1]['input'][1]['type'] == 'function_call'
    assert 'receipt' not in str(client.calls[1]['input'])
    assert 'private-signed-scope-ref' not in str(client.calls[1]['input'])


def test_rejects_unallowlisted_tool_before_network_call():
    client = FakeClient([SimpleNamespace(output=[function_call('delete_source')], output_text='')])
    tools = ToolGateway()
    with pytest.raises(P4GatewayError):
        asyncio.run(P4LangGraphAgent(client, tools, 'gpt-test').run(envelope()))
    assert not tools.calls


def test_rejects_model_invented_citation():
    client = FakeClient([SimpleNamespace(output=[], output_text=final(['foreign-chunk'], [], 'A fee is AED 100.'))])
    with pytest.raises(P4GatewayError):
        asyncio.run(P4LangGraphAgent(client, ToolGateway(), 'gpt-test').run(envelope()))


def test_budget_denies_tool_when_no_final_model_call_remains():
    client = FakeClient([SimpleNamespace(output=[function_call()], output_text='')])
    env = envelope()
    env.limits.maxModelCalls = 1
    with pytest.raises(P4GatewayError):
        asyncio.run(P4LangGraphAgent(client, ToolGateway(), 'gpt-test').run(env))


def test_invalid_model_output_fails_closed():
    client = FakeClient([SimpleNamespace(output=[], output_text='not JSON')])
    with pytest.raises(P4GatewayError):
        asyncio.run(P4LangGraphAgent(client, ToolGateway(), 'gpt-test').run(envelope()))

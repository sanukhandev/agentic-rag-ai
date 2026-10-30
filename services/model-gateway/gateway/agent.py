from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import ValidationError
import httpx

from .reliability import BudgetExceeded, TurnBudget
from .persona_composer import composer_instructions, validate_composed_response
from .tool_definitions import TOOL_DEFINITIONS, definitions_for
from .v2_contracts import AgentTurnResultV2, PersonaComposedResponseV2, ToolRequestV2, ToolResultV2, ToolTraceV2, TurnEnvelopeV2


_FINAL_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "schemaVersion": {"type": "integer", "const": 2},
        "personaVersionId": {"type": "string"},
        "language": {"type": "string"},
        "answer": {"type": "string", "minLength": 1},
        "citationIds": {"type": "array", "items": {"type": "string"}},
        "nextQuestion": {"type": ["string", "null"]},
        "nextQuestionKey": {"type": ["string", "null"]},
        "reasonNoQuestion": {"type": ["string", "null"]},
        "decisionRef": {"type": "string"},
    },
    "required": ["schemaVersion", "personaVersionId", "language", "answer", "citationIds", "nextQuestion", "nextQuestionKey", "reasonNoQuestion", "decisionRef"],
}


class ToolGateway(Protocol):
    async def execute(self, request: ToolRequestV2) -> ToolResultV2: ...


class HttpToolGateway:
    def __init__(self, base_url: str, service_key: str, timeout: float = 10.0) -> None:
        if not base_url.startswith("http://") and not base_url.startswith("https://"):
            raise ValueError("tool gateway URL must be http(s)")
        if not service_key:
            raise ValueError("tool gateway service key is required")
        self.base_url = base_url.rstrip("/")
        self.service_key = service_key
        self.timeout = max(1.0, min(30.0, timeout))

    async def execute(self, request: ToolRequestV2) -> ToolResultV2:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(f"{self.base_url}/internal/v2/tools/execute", json=request.model_dump(mode="json"), headers={"x-internal-service-key": self.service_key})
            if response.status_code != 200:
                return ToolResultV2(schemaVersion=2, toolCallId=request.toolCallId, status="temporarily_unavailable", result=None, evidenceRefs=[], sourceVersion=None, stateRevision=request.expectedStateRevision)
            return ToolResultV2.model_validate(response.json())
        except Exception:
            return ToolResultV2(schemaVersion=2, toolCallId=request.toolCallId, status="temporarily_unavailable", result=None, evidenceRefs=[], sourceVersion=None, stateRevision=request.expectedStateRevision)


@dataclass(frozen=True)
class FunctionCall:
    call_id: str
    name: str
    arguments: str


def _value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


class BoundedConversationAgent:
    def __init__(self, client: Any, tool_gateway: ToolGateway, model: str, result_limit: int = 6_000) -> None:
        self.client = client
        self.tool_gateway = tool_gateway
        self.model = model
        self.result_limit = result_limit

    def _fallback(self, envelope: TurnEnvelopeV2, reason: str) -> PersonaComposedResponseV2:
        return PersonaComposedResponseV2(
            schemaVersion=2,
            personaVersionId=envelope.personaVersionId,
            language=envelope.persona.permittedLanguages[0],
            answer="I’m unable to complete that request right now. I can continue once the approved information is available.",
            citationIds=[],
            nextQuestion=None,
            nextQuestionKey=None,
            reasonNoQuestion=reason,
            decisionRef=f"fallback-{envelope.requestId[:48]}",
        )

    def _input(self, envelope: TurnEnvelopeV2) -> str:
        return json.dumps({
            "customerMessage": envelope.customerMessageMasked,
            "latestTurns": envelope.latestTurns,
            "persona": envelope.persona.model_dump(),
            "catalogVersionId": envelope.catalogVersionId,
            "catalogDigest": envelope.catalogDigest,
            "intentProjection": envelope.intentProjection.model_dump(),
        }, ensure_ascii=False)

    async def _response(self, envelope: TurnEnvelopeV2, budget: TurnBudget, *, input_value: Any, previous_response_id: str | None = None) -> Any:
        if budget.remaining() <= 0:
            raise BudgetExceeded("turn deadline exceeded")
        kwargs: dict[str, Any] = {
            "model": self.model,
            "instructions": composer_instructions(envelope),
            "input": input_value,
            "tools": definitions_for(envelope.toolAllowlist),
            "text": {"format": {"type": "json_schema", "name": "persona_response", "strict": True, "schema": _FINAL_RESPONSE_SCHEMA}},
            "max_output_tokens": 1700,
            "store": False,
        }
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        return await asyncio.wait_for(self.client.responses.create(**kwargs), timeout=max(0.001, budget.remaining()))

    def _calls(self, response: Any) -> list[FunctionCall] | None:
        calls: list[FunctionCall] = []
        for item in _value(response, "output", []) or []:
            if _value(item, "type") != "function_call":
                continue
            call_id = _value(item, "call_id")
            name = _value(item, "name")
            arguments = _value(item, "arguments")
            if not isinstance(call_id, str) or not isinstance(name, str) or not isinstance(arguments, str):
                return None
            calls.append(FunctionCall(call_id, name, arguments))
        return calls

    def _digest(self, result: ToolResultV2) -> str:
        return hashlib.sha256(json.dumps(result.model_dump(), sort_keys=True, default=str).encode()).hexdigest()

    async def _execute(self, envelope: TurnEnvelopeV2, call: FunctionCall, seen: dict[str, ToolResultV2]) -> tuple[ToolResultV2, ToolTraceV2]:
        started = time.monotonic()
        if call.call_id in seen:
            result = seen[call.call_id]
        elif call.name not in envelope.toolAllowlist or call.name not in TOOL_DEFINITIONS:
            result = ToolResultV2(schemaVersion=2, toolCallId=call.call_id, status="not_authorized", result=None, evidenceRefs=[], sourceVersion=None, stateRevision=envelope.sessionRevision)
        else:
            try:
                arguments = json.loads(call.arguments)
                if not isinstance(arguments, dict):
                    raise ValueError("arguments must be an object")
                request = ToolRequestV2(schemaVersion=2, toolCallId=call.call_id, toolName=call.name, arguments=arguments, scopeRef=envelope.scopeRef, expectedStateRevision=envelope.sessionRevision, deadlineAt=envelope.budgets.deadlineAt)
                result = await self.tool_gateway.execute(request)
                result = ToolResultV2.model_validate(result)
                encoded = json.dumps(result.result, ensure_ascii=False, default=str) if result.result is not None else ""
                if len(encoded) > self.result_limit:
                    result = ToolResultV2(schemaVersion=2, toolCallId=call.call_id, status="temporarily_unavailable", result={"code": "RESULT_TOO_LARGE"}, evidenceRefs=[], sourceVersion=None, stateRevision=envelope.sessionRevision)
            except (json.JSONDecodeError, ValueError, ValidationError):
                result = ToolResultV2(schemaVersion=2, toolCallId=call.call_id, status="invalid_args", result=None, evidenceRefs=[], sourceVersion=None, stateRevision=envelope.sessionRevision)
            except Exception:
                result = ToolResultV2(schemaVersion=2, toolCallId=call.call_id, status="temporarily_unavailable", result=None, evidenceRefs=[], sourceVersion=None, stateRevision=envelope.sessionRevision)
            seen[call.call_id] = result
        trace = ToolTraceV2(toolCallId=call.call_id, toolName=call.name, status=result.status, resultDigest=self._digest(result), elapsedMs=min(180_000, max(0, round((time.monotonic() - started) * 1000))))
        return result, trace

    async def run(self, envelope: TurnEnvelopeV2) -> AgentTurnResultV2:
        budget = TurnBudget.from_deadline(envelope.budgets.deadlineAt, 90)
        try:
            response = await self._response(envelope, budget, input_value=self._input(envelope))
            model_requests = 1
            seen: dict[str, ToolResultV2] = {}
            traces: list[ToolTraceV2] = []
            total_calls = 0
            for round_index in range(envelope.budgets.maxToolRounds + 1):
                calls = self._calls(response)
                if calls is None:
                    return AgentTurnResultV2(response=self._fallback(envelope, "malformed_tool_call"), toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
                if not calls:
                    try:
                        final, rejection = validate_composed_response(json.loads(_value(response, "output_text", "")), envelope)
                        if final is None:
                            return AgentTurnResultV2(response=self._fallback(envelope, rejection or "invalid_model_response"), toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
                        return AgentTurnResultV2(response=final, toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
                    except (json.JSONDecodeError, TypeError):
                        return AgentTurnResultV2(response=self._fallback(envelope, "invalid_model_response"), toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
                if round_index >= envelope.budgets.maxToolRounds or total_calls + len(calls) > envelope.budgets.maxToolCalls or model_requests >= envelope.budgets.maxModelRequests:
                    return AgentTurnResultV2(response=self._fallback(envelope, "tool_budget_exhausted"), toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
                outputs = []
                for call in calls:
                    result, trace = await self._execute(envelope, call, seen)
                    traces.append(trace)
                    total_calls += 1
                    outputs.append({"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(result.model_dump(), ensure_ascii=False)})
                response_id = _value(response, "id")
                if not isinstance(response_id, str) or not response_id:
                    return AgentTurnResultV2(response=self._fallback(envelope, "missing_response_id"), toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
                response = await self._response(envelope, budget, input_value=outputs, previous_response_id=response_id)
                model_requests += 1
            return AgentTurnResultV2(response=self._fallback(envelope, "tool_budget_exhausted"), toolTrace=traces, modelRequestCount=model_requests, toolCallCount=total_calls)
        except (BudgetExceeded, asyncio.TimeoutError):
            return AgentTurnResultV2(response=self._fallback(envelope, "turn_deadline_exceeded"), toolTrace=[], modelRequestCount=1, toolCallCount=0)

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import os
import re
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import ValidationError
import httpx

from .reliability import BudgetExceeded, TurnBudget
from .persona_composer import composer_instructions, validate_composed_response
from .tool_definitions import TOOL_DEFINITIONS, definitions_for
from .v2_contracts import AgentTurnResultV2, ApprovedEvidenceV2, PersonaComposedResponseV2, ToolRequestV2, ToolResultV2, ToolTraceV2, TurnEnvelopeV2


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
        "planning": {"anyOf": [
            {"type": "object", "additionalProperties": False, "properties": {
                "turnCategory": {"type": "string", "enum": ["business_goal", "knowledge_advisory", "qualification_requirement", "service_execution", "service_status_support", "conversation_navigation"]},
                "primaryGoalKey": {"type": ["string", "null"]},
                "candidateGoalKeys": {"type": "array", "items": {"type": "string"}},
                "matchedSignalIds": {"type": "array", "items": {"type": "string"}},
                "supportingTopicKeys": {"type": "array", "items": {"type": "string"}},
                "runnerUpScore": {"type": ["number", "null"]},
                "nextMove": {"type": "string", "enum": ["clarify_goal", "confirm_goal", "answer_knowledge", "collect_requirement", "request_contact", "request_document", "check_action_status", "propose_action", "ask_more_help", "stop"]},
                "nextQuestion": {"type": ["string", "null"]},
                "proposedToolKey": {"type": ["string", "null"]},
                "confidenceBand": {"type": "string", "enum": ["low", "medium", "high"]},
                "proposedFacts": {"type": "array", "items": {"type": "object", "additionalProperties": False, "properties": {
                    "key": {"type": "string", "enum": ["business_activity", "entity_type", "visa_count", "timeline"]},
                    "maskedValue": {"type": "string"}, "supportingQuote": {"type": "string"}
                }, "required": ["key", "maskedValue", "supportingQuote"]}},
            }, "required": ["turnCategory", "primaryGoalKey", "candidateGoalKeys", "matchedSignalIds", "supportingTopicKeys", "runnerUpScore", "nextMove", "nextQuestion", "proposedToolKey", "confidenceBand", "proposedFacts"]},
            {"type": "null"}
        ]},
    },
    "required": ["schemaVersion", "personaVersionId", "language", "answer", "citationIds", "nextQuestion", "nextQuestionKey", "reasonNoQuestion", "decisionRef", "planning"],
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


def diagnostic_candidate(raw: Any) -> str | None:
    if os.getenv("V2_DIAGNOSTIC_CAPTURE", "false").lower() != "true":
        return None
    if os.getenv("NODE_ENV", "development").lower() == "production":
        return None
    if not isinstance(raw, str) or not raw:
        return None
    redacted = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[REDACTED_EMAIL]", raw)
    redacted = re.sub(r"(?<!\w)\+?\d[\d ()-]{7,}\d", "[REDACTED_PHONE]", redacted)
    redacted = re.sub(r"(?i)(api[_ -]?key|token|secret|password)\s*[:=]\s*[^,\s}\"]+", r"\1=[REDACTED]", redacted)
    return redacted[:2_000]


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
            "catalogV2": envelope.catalogV2.model_dump() if envelope.catalogV2 else None,
            "intentProjection": envelope.intentProjection.model_dump(),
        }, ensure_ascii=False)

    async def _response(self, envelope: TurnEnvelopeV2, budget: TurnBudget, *, input_value: Any) -> Any:
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

    @staticmethod
    def _replayable_output(response: Any) -> list[dict[str, Any]]:
        """Stateless Responses continuation must replay function calls and reasoning items."""
        items: list[dict[str, Any]] = []
        for item in _value(response, "output", []) or []:
            if isinstance(item, dict):
                replay = item
            elif callable(getattr(item, "model_dump", None)):
                replay = item.model_dump(mode="json", exclude_none=True)
            elif _value(item, "type") == "function_call":
                # Lightweight test doubles can expose only function-call fields.
                replay = {key: _value(item, key) for key in ("type", "call_id", "name", "arguments")}
            else:
                raise ValueError("Non-replayable response item")
            if not isinstance(replay, dict) or not isinstance(replay.get("type"), str):
                raise ValueError("Invalid response output item")
            items.append(replay)
        return items

    def _digest(self, result: ToolResultV2) -> str:
        return hashlib.sha256(json.dumps(result.model_dump(), sort_keys=True, default=str).encode()).hexdigest()

    @staticmethod
    def _evidence_from_result(call: FunctionCall, result: ToolResultV2) -> list[ApprovedEvidenceV2]:
        if result.status != "ok" or not isinstance(result.result, dict):
            return []
        raw = result.result.get("evidence")
        if not isinstance(raw, list):
            return []
        evidence: list[ApprovedEvidenceV2] = []
        for item in raw:
            try:
                parsed = ApprovedEvidenceV2.model_validate(item)
                if parsed.citationId in result.evidenceRefs:
                    evidence.append(parsed)
            except ValidationError:
                continue
        return evidence

    @staticmethod
    def _result(envelope: TurnEnvelopeV2, response: PersonaComposedResponseV2, traces: list[ToolTraceV2], model_requests: int, tool_calls: int, evidence: dict[str, ApprovedEvidenceV2], diagnostic: str | None = None) -> AgentTurnResultV2:
        return AgentTurnResultV2(response=response, toolTrace=traces, approvedEvidence=list(evidence.values()), modelRequestCount=model_requests, toolCallCount=tool_calls, diagnosticCandidate=diagnostic)

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
        trace = ToolTraceV2(toolCallId=call.call_id, toolName=call.name, status=result.status, resultDigest=self._digest(result), elapsedMs=min(180_000, max(0, round((time.monotonic() - started) * 1000))), evidenceRefs=result.evidenceRefs)
        return result, trace

    async def run(self, envelope: TurnEnvelopeV2) -> AgentTurnResultV2:
        budget = TurnBudget.from_deadline(envelope.budgets.deadlineAt, 90)
        try:
            history: list[dict[str, Any]] = [{"role": "user", "content": self._input(envelope)}]
            response = await self._response(envelope, budget, input_value=history)
            model_requests = 1
            seen: dict[str, ToolResultV2] = {}
            approved_evidence: dict[str, ApprovedEvidenceV2] = {}
            traces: list[ToolTraceV2] = []
            total_calls = 0
            diagnostic = None
            for round_index in range(envelope.budgets.maxToolRounds + 1):
                diagnostic = diagnostic_candidate(_value(response, "output_text", "")) or diagnostic
                calls = self._calls(response)
                if calls is None:
                    return self._result(envelope, self._fallback(envelope, "malformed_tool_call"), traces, model_requests, total_calls, approved_evidence, diagnostic)
                if not calls:
                    try:
                        final, rejection = validate_composed_response(json.loads(_value(response, "output_text", "")), envelope)
                        if final is None:
                            return self._result(envelope, self._fallback(envelope, rejection or "invalid_model_response"), traces, model_requests, total_calls, approved_evidence, diagnostic)
                        return self._result(envelope, final, traces, model_requests, total_calls, approved_evidence, diagnostic)
                    except (json.JSONDecodeError, TypeError):
                        return self._result(envelope, self._fallback(envelope, "invalid_model_response"), traces, model_requests, total_calls, approved_evidence, diagnostic)
                if round_index >= envelope.budgets.maxToolRounds or total_calls + len(calls) > envelope.budgets.maxToolCalls or model_requests >= envelope.budgets.maxModelRequests:
                    return self._result(envelope, self._fallback(envelope, "tool_budget_exhausted"), traces, model_requests, total_calls, approved_evidence, diagnostic)
                outputs = []
                for call in calls:
                    result, trace = await self._execute(envelope, call, seen)
                    traces.append(trace)
                    for item in self._evidence_from_result(call, result):
                        approved_evidence[item.citationId] = item
                    total_calls += 1
                    outputs.append({"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(result.model_dump(), ensure_ascii=False)})
                history.extend(self._replayable_output(response))
                history.extend(outputs)
                response = await self._response(envelope, budget, input_value=history)
                model_requests += 1
            return self._result(envelope, self._fallback(envelope, "tool_budget_exhausted"), traces, model_requests, total_calls, approved_evidence, diagnostic)
        except (BudgetExceeded, asyncio.TimeoutError):
            return AgentTurnResultV2(response=self._fallback(envelope, "turn_deadline_exceeded"), toolTrace=[], approvedEvidence=[], modelRequestCount=1, toolCallCount=0)
        except ValueError:
            return AgentTurnResultV2(response=self._fallback(envelope, "invalid_model_response"), toolTrace=[], approvedEvidence=[], modelRequestCount=1, toolCallCount=0)

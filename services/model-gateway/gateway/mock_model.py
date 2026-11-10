"""Deterministic, offline Responses-compatible client for disposable UAT only."""

from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import Any


_PENDING_QUESTIONS = {
    "business_activity": "What business activity are you planning?",
    "entity_type": "What company structure are you considering?",
    "visa_count": "How many visas do you expect to need?",
    "timeline": "When are you hoping to get started?",
    "name": "What name should I use for your contact record?",
    "email": "What email address may we use to contact you?",
    "phone": "What phone number may we use to contact you?",
}


def _item_value(item: Any, key: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(key, default)
    return getattr(item, key, default)


def _payload(input_value: Any) -> dict[str, Any]:
    if not isinstance(input_value, list):
        return {}
    for item in input_value:
        if _item_value(item, "role") != "user":
            continue
        content = _item_value(item, "content")
        if isinstance(content, str):
            try:
                value = json.loads(content)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return value
    return {}


def _tool_names(tools: Any) -> list[str]:
    names: list[str] = []
    for tool in tools or []:
        name = _item_value(tool, "name")
        if isinstance(name, str):
            names.append(name)
    return names


def _evidence(input_value: Any) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    if not isinstance(input_value, list):
        return evidence
    for item in input_value:
        if _item_value(item, "type") != "function_call_output":
            continue
        raw = _item_value(item, "output")
        try:
            result = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            continue
        if not isinstance(result, dict) or not isinstance(result.get("result"), dict):
            continue
        values = result["result"].get("evidence")
        if isinstance(values, list):
            evidence.extend(value for value in values if isinstance(value, dict))
    return evidence[:4]


class MockResponsesClient:
    """Small local substitute matching the AsyncOpenAI Responses surface."""

    def __init__(self) -> None:
        self.responses = self
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        format_name = _item_value(_item_value(kwargs.get("text", {}), "format", {}), "name")
        if format_name == "conversation_plan":
            raw = kwargs.get("input")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else {}
            except json.JSONDecodeError:
                payload = {}
            message = str(payload.get("message", "")).strip()
            context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
            catalog = payload.get("catalog") if isinstance(payload.get("catalog"), dict) else {}
            evidence = payload.get("evidence") if isinstance(payload.get("evidence"), list) else []
            goal_keys = [value for value in catalog.get("businessGoalKeys", []) if isinstance(value, str)]
            primary_goal = context.get("confirmedGoalKey") if isinstance(context.get("confirmedGoalKey"), str) else (goal_keys[0] if goal_keys else None)
            pending_key = context.get("pendingRequirementKey") if isinstance(context.get("pendingRequirementKey"), str) else None
            knowledge = bool(re.search(r"\b(price|pricing|cost|fee|eligible|eligibility|license|licence|process|timeline|time)\b", message.lower()))
            next_question = _PENDING_QUESTIONS.get(pending_key) if pending_key else None
            answer = "I can help with your company-formation request."
            if knowledge and evidence:
                answer = str(evidence[0].get("content", answer))[:1200]
            elif knowledge:
                answer = "I cannot verify that detail from the approved information currently available."
            if next_question:
                answer = f"{answer} {next_question}"
            return SimpleNamespace(
                output=[],
                output_text=json.dumps({
                    "answer": answer,
                    "citationIds": [item.get("citationId") for item in evidence if isinstance(item, dict) and isinstance(item.get("citationId"), str)],
                    "turnCategory": "knowledge_advisory" if knowledge else "qualification_requirement",
                    "primaryGoalKey": primary_goal,
                    "nextMove": "answer_knowledge" if knowledge else "collect_requirement",
                    "nextQuestion": next_question,
                    "proposedToolKey": None,
                    "conversationSummary": str(payload.get("conversationSummary", ""))[:3000],
                    "confidenceBand": "high" if primary_goal else "medium",
                    "candidateGoalKeys": goal_keys[:8],
                    "matchedSignalIds": [],
                    "supportingTopicKeys": [],
                    "runnerUpScore": None,
                }),
            )
        if format_name == "rag_normalization":
            raw = kwargs.get("input")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else {}
            except json.JSONDecodeError:
                payload = {}
            return SimpleNamespace(output=[], output_text=json.dumps({"normalizedQuery": str(payload.get("message", ""))[:4000]}))
        if format_name == "crm_summary":
            raw = kwargs.get("input")
            try:
                payload = json.loads(raw) if isinstance(raw, str) else {}
            except json.JSONDecodeError:
                payload = {}
            return SimpleNamespace(output=[], output_text=json.dumps({"summary": str(payload.get("maskedSummary", "Intent: unknown"))[:20000]}))
        payload = _payload(kwargs.get("input"))
        message = str(payload.get("customerMessage", "")).strip()
        persona = payload.get("persona") if isinstance(payload.get("persona"), dict) else {}
        persona_id = str(persona.get("personaVersionId", "persona-uat"))
        language = (persona.get("permittedLanguages") or ["en"])[0]
        pending = payload.get("intentProjection", {}).get("pendingRequirementKey")
        pending_key = str(pending) if isinstance(pending, str) else None

        if not any(_item_value(item, "type") == "function_call_output" for item in kwargs.get("input", []) or []):
            names = _tool_names(kwargs.get("tools"))
            lowered = message.lower()
            if "search_knowledge" in names and re.search(r"\b(price|pricing|cost|fee|eligible|eligibility|license|licence|process|timeline|time)\b", lowered):
                call = SimpleNamespace(
                    type="function_call",
                    call_id="mock-call-0001",
                    name="search_knowledge",
                    arguments=json.dumps({"query": message[:2000], "resultCount": 3}),
                )
                return SimpleNamespace(output=[call], output_text="")
            for candidate in ("get_journey_state", "get_missing_requirements", "get_conversation_context", "get_conversation_history_summary"):
                if candidate in names:
                    call = SimpleNamespace(type="function_call", call_id="mock-call-0001", name=candidate, arguments="{}")
                    return SimpleNamespace(output=[call], output_text="")

        evidence = _evidence(kwargs.get("input"))
        citation_ids = [str(item["citationId"]) for item in evidence if isinstance(item.get("citationId"), str)]
        if evidence:
            answer = str(evidence[0].get("text", "Approved information is available for this question."))[:1500]
        elif re.search(r"\b(price|pricing|cost|fee|eligible|eligibility|license|licence|process|timeline|time)\b", message.lower()):
            answer = "I do not have an approved source to verify that detail yet, but I can still help with your company-formation request."
        else:
            answer = "I can help with your company-formation request."
        next_question = _PENDING_QUESTIONS.get(pending_key) if pending_key else None
        if next_question:
            answer = f"{answer} {next_question}"
        return SimpleNamespace(
            output=[],
            output_text=json.dumps({
                "schemaVersion": 2,
                "personaVersionId": persona_id,
                "language": language,
                "answer": answer,
                "citationIds": citation_ids,
                "nextQuestion": next_question,
                "nextQuestionKey": pending_key if next_question else None,
                "reasonNoQuestion": None if next_question else "mock_complete",
                "decisionRef": "mock-decision-0001",
            }),
        )

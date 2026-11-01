"""Opt-in per-turn LangGraph controller. Node/PostgreSQL remains the durable business authority.

This graph deliberately has no checkpointer: putting untrusted conversation or encrypted
model reasoning into the user's existing database would be an unreviewed data migration.
Node already persists session, intent, action and stage state; the graph receives a
fresh, authoritative envelope each turn. Enable only for explicit UAT tenants.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from .agent import BoundedConversationAgent, FunctionCall
from .reliability import BudgetExceeded, TurnBudget
from .persona_composer import validate_composed_response
from .v2_contracts import AgentTurnResultV2, ApprovedEvidenceV2, ToolResultV2, ToolTraceV2, TurnEnvelopeV2


class GraphTurnState(TypedDict, total=False):
    envelope: TurnEnvelopeV2
    budget: TurnBudget
    history: list[dict[str, Any]]
    latest_response: Any
    calls: list[FunctionCall]
    seen: dict[str, ToolResultV2]
    approved_evidence: dict[str, ApprovedEvidenceV2]
    traces: list[ToolTraceV2]
    model_count: int
    tool_count: int
    round_count: int
    result: AgentTurnResultV2


class LangGraphConversationAgent(BoundedConversationAgent):
    """One bounded model -> trusted tools -> model cycle per authenticated Node turn."""

    def __init__(self, client: Any, tool_gateway: Any, model: str) -> None:
        super().__init__(client, tool_gateway, model)
        graph = StateGraph(GraphTurnState)
        graph.add_node("model", self._model_node)
        graph.add_node("trusted_tools", self._tools_node)
        graph.add_edge(START, "model")
        graph.add_conditional_edges(
            "model", self._route, {"tools": "trusted_tools", "done": END}
        )
        graph.add_edge("trusted_tools", "model")
        # No implicit DB schema creation, network side effects or raw-PII checkpoint.
        self.graph = graph.compile()

    def _result(self, state: GraphTurnState, answer: Any) -> AgentTurnResultV2:
        return AgentTurnResultV2(
            response=answer,
            toolTrace=state["traces"],
            approvedEvidence=list(state.get("approved_evidence", {}).values()),
            modelRequestCount=max(1, state["model_count"]),
            toolCallCount=state["tool_count"],
        )

    def _failed(self, state: GraphTurnState, reason: str) -> dict[str, Any]:
        return {
            "calls": [],
            "result": self._result(state, self._fallback(state["envelope"], reason)),
        }

    async def _model_node(self, state: GraphTurnState) -> dict[str, Any]:
        envelope = state["envelope"]
        if state["model_count"] >= envelope.budgets.maxModelRequests:
            return self._failed(state, "model_budget_exhausted")
        try:
            response = await self._response(
                envelope, state["budget"], input_value=state["history"]
            )
            next_count = state["model_count"] + 1
            calls = self._calls(response)
            next_state: GraphTurnState = {**state, "model_count": next_count}
            if calls is None:
                return {**self._failed(next_state, "malformed_tool_call"), "model_count": next_count}
            if not calls:
                final, rejection = validate_composed_response(
                    json.loads(getattr(response, "output_text", "")), envelope
                )
                if final is None:
                    return {**self._failed(next_state, rejection or "invalid_model_response"), "model_count": next_count}
                return {"model_count": next_count, "calls": [], "result": self._result(next_state, final)}
            if (state["round_count"] >= envelope.budgets.maxToolRounds
                or state["tool_count"] + len(calls) > envelope.budgets.maxToolCalls
                or next_count >= envelope.budgets.maxModelRequests):
                return {**self._failed(next_state, "tool_budget_exhausted"), "model_count": next_count}
            return {"model_count": next_count, "latest_response": response, "calls": calls}
        except (BudgetExceeded, asyncio.TimeoutError):
            return self._failed(state, "turn_deadline_exceeded")
        except Exception:
            # No model errors, raw prompts or credentials are included in the response.
            return self._failed(state, "model_unavailable")

    @staticmethod
    def _route(state: GraphTurnState) -> str:
        return "done" if "result" in state else "tools"

    async def _tools_node(self, state: GraphTurnState) -> dict[str, Any]:
        envelope = state["envelope"]
        seen = dict(state["seen"])
        traces = list(state["traces"])
        output = []
        for call in state["calls"]:
            result, trace = await self._execute(envelope, call, seen)
            seen[call.call_id] = result
            traces.append(trace)
            for item in self._evidence_from_result(call, result):
                state.setdefault("approved_evidence", {})[item.citationId] = item
            output.append({
                "type": "function_call_output",
                "call_id": call.call_id,
                "output": json.dumps(result.model_dump(mode="json"), ensure_ascii=False),
            })
        try:
            history = [
                *state["history"],
                *self._replayable_output(state["latest_response"]),
                *output,
            ]
        except (TypeError, ValueError):
            return self._failed(state, "invalid_model_response")
        return {
            "seen": seen, "traces": traces, "history": history,
            "tool_count": state["tool_count"] + len(state["calls"]),
            "round_count": state["round_count"] + 1,
        }

    async def run(self, envelope: TurnEnvelopeV2) -> AgentTurnResultV2:
        state: GraphTurnState = {
            "envelope": envelope,
            "budget": TurnBudget.from_deadline(envelope.budgets.deadlineAt, 90),
            "history": [{"role": "user", "content": self._input(envelope)}],
            "calls": [], "seen": {}, "traces": [],
            "approved_evidence": {},
            "model_count": 0, "tool_count": 0, "round_count": 0,
        }
        try:
            final = await self.graph.ainvoke(
                state,
                config={"recursion_limit": max(5, 2 * envelope.budgets.maxToolRounds + 5)},
            )
            result = final.get("result")
            if isinstance(result, AgentTurnResultV2):
                return result
        except Exception:
            pass
        return self._result(state, self._fallback(envelope, "graph_unavailable"))

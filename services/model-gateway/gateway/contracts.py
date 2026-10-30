from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")

class Evidence(Strict):
    citationId: str = Field(min_length=1, max_length=180)
    content: str = Field(max_length=3600)

class PlanRequest(Strict):
    requestId: str = Field(min_length=1, max_length=128)
    message: str = Field(max_length=5000)
    conversationSummary: str = Field(default="", max_length=4000)
    personaName: str = Field(default="Assistant", max_length=150)
    context: dict[str, Any] = Field(default_factory=dict)
    catalog: dict[str, Any] = Field(default_factory=dict)
    evidence: list[Evidence] = Field(default_factory=list, max_length=12)
    responseMode: str = Field(default="dialogue", max_length=80)
    deadlineAt: str | None = Field(default=None, max_length=80)

class PlanResult(Strict):
    answer: str = Field(min_length=1, max_length=12000)
    citationIds: list[str] = Field(default_factory=list)
    turnCategory: Literal["business_goal", "knowledge_advisory", "qualification_requirement", "service_execution", "service_status_support", "conversation_navigation"]
    primaryGoalKey: str | None = None
    nextMove: Literal["clarify_goal", "confirm_goal", "answer_knowledge", "collect_requirement", "request_contact", "request_document", "check_action_status", "propose_action", "ask_more_help", "stop"]
    nextQuestion: str | None = None
    proposedToolKey: str | None = None
    conversationSummary: str = Field(default="", max_length=3000)
    confidenceBand: Literal["low", "medium", "high"]
    candidateGoalKeys: list[str] = Field(default_factory=list, max_length=8)
    matchedSignalIds: list[str] = Field(default_factory=list, max_length=32)
    supportingTopicKeys: list[str] = Field(default_factory=list, max_length=16)
    runnerUpScore: float | None = Field(default=None, ge=0, le=100)
    modelRequestId: str | None = None

class NormalizeRequest(Strict):
    requestId: str = Field(min_length=1, max_length=128)
    message: str = Field(max_length=4000)
    conversationSummary: str = Field(default="", max_length=2000)
    catalog: dict[str, Any] = Field(default_factory=dict)
    deadlineAt: str | None = Field(default=None, max_length=80)

class NormalizeResult(Strict):
    normalizedQuery: str = Field(max_length=4000)

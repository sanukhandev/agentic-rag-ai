"""Isolated P4 protocol. Does not modify the live V2 runtime."""
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictP4(BaseModel):
    model_config = ConfigDict(extra="forbid")


class P4Persona(StrictP4):
    versionId: str = Field(min_length=1, max_length=256)
    instructions: str = Field(max_length=6000)


class P4HistoryTurn(StrictP4):
    role: Literal["customer", "assistant"]
    text: str = Field(max_length=4000)


class P4Fact(StrictP4):
    key: str = Field(min_length=1, max_length=100)
    value: str = Field(max_length=4000)
    source: Literal["customer", "catalog", "node", "provider"]
    sourceReference: str = Field(max_length=256)
    revision: int = Field(ge=0)


class P4ActionStatus(StrictP4):
    actionId: str = Field(min_length=1, max_length=256)
    actionKey: str = Field(max_length=128)
    status: Literal["proposed", "awaiting_authorization", "queued", "executing", "verified_completed", "failed", "reconciliation_required"]


class P4ToolDefinition(StrictP4):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,79}$")
    description: str = Field(max_length=1500)
    argumentsSchema: dict[str, Any]


class P4Limits(StrictP4):
    maxModelCalls: int = Field(ge=1, le=8)
    maxToolCalls: int = Field(ge=0, le=12)
    maxToolRounds: int = Field(ge=0, le=6)
    deadlineMs: int = Field(ge=1000, le=180000)


class P4TurnEnvelope(StrictP4):
    requestId: str = Field(min_length=1, max_length=128)
    tenantId: str = Field(min_length=1, max_length=128)
    sessionId: str = Field(min_length=1, max_length=128)
    customerMessage: str = Field(min_length=1, max_length=4000)
    persona: P4Persona
    catalogVersionId: str = Field(min_length=1, max_length=128)
    publishedGoalKeys: list[str] = Field(max_length=100)
    conversationSummary: str = Field(max_length=6000)
    latestTurns: list[P4HistoryTurn] = Field(max_length=16)
    verifiedFacts: list[P4Fact] = Field(max_length=100)
    pendingActionStatus: list[P4ActionStatus] = Field(max_length=32)
    allowedReadTools: list[P4ToolDefinition] = Field(max_length=4)
    readToolScopeRef: str = Field(min_length=40, max_length=4096)
    limits: P4Limits

    @model_validator(mode="after")
    def validate_tools(self) -> "P4TurnEnvelope":
        names = [tool.name for tool in self.allowedReadTools]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate P4 tool")
        if not set(names).issubset({"search_knowledge", "get_conversation_summary", "get_verified_customer_facts", "list_supported_goals"}):
            raise ValueError("Unreviewed P4 tool")
        return self


class P4ClaimSupport(StrictP4):
    text: str = Field(min_length=1, max_length=1500)
    citationIds: list[str] = Field(min_length=1, max_length=8)


class P4ModelCandidate(StrictP4):
    message: str = Field(min_length=1, max_length=12000)
    evidenceRefs: list[str] = Field(max_length=24)
    goalCandidateKeys: list[str] = Field(max_length=8)
    proposedFacts: list[dict[str, Any]] = Field(max_length=0)
    actionProposal: None
    claimSupports: list[P4ClaimSupport] = Field(max_length=8)


class P4EvidenceReceipt(StrictP4):
    citationId: str = Field(min_length=1, max_length=256)
    receipt: str = Field(min_length=40, max_length=6000)


class P4ToolCall(StrictP4):
    toolCallId: str = Field(min_length=1, max_length=128)
    toolName: str = Field(min_length=1, max_length=80)
    arguments: dict[str, Any]
    scopeRef: str = Field(min_length=40, max_length=4096)


class P4ToolResult(StrictP4):
    toolCallId: str
    status: Literal["ok", "forbidden", "invalid_input", "unavailable"]
    data: Any = None
    evidenceReceipts: list[P4EvidenceReceipt] = Field(default_factory=list, max_length=5)


class P4TurnResult(StrictP4):
    candidate: P4ModelCandidate
    evidenceReceipts: list[P4EvidenceReceipt] = Field(max_length=24)
    modelCalls: int = Field(ge=1, le=8)
    toolCalls: int = Field(ge=0, le=12)
    toolRounds: int = Field(ge=0, le=6)

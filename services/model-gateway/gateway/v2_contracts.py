from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictV2(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PersonaEnvelopeV2(StrictV2):
    personaVersionId: str = Field(min_length=8, max_length=256)
    assistantName: str = Field(min_length=1, max_length=150)
    assistantRole: str = Field(min_length=1, max_length=300)
    permittedLanguages: list[str] = Field(min_length=1, max_length=8)
    tone: list[str] = Field(default_factory=list, max_length=12)
    speakingStyle: str = Field(max_length=500)
    fallbackTemplateVersion: str = Field(min_length=8, max_length=256)


class IntentProjectionV2(StrictV2):
    primaryGoalKey: str | None
    goalConfirmed: bool
    currentStageKey: str | None
    pendingRequirementKey: str | None


class BudgetsV2(StrictV2):
    maxModelRequests: int = Field(ge=1, le=8)
    maxToolCalls: int = Field(ge=0, le=12)
    maxToolRounds: int = Field(ge=0, le=6)
    deadlineAt: str


class TurnEnvelopeV2(StrictV2):
    schemaVersion: Literal[2]
    requestId: str = Field(min_length=8, max_length=256)
    clientMessageId: str = Field(min_length=8, max_length=256)
    scopeRef: str = Field(min_length=8, max_length=256)
    sessionRevision: int = Field(ge=0)
    intentRevision: int = Field(ge=0)
    catalogVersionId: str = Field(min_length=8, max_length=256)
    personaVersionId: str = Field(min_length=8, max_length=256)
    customerMessageMasked: str = Field(max_length=5000)
    latestTurns: list[dict[str, str]] = Field(default_factory=list, max_length=8)
    persona: PersonaEnvelopeV2
    catalogDigest: str = Field(pattern=r"^[a-f0-9]{64}$")
    intentProjection: IntentProjectionV2
    toolAllowlist: list[str] = Field(default_factory=list, max_length=32)
    budgets: BudgetsV2

    @model_validator(mode="after")
    def persona_pin_matches(self) -> "TurnEnvelopeV2":
        if self.persona.personaVersionId != self.personaVersionId:
            raise ValueError("persona pin mismatch")
        return self


class ToolRequestV2(StrictV2):
    schemaVersion: Literal[2]
    toolCallId: str = Field(min_length=8, max_length=256)
    toolName: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)
    scopeRef: str = Field(min_length=8, max_length=256)
    expectedStateRevision: int = Field(ge=0)
    deadlineAt: str

    @model_validator(mode="after")
    def identity_is_server_derived(self) -> "ToolRequestV2":
        forbidden = {"tenantId", "sessionId", "opportunityId", "scopeRef"}
        if forbidden.intersection(self.arguments):
            raise ValueError("identity scope is server-derived")
        return self


class ToolResultV2(StrictV2):
    schemaVersion: Literal[2]
    toolCallId: str = Field(min_length=8, max_length=256)
    status: Literal["ok", "temporarily_unavailable", "not_authorized", "invalid_args", "stale_state"]
    result: dict[str, Any] | None
    evidenceRefs: list[str] = Field(default_factory=list, max_length=32)
    sourceVersion: str | None
    stateRevision: int = Field(ge=0)


class PersonaComposedResponseV2(StrictV2):
    schemaVersion: Literal[2]
    personaVersionId: str = Field(min_length=8, max_length=256)
    language: str
    answer: str = Field(min_length=1, max_length=12000)
    citationIds: list[str] = Field(default_factory=list, max_length=32)
    nextQuestion: str | None = Field(default=None, max_length=1000)
    nextQuestionKey: str | None = None
    reasonNoQuestion: str | None = Field(default=None, max_length=300)
    decisionRef: str = Field(min_length=8, max_length=256)


class ResponseGuardVerdictV2(StrictV2):
    schemaVersion: Literal[2]
    accepted: bool
    reasonCode: Literal["accepted", "persona_mismatch", "invalid_citation", "unsupported_claim", "invalid_question", "metadata_leak", "stale_state", "policy_denied"]
    response: PersonaComposedResponseV2 | None

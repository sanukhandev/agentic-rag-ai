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


class ConfirmedCustomerFactsV2(StrictV2):
    business_activity: str | None = Field(default=None, max_length=180)
    entity_type: str | None = Field(default=None, max_length=80)
    visa_count: str | None = Field(default=None, max_length=12)
    timeline: str | None = Field(default=None, max_length=100)


class IntentProjectionV2(StrictV2):
    primaryGoalKey: str | None
    goalConfirmed: bool
    currentStageKey: str | None
    pendingRequirementKey: str | None
    confirmedCustomerFacts: ConfirmedCustomerFactsV2 | None = None


class BudgetsV2(StrictV2):
    maxModelRequests: int = Field(ge=1, le=8)
    maxToolCalls: int = Field(ge=0, le=12)
    maxToolRounds: int = Field(ge=0, le=6)
    deadlineAt: str


class CatalogV2Projection(StrictV2):
    versionRef: str = Field(min_length=8, max_length=240)
    businessGoals: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    turnIntents: list[dict[str, Any]] = Field(default_factory=list, max_length=200)
    signals: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    requirementKeys: list[str] = Field(default_factory=list, max_length=500)
    enabledReadToolKeys: list[str] = Field(default_factory=list, max_length=32)


class ApprovedKnowledgeSnippetV2(StrictV2):
    citationId: str = Field(min_length=8, max_length=256)
    sourceRef: str = Field(min_length=8, max_length=256)
    sourceVersion: str = Field(min_length=8, max_length=256)
    text: str = Field(min_length=1, max_length=1500)


class KnowledgeRepairV2(StrictV2):
    reason: Literal["unsupported_claim"]
    strategy: Literal["source_close"]


class TurnEnvelopeV2(StrictV2):
    schemaVersion: Literal[2]
    requestId: str = Field(min_length=8, max_length=256)
    clientMessageId: str = Field(min_length=8, max_length=256)
    scopeRef: str = Field(min_length=8, max_length=2048)
    sessionRevision: int = Field(ge=0)
    intentRevision: int = Field(ge=0)
    catalogVersionId: str = Field(min_length=8, max_length=256)
    personaVersionId: str = Field(min_length=8, max_length=256)
    customerMessageMasked: str = Field(max_length=5000)
    latestTurns: list[dict[str, str]] = Field(default_factory=list, max_length=8)
    persona: PersonaEnvelopeV2
    catalogDigest: str = Field(pattern=r"^[a-f0-9]{64}$")
    approvedKnowledge: list[ApprovedKnowledgeSnippetV2] = Field(default_factory=list, max_length=4)
    knowledgeRepair: KnowledgeRepairV2 | None = None
    catalogV2: CatalogV2Projection | None = None
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
    scopeRef: str = Field(min_length=8, max_length=2048)
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


class ProposedCustomerFactV2(StrictV2):
    key: Literal["business_activity", "entity_type", "visa_count", "timeline"]
    maskedValue: str = Field(min_length=1, max_length=180)
    supportingQuote: str = Field(min_length=1, max_length=300)


class PlanningProposalV2(StrictV2):
    turnCategory: Literal['business_goal', 'knowledge_advisory', 'qualification_requirement', 'service_execution', 'service_status_support', 'conversation_navigation']
    primaryGoalKey: str | None = None
    candidateGoalKeys: list[str] = Field(default_factory=list, max_length=8)
    matchedSignalIds: list[str] = Field(default_factory=list, max_length=32)
    supportingTopicKeys: list[str] = Field(default_factory=list, max_length=16)
    runnerUpScore: float | None = Field(default=None, ge=0, le=100)
    nextMove: Literal['clarify_goal', 'confirm_goal', 'answer_knowledge', 'collect_requirement', 'request_contact', 'request_document', 'check_action_status', 'propose_action', 'ask_more_help', 'stop']
    nextQuestion: str | None = Field(default=None, max_length=1000)
    proposedToolKey: str | None = None
    confidenceBand: Literal["low", "medium", "high"]
    proposedFacts: list[ProposedCustomerFactV2] = Field(default_factory=list, max_length=8)


class PersonaComposedResponseV2(StrictV2):
    schemaVersion: Literal[2]
    personaVersionId: str = Field(min_length=8, max_length=256)
    language: str
    answer: str = Field(min_length=1, max_length=12000)
    citationIds: list[str] = Field(default_factory=list, max_length=32)
    nextQuestion: str | None = Field(default=None, max_length=1000)
    nextQuestionKey: str | None = None
    reasonNoQuestion: str | None = Field(default=None, max_length=300)
    decisionRef: str = Field(min_length=1, max_length=256, pattern=r"^[A-Za-z0-9._:+-]+$")
    planning: PlanningProposalV2 | None = None


class ResponseGuardVerdictV2(StrictV2):
    schemaVersion: Literal[2]
    accepted: bool
    reasonCode: Literal["accepted", "persona_mismatch", "invalid_citation", "unsupported_claim", "invalid_question", "metadata_leak", "stale_state", "policy_denied"]
    response: PersonaComposedResponseV2 | None


class ToolTraceV2(StrictV2):
    toolCallId: str = Field(min_length=8, max_length=256)
    toolName: str = Field(min_length=1, max_length=128)
    status: Literal["ok", "temporarily_unavailable", "not_authorized", "invalid_args", "stale_state"]
    resultDigest: str = Field(pattern=r"^[a-f0-9]{64}$")
    elapsedMs: int = Field(ge=0, le=180_000)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=32)


class ApprovedEvidenceV2(StrictV2):
    citationId: str = Field(min_length=8, max_length=256)
    text: str = Field(min_length=1, max_length=1_500)
    sourceVersion: str = Field(min_length=8, max_length=256)
    approved: Literal[True]
    revoked: Literal[False]
    sourceRef: str = Field(min_length=8, max_length=256)


class AgentTurnResultV2(StrictV2):
    response: PersonaComposedResponseV2
    toolTrace: list[ToolTraceV2] = Field(default_factory=list, max_length=12)
    approvedEvidence: list[ApprovedEvidenceV2] = Field(default_factory=list, max_length=32)
    modelRequestCount: int = Field(ge=1, le=8)
    toolCallCount: int = Field(ge=0, le=12)
    diagnosticCandidate: str | None = Field(default=None, max_length=2_000)

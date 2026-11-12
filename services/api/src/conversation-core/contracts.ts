/**
 * Minimal, tenant-bound conversation contracts. The model is authoritative for
 * conversational text; Node is authoritative for permissions and persisted state.
 * No model-returned field is a trusted tenant identity or completed action.
 */
export interface TrustedActor {
  readonly tenantId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly role: 'anonymous' | 'customer' | 'tenant_agent' | 'tenant_admin' | 'platform_admin';
}

export interface CustomerTurn {
  readonly clientMessageId: string;
  readonly text: string;
  readonly signal?: AbortSignal;
}

export interface HistoryTurn {
  readonly role: 'customer' | 'assistant';
  readonly text: string;
}

export interface VerifiedFact {
  readonly key: string;
  readonly value: string;
  readonly source: 'customer' | 'catalog' | 'node' | 'provider';
  readonly sourceReference: string;
  readonly revision: number;
}

export interface SessionSnapshot {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly ownerPrincipalId: string;
  readonly revision: number;
  readonly personaVersionId: string;
  readonly catalogVersionId: string;
  readonly personaInstructions: string;
  readonly conversationSummary: string;
  readonly recentTurns: readonly HistoryTurn[];
  readonly verifiedFacts: readonly VerifiedFact[];
  readonly publishedGoalKeys: readonly string[];
  readonly pendingActionStatus: readonly {
    actionId: string;
    actionKey: string;
    status: 'proposed' | 'awaiting_authorization' | 'queued' | 'executing' | 'verified_completed' | 'failed' | 'reconciliation_required';
  }[];
}

export interface ReadToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly argumentsSchema: Readonly<Record<string, unknown>>;
}

export interface P5GoalSummary {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly customerExpressions: readonly string[];
  readonly requiredInformation: readonly string[];
  readonly factRequirementKeys: readonly string[];
  readonly requiredDocuments: readonly string[];
  readonly orderedSteps: readonly string[];
  readonly availableActionKeys: readonly string[];
}

export interface P5CatalogProjection {
  readonly versionId: string;
  readonly goals: readonly P5GoalSummary[];
}

export interface ModelTurnEnvelope {
  readonly requestId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly customerMessage: string;
  readonly persona: {
    readonly versionId: string;
    readonly instructions: string;
  };
  readonly catalogVersionId: string;
  readonly publishedGoalKeys: readonly string[];
  /** P5 is opt-in; absent for P4. Published tenant prose is untrusted data, not instructions. */
  readonly p5Catalog?: P5CatalogProjection;
  readonly conversationSummary: string;
  readonly latestTurns: readonly HistoryTurn[];
  readonly verifiedFacts: readonly VerifiedFact[];
  readonly pendingActionStatus: SessionSnapshot['pendingActionStatus'];
  readonly allowedReadTools: readonly ReadToolDefinition[];
  /** Issued and signed by Node, never accepted from the customer or model. */
  readonly readToolScopeRef: string;
  readonly limits: {
    readonly maxModelCalls: number;
    readonly maxToolCalls: number;
    readonly maxToolRounds: number;
    readonly deadlineMs: number;
  };
}

export interface CandidateFactUpdate {
  readonly key: string;
  readonly value: string;
  readonly supportingTurnId: string;
}

export interface CandidateActionProposal {
  readonly actionKey: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export interface ModelCandidate {
  readonly message: string;
  readonly evidenceRefs: readonly string[];
  readonly goalCandidateKeys: readonly string[];
  readonly proposedFacts: readonly CandidateFactUpdate[];
  readonly actionProposal: CandidateActionProposal | null;
  /** P4 evidence references are signed by Node and never model-authored. */
  readonly evidenceReceipts?: readonly { readonly citationId: string; readonly receipt: string }[];
  readonly claimSupports?: readonly { readonly text: string; readonly citationIds: readonly string[] }[];
}

export interface VerifiedResponse {
  readonly message: string;
  readonly evidenceRefs: readonly string[];
  readonly goalCandidateKeys: readonly string[];
  readonly verifiedFactPatches: readonly VerifiedFact[];
  /** An action proposal is never an approved command or execution outcome. */
  readonly pendingActionProposal: CandidateActionProposal | null;
}

export interface PersistedTurn {
  readonly sessionId: string;
  readonly clientMessageId: string;
  readonly requestDigest: string;
  readonly revision: number;
  readonly response: VerifiedResponse;
}

export interface ConversationRepository {
  findExistingTurn(actor: TrustedActor, clientMessageId: string, requestDigest: string): Promise<PersistedTurn | null>;
  loadAuthorizedSnapshot(actor: TrustedActor): Promise<SessionSnapshot>;
  /** Must atomically compare expectedRevision, persist turn and customer facts. */
  commitTurn(actor: TrustedActor, input: {
    readonly expectedRevision: number;
    readonly clientMessageId: string;
    readonly customerMessage: string;
    readonly requestDigest: string;
    readonly personaVersionId: string;
    readonly catalogVersionId: string;
    readonly response: VerifiedResponse;
  }): Promise<PersistedTurn>;
}

export interface ModelGateway {
  runTurn(envelope: ModelTurnEnvelope, signal: AbortSignal): Promise<unknown>;
}

export interface ReadToolCatalog {
  listFor(actor: TrustedActor, catalogVersionId: string): Promise<readonly ReadToolDefinition[]>;
  issueBoundScope(actor: TrustedActor, catalogVersionId: string, tools: readonly ReadToolDefinition[], sessionRevision: number): Promise<string>;
}

export interface ClaimVerifier {
  /** Should fail closed for consequential factual claims and reported side effects. */
  verify(actor: TrustedActor, candidate: ModelCandidate, pinned: SessionSnapshot, readToolScopeRef?: string): Promise<{ readonly ok: boolean; readonly reason?: string }>;
}

export interface ProposalValidator {
  validateFacts(actor: TrustedActor, candidate: ModelCandidate, pinned: SessionSnapshot, maskedCustomerMessage?: string, clientMessageId?: string): Promise<readonly VerifiedFact[]>;
  validateActionProposal(actor: TrustedActor, candidate: ModelCandidate, pinned: SessionSnapshot): Promise<CandidateActionProposal | null>;
}

/** Mandatory boundary for masking PII before model access and validating
 * customer-facing content. Production adapter uses the approved encrypted vault.
 * The core persists only masked conversation text; privileged facts are handled
 * by the repository's separately permissioned encrypted storage path.
 */
export interface PrivacyBoundary {
  prepareForModel(actor: TrustedActor, envelope: ModelTurnEnvelope): Promise<ModelTurnEnvelope>;
  validateMaskedResponse(actor: TrustedActor, candidate: ModelCandidate): Promise<void>;
}

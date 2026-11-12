import { createHash } from 'node:crypto';
import type {
  CandidateActionProposal, CandidateFactUpdate, ClaimVerifier, ConversationRepository,
  CustomerTurn, ModelCandidate, ModelGateway, ModelTurnEnvelope, PersistedTurn,
  ProposalValidator, ReadToolCatalog, PrivacyBoundary, SessionSnapshot, TrustedActor, VerifiedResponse,
} from './contracts.js';

export class ConversationInvariantError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'UNAUTHORIZED_SESSION' | 'INVALID_MODEL_OUTPUT' | 'UNSUPPORTED_CLAIM', message: string) {
    super(message);
    this.name = 'ConversationInvariantError';
  }
}

export interface TurnPolicy {
  readonly maxRecentTurns: number;
  readonly maxTextLength: number;
  readonly maxSummaryLength: number;
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxToolRounds: number;
  readonly deadlineMs: number;
}

const DEFAULT_POLICY: TurnPolicy = Object.freeze({
  maxRecentTurns: 16, maxTextLength: 4000, maxSummaryLength: 6000,
  maxModelCalls: 4, maxToolCalls: 8, maxToolRounds: 3, deadlineMs: 60_000,
});

function requiredString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function validFactPatch(value: unknown): value is CandidateFactUpdate {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CandidateFactUpdate>;
  return requiredString(v.key, 100) && requiredString(v.value, 4000) && requiredString(v.supportingTurnId, 128);
}

function validActionProposal(value: unknown): value is CandidateActionProposal | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Partial<CandidateActionProposal>;
  return requiredString(v.actionKey, 120) && requiredString(v.reason, 1000)
    && typeof v.input === 'object' && v.input !== null && !Array.isArray(v.input)
    && Object.keys(v.input).length <= 80;
}

function readCandidate(raw: unknown): ModelCandidate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConversationInvariantError('INVALID_MODEL_OUTPUT', 'Model candidate must be an object');
  }
  const c = raw as Partial<ModelCandidate>;
  if (!requiredString(c.message, 20_000)
    || !Array.isArray(c.evidenceRefs) || c.evidenceRefs.some(r => !requiredString(r, 256))
    || !Array.isArray(c.goalCandidateKeys) || c.goalCandidateKeys.some(g => !requiredString(g, 120))
    || !Array.isArray(c.proposedFacts) || c.proposedFacts.some(f => !validFactPatch(f))
    || !validActionProposal(c.actionProposal)) {
    throw new ConversationInvariantError('INVALID_MODEL_OUTPUT', 'Model candidate failed strict validation');
  }
  if (c.evidenceRefs.length > 24 || c.goalCandidateKeys.length > 8 || c.proposedFacts.length > 30) {
    throw new ConversationInvariantError('INVALID_MODEL_OUTPUT', 'Model candidate exceeded response limits');
  }
  return c as ModelCandidate;
}

function validateSnapshot(actor: TrustedActor, snapshot: SessionSnapshot): void {
  if (snapshot.tenantId !== actor.tenantId || snapshot.sessionId !== actor.sessionId
      || snapshot.ownerPrincipalId !== actor.principalId) {
    throw new ConversationInvariantError('UNAUTHORIZED_SESSION', 'Session scope mismatch');
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
    throw new ConversationInvariantError('INVALID_INPUT', 'Invalid session revision');
  }
}

/**
 * The Node turn service does not plan what to ask, execute external actions,
 * or synthesize fallback customer responses. The model writes the reply;
 * the application validates it and persists only checked changes.
 */
export class ConversationTurnEngine {
  constructor(
    private readonly repository: ConversationRepository,
    private readonly gateway: ModelGateway,
    private readonly tools: ReadToolCatalog,
    private readonly verifier: ClaimVerifier,
    private readonly proposals: ProposalValidator,
    private readonly privacy: PrivacyBoundary,
    private readonly policy: TurnPolicy = DEFAULT_POLICY,
  ) {}

  async process(actor: TrustedActor, turn: CustomerTurn): Promise<PersistedTurn> {
    if (!requiredString(actor.tenantId, 128) || !requiredString(actor.principalId, 128)
        || !requiredString(actor.sessionId, 128) || !requiredString(turn.clientMessageId, 128)
        || !requiredString(turn.text, this.policy.maxTextLength)) {
      throw new ConversationInvariantError('INVALID_INPUT', 'Missing or oversized request fields');
    }
    turn.signal?.throwIfAborted();
    const snapshot = await this.repository.loadAuthorizedSnapshot(actor);
    validateSnapshot(actor, snapshot);
    // Bind idempotency to the original request, not just the client-supplied key.
    const requestDigest = createHash('sha256').update(turn.text, 'utf8').digest('hex');
    const prior = await this.repository.findExistingTurn(actor, turn.clientMessageId, requestDigest);
    if (prior) return prior; // Idempotency is enforced again in commitTurn.
    const authorizedTools = await this.tools.listFor(actor, snapshot.catalogVersionId);
    // This is metadata only. The Python agent must call the independently
    // authorized Node read-tool executor; no action/external-write tools here.
    if (authorizedTools.some(t => !/^[a-z][a-z0-9_]{1,79}$/.test(t.name))) {
      throw new ConversationInvariantError('INVALID_INPUT', 'Invalid read tool registration');
    }
    const readToolScopeRef = await this.tools.issueBoundScope(actor, snapshot.catalogVersionId, authorizedTools);
    if (!requiredString(readToolScopeRef, 4096)) {
      throw new ConversationInvariantError('INVALID_INPUT', 'Missing signed read tool scope');
    }
    const envelope: ModelTurnEnvelope = {
      requestId: turn.clientMessageId,
      tenantId: actor.tenantId,
      sessionId: actor.sessionId,
      customerMessage: turn.text,
      persona: { versionId: snapshot.personaVersionId, instructions: snapshot.personaInstructions },
      catalogVersionId: snapshot.catalogVersionId,
      publishedGoalKeys: snapshot.publishedGoalKeys,
      conversationSummary: snapshot.conversationSummary.slice(0, this.policy.maxSummaryLength),
      latestTurns: snapshot.recentTurns.slice(-this.policy.maxRecentTurns),
      verifiedFacts: snapshot.verifiedFacts,
      pendingActionStatus: snapshot.pendingActionStatus,
      allowedReadTools: authorizedTools,
      readToolScopeRef,
      limits: {
        maxModelCalls: this.policy.maxModelCalls, maxToolCalls: this.policy.maxToolCalls,
        maxToolRounds: this.policy.maxToolRounds, deadlineMs: this.policy.deadlineMs,
      },
    };

    const deadline = AbortSignal.timeout(this.policy.deadlineMs);
    const signal = turn.signal ? AbortSignal.any([turn.signal, deadline]) : deadline;
    const maskedEnvelope = await this.privacy.prepareForModel(actor, envelope);
    // Privacy code may mask content, but must not widen tenant scope or tool rights.
    if (maskedEnvelope.tenantId !== actor.tenantId || maskedEnvelope.sessionId !== actor.sessionId
        || maskedEnvelope.readToolScopeRef !== readToolScopeRef
        || maskedEnvelope.catalogVersionId !== snapshot.catalogVersionId
        || maskedEnvelope.persona.versionId !== snapshot.personaVersionId
        || maskedEnvelope.allowedReadTools.length !== authorizedTools.length
        || maskedEnvelope.allowedReadTools.some((definition, index) => definition.name !== authorizedTools[index]?.name)) {
      throw new ConversationInvariantError('INVALID_INPUT', 'Privacy boundary changed trusted scope');
    }
    signal.throwIfAborted();
    const candidate = readCandidate(await this.gateway.runTurn(maskedEnvelope, signal));
    await this.privacy.validateMaskedResponse(actor, candidate);
    signal.throwIfAborted();
    if (candidate.goalCandidateKeys.some(k => !snapshot.publishedGoalKeys.includes(k))) {
      throw new ConversationInvariantError('INVALID_MODEL_OUTPUT', 'Model invented an unsupported tenant goal');
    }
    const check = await this.verifier.verify(actor, candidate, snapshot);
    if (!check.ok) throw new ConversationInvariantError('UNSUPPORTED_CLAIM', 'Ungrounded or unauthorized model response');
    const [verifiedFactPatches, pendingActionProposal] = await Promise.all([
      this.proposals.validateFacts(actor, candidate, snapshot),
      this.proposals.validateActionProposal(actor, candidate, snapshot),
    ]);
    if (candidate.actionProposal !== null && pendingActionProposal === null) {
      throw new ConversationInvariantError('INVALID_MODEL_OUTPUT', 'Unauthorized action proposal');
    }
    const response: VerifiedResponse = {
      message: candidate.message,
      evidenceRefs: [...new Set(candidate.evidenceRefs)],
      goalCandidateKeys: [...new Set(candidate.goalCandidateKeys)],
      verifiedFactPatches,
      pendingActionProposal,
    };
    signal.throwIfAborted();
    return this.repository.commitTurn(actor, {
      expectedRevision: snapshot.revision,
      clientMessageId: turn.clientMessageId,
      requestDigest,
      personaVersionId: snapshot.personaVersionId,
      catalogVersionId: snapshot.catalogVersionId,
      customerMessage: maskedEnvelope.customerMessage,
      response,
    });
  }
}

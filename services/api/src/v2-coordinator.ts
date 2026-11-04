import { agentTurnResultSchema, turnEnvelopeSchema, type AgentTurnResultV2, type PersonaComposedResponseV2, type TurnEnvelopeV2 } from './python-model/v2-contracts.js';
import { guardV2OfflineFallback, guardV2Response, type V2ResponseGuardContext } from './v2-response-guard.js';
import type { ModelDraft } from './model.js';
import { addVerifiedFactCitations, buildV2GroundingReviewClaims, v2MeanLexicalOverlapPercent, type V2ApprovedEvidence, type V2VerifiedFact } from './v2-evidence.js';
import { proofsFromV2GroundingReview, type V2GroundingVerifier } from './v2-grounding-verifier.js';
import type { V2ApprovedFallbackTemplateSet, V2FallbackFamily } from './v2-fallbacks.js';
import { hasPositiveBusinessOutcomeClaim, type V2ClaimProvenance } from './v2-claim-provenance.js';

export interface V2ConversationAgent {
  turn(envelope: TurnEnvelopeV2): Promise<unknown>;
}

export class HttpV2ConversationAgent implements V2ConversationAgent {
  constructor(private readonly baseUrl: string, private readonly serviceKey: string, private readonly timeoutMs = 90_000) {
    if (!/^https?:\/\//u.test(baseUrl) || !serviceKey || timeoutMs < 1_000 || timeoutMs > 180_000) throw new Error('V2 conversation agent requires a valid private URL, service key and bounded timeout.');
  }

  async turn(envelope: TurnEnvelopeV2): Promise<AgentTurnResultV2> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/internal/v2/conversation/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service-key': this.serviceKey },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error('V2_MODEL_UNAVAILABLE');
    const parsed = agentTurnResultSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error('V2_MODEL_INVALID_RESPONSE');
    return parsed.data;
  }
}

export interface V2CoordinatorRequest {
  envelope: TurnEnvelopeV2;
  evidence?: V2ApprovedEvidence[];
  verifiedFacts?: V2VerifiedFact[];
  questionPolicy?: V2ResponseGuardContext['questionPolicy'];
  lastQuestionKey?: string | null;
  fallbackTemplates?: V2ApprovedFallbackTemplateSet;
}

export interface V2CoordinatorResult {
  response: PersonaComposedResponseV2;
  /** Original model response retained for bounded local diagnostics and guard telemetry. */
  candidateResponse: PersonaComposedResponseV2;
  repairApplied: boolean;
  draft: ModelDraft;
  toolTrace: AgentTurnResultV2['toolTrace'];
  /** Authorized and verified evidence used by the response guard; for public source citations. */
  approvedEvidence?: V2ApprovedEvidence[];
  /** Per-consequential-claim citation and pinned version provenance; empty for dialogue/abstention. */
  claimProvenance: V2ClaimProvenance[];
  modelRequestCount: number;
  toolCallCount: number;
  guardReason: string;
  /** Original model candidate verdict, retained even when Node emits a safe fallback. */
  candidateGuardReason: string;
  /** The bounded knowledge repair's outcome, with no answer or source text. */
  knowledgeRepairStatus?: 'not_eligible' | 'skipped_untrusted_evidence' | 'skipped_budget'
    | 'attempted_invalid_result' | 'attempted_rejected' | 'attempted_error' | 'accepted';
  initialClaimFailureReason?: string | null;
  initialFailedClauseOrdinal?: number | null;
  repairCitationCount?: number | null;
  repairFailureReason?: string | null;
  repairClaimFailureReason?: string | null;
  repairFailedClauseOrdinal?: number | null;
  groundingReviewStatus?: 'not_configured' | 'not_eligible' | 'skipped_budget' | 'accepted' | 'rejected' | 'error';
  /** Lexical similarity is telemetry only, never a guard threshold. */
  groundingLexicalOverlapPercent?: number | null;
  /** Optional bounded Python-side candidate capture for explicit UAT diagnostics. */
  diagnosticCandidate?: string | null;
}

const fallbackFamilyFor = (reason: string): V2FallbackFamily => reason === 'stale_state' ? 'reconciliation' : reason === 'invalid_citation' || reason === 'unsupported_claim' || reason === 'metadata_leak' || reason === 'persona_mismatch' ? 'invalid_model' : 'tool_unavailable';
const toDraft = (response: PersonaComposedResponseV2): ModelDraft => ({ answer: response.answer, citationIds: response.citationIds, proposedIntent: null });
const stagePlaceholderContext = /\b(?:currently\s+at|at\s+the|about\s+the|in\s+the)\s+\[ID_\d+\](?:\s+stage)?/iu;
const stageLabel = (stageKey: string | null): string | null => {
  if (!stageKey) return null;
  const value = stageKey.replace(/_/gu, ' ');
  return value ? `${value[0]!.toLocaleUpperCase('en-US')}${value.slice(1)}` : null;
};
const repairAuthoritativeStagePlaceholder = (response: PersonaComposedResponseV2, activeStageKey: string | null): PersonaComposedResponseV2 => {
  const label = stageLabel(activeStageKey);
  if (!label) return response;
  const replaceField = (value: string | null): string | null => value && value.includes('[ID_') && stagePlaceholderContext.test(value)
    ? value.replace(new RegExp(stagePlaceholderContext.source, 'giu'), (match) => match.replace(/\[ID_\d+\]/iu, label))
    : value;
  const answer = replaceField(response.answer) ?? response.answer;
  const nextQuestion = replaceField(response.nextQuestion);
  return answer === response.answer && nextQuestion === response.nextQuestion ? response : { ...response, answer, nextQuestion };
};
const repairTrailingQuestionContract = (response: PersonaComposedResponseV2): PersonaComposedResponseV2 => {
  const question = response.nextQuestion?.trim();
  const answer = response.answer.trim();
  if (!question) return response;
  const answerLower = answer.toLocaleLowerCase('en-US');
  const questionLower = question.toLocaleLowerCase('en-US');
  if (answerLower.endsWith(questionLower)) {
    const beforeQuestion = answer.slice(0, answer.length - question.length).trimEnd();
    return beforeQuestion.toLocaleLowerCase('en-US').endsWith(questionLower)
      ? { ...response, answer: beforeQuestion }
      : response;
  }
  return !answer.includes('?') && !answerLower.includes(questionLower)
    ? { ...response, answer: `${answer} ${question}` }
    : response;
};

export const conversationEngineV2Configured = (env: NodeJS.ProcessEnv = process.env): boolean => Boolean(
  env.PYTHON_MODEL_URL && /^https?:\/\//u.test(env.PYTHON_MODEL_URL) && env.MODEL_GATEWAY_SERVICE_KEY,
);

export const conversationEngineV2EnabledForTenant = (tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  if (!tenantId || env.CONVERSATION_ENGINE_V2_ENABLED === 'false' || !conversationEngineV2Configured(env)) return false;
  const tenants = new Set((env.CONVERSATION_ENGINE_V2_TENANTS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  return tenants.size === 0 || tenants.has(tenantId);
};

export const assertConversationEngineV2Configuration = (nodeEnv: string, env: NodeJS.ProcessEnv = process.env): void => {
  if (nodeEnv === 'production' && env.CONVERSATION_ENGINE_V2_ENABLED !== 'false' && !conversationEngineV2Configured(env)) {
    throw new Error('Production Conversation Engine v2 requires PYTHON_MODEL_URL and MODEL_GATEWAY_SERVICE_KEY, or an explicit CONVERSATION_ENGINE_V2_ENABLED=false rollback.');
  }
};

const sameEvidence = (left: V2ApprovedEvidence, right: V2ApprovedEvidence): boolean => left.citationId === right.citationId
  && left.text === right.text
  && left.sourceVersion === right.sourceVersion
  && left.approved === right.approved
  && left.revoked === right.revoked
  && left.sourceRef === right.sourceRef;

const evidenceFromTrustedToolTrace = (result: AgentTurnResultV2): V2ApprovedEvidence[] => result.approvedEvidence
  .filter((item) => result.toolTrace.some((trace) => trace.status === 'ok' && /^(?:get|search|read|list|lookup)_/u.test(trace.toolName) && trace.evidenceRefs.includes(item.citationId)))
  .map((item): V2ApprovedEvidence => ({ citationId: item.citationId, text: item.text, sourceVersion: item.sourceVersion, approved: true, revoked: false, sourceRef: item.sourceRef }));

const mergeEvidence = (requestEvidence: V2ApprovedEvidence[], result: AgentTurnResultV2): V2ApprovedEvidence[] => {
  const merged = new Map<string, V2ApprovedEvidence>();
  for (const item of requestEvidence) {
    const previous = merged.get(item.citationId);
    if (previous && !sameEvidence(previous, item)) throw new Error('V2_EVIDENCE_CONFLICT');
    merged.set(item.citationId, item);
  }
  for (const item of evidenceFromTrustedToolTrace(result)) {
    const existing = merged.get(item.citationId);
    if (existing && !sameEvidence(existing, item)) throw new Error('V2_EVIDENCE_CONFLICT');
    merged.set(item.citationId, item);
  }
  return [...merged.values()];
};

/** A deterministic no-evidence reply: acknowledge uncertainty and continue the dialogue,
 * without asking the model to invent factual claims or alter any journey/action state. */
const noEvidenceReply = (envelope: TurnEnvelopeV2, previousQuestionKey: string | null): PersonaComposedResponseV2 => {
  const message = envelope.customerMessageMasked.toLocaleLowerCase('en-US');
  const specificFactsRequested = /\b(?:price|pricing|cost|fees?|aed|eligib\w*|licen[cs]e|how long|timeline|policy|regulation|law|how much)\b/u.test(message);
  const goal = envelope.intentProjection.primaryGoalKey;
  const pending = envelope.intentProjection.pendingRequirementKey;
  const questionByRequirement: Record<string, string> = {
    business_activity: 'What business activity are you planning?',
    entity_type: 'What company structure are you considering?',
    visa_count: 'How many visas do you expect to need?',
    timeline: 'When are you hoping to get started?',
    business_structure: 'What company structure are you considering?',
    email: 'What email address should we use for this request?',
    phone: 'What phone number should we use for this request?',
    contact_consent: 'Please confirm that you consent to being contacted about this request.',
  };
  const questionByStage: Record<string, string> = {
    account_creation: 'Would you like me to prepare the Account creation request for this qualified journey?',
    package_selection: 'Would you like to review the approved package options for this journey?',
    document_upload: 'Please upload the required document for the confirmed package when you are ready.',
    billing_invoice: 'Your document stage is complete; payment and invoicing have not been started. What would you like to clarify next?',
    contract: 'The contract stage has not started. What would you like to clarify before that step?',
  };
  const repeated = Boolean(pending && pending === previousQuestionKey);
  const stage = envelope.intentProjection.currentStageKey ?? '';
  const questionKey = pending ?? (stage ? `stage:${stage}` : 'conversation_focus');
  const question = pending ? (questionByRequirement[pending] ?? 'Could you tell me more about that requirement?') : questionByStage[stage] ?? (goal ? 'Which part of your setup would you like to discuss first?' : 'What would you like help with?');
  const stageContext = stage === 'account_creation'
      ? /\bdocument\b/iu.test(message)
      ? 'Account creation is still the next verified step; document handling follows package confirmation.'
        : /\bpackage\b/iu.test(message)
          ? 'Account creation is still the next verified step; package selection follows provider evidence.'
        : /\b(?:visa|timeline|month)\b/iu.test(message)
          ? 'Your verified qualification facts remain in view while Account creation is still pending.'
        : /\b(?:change|keep|same|activity|structure)\b/iu.test(message)
          ? 'I’m keeping the same qualified request in view while Account creation remains pending.'
      : /\b(?:status|after|request|next)\b/iu.test(message)
        ? 'Your qualified request is preserved, and Account creation is the next verified step.'
          : null
    : stage === 'package_selection' && /\b(?:document|package|option|choice)\b/iu.test(message)
      ? 'The approved package choice must be confirmed before document collection can begin.'
      : null;
  const prefix = specificFactsRequested
    ? 'I don’t have a verified answer to that specific detail yet, so I don’t want to guess.'
    : stageContext ?? (repeated
      ? 'I’m keeping your company-formation request moving.'
      : 'I can help you work through that.');
  return {
    schemaVersion: 2,
    personaVersionId: envelope.personaVersionId,
    language: envelope.persona.permittedLanguages[0] ?? 'en',
    answer: question ? `${prefix} ${question}` : prefix,
    citationIds: [],
    nextQuestion: question,
    nextQuestionKey: questionKey,
    reasonNoQuestion: question ? null : 'awaiting_previous_requirement',
    decisionRef: `no-evidence-${envelope.requestId.slice(0, 80)}`,
  };
};

export class V2ConversationCoordinator {
  constructor(private readonly agent: V2ConversationAgent, private readonly groundingVerifier?: V2GroundingVerifier) {}

  async run(request: V2CoordinatorRequest): Promise<V2CoordinatorResult> {
    const envelope = turnEnvelopeSchema.parse(request.envelope);
    const rawResult = await this.agent.turn(envelope);
    const parsed = agentTurnResultSchema.safeParse(rawResult);
    if (!parsed.success) throw new Error('V2_MODEL_INVALID_RESPONSE');
    const agentResult = parsed.data;
    const candidateResponse = repairTrailingQuestionContract(repairAuthoritativeStagePlaceholder(addVerifiedFactCitations(agentResult.response, request.verifiedFacts ?? []), envelope.intentProjection.currentStageKey));
    const repairApplied = candidateResponse !== agentResult.response;
    const guardContext: V2ResponseGuardContext = {
      personaVersionId: envelope.personaVersionId,
      assistantName: envelope.persona.assistantName,
      permittedLanguages: envelope.persona.permittedLanguages,
      pendingRequirementKey: envelope.intentProjection.pendingRequirementKey,
      activeStageKey: envelope.intentProjection.currentStageKey,
      lastQuestionKey: request.lastQuestionKey ?? null,
      questionPolicy: request.questionPolicy ?? (envelope.intentProjection.pendingRequirementKey ? 'required' : 'optional'),
      evidence: mergeEvidence(request.evidence ?? [], agentResult),
      verifiedFacts: request.verifiedFacts ?? [],
      conversational: envelope.intentProjection.primaryGoalKey === null,
      fallbackTemplateVersion: envelope.persona.fallbackTemplateVersion,
      ...(request.fallbackTemplates ? { fallbackTemplates: request.fallbackTemplates } : {}),
    };
    const uncitedDialogueCandidate = Boolean(envelope.intentProjection.primaryGoalKey)
      && candidateResponse.citationIds.length === 0;
    let candidateGuardReason = 'not_evaluated';
    // The Python gateway can return an internally generated fallback on model/tool
    // failure. Never relabel that failure as a successful no-knowledge dialogue.
    if (candidateResponse.decisionRef.startsWith('fallback-') || agentResult.toolTrace.some((trace) => trace.status !== 'ok')) {
      candidateGuardReason = 'model_or_tool_unavailable';
      const unavailable = guardV2OfflineFallback('tool_unavailable', guardContext);
      if (!unavailable.verdict.accepted || !unavailable.response) throw new Error('V2_MODEL_OR_TOOL_UNAVAILABLE');
      return { response: unavailable.response, candidateResponse: agentResult.response, repairApplied, draft: toDraft(unavailable.response), toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [], claimProvenance: [],
        modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount, guardReason: 'model_or_tool_unavailable', candidateGuardReason, diagnosticCandidate: agentResult.diagnosticCandidate ?? null };
    }
    // For a repeated factual process question, an uncited generic reply such
    // as "What would you like to focus on next?" is not an acceptable answer.
    // Only use this branch when no public source evidence was retrieved.
    const asksForProcess = /\b(?:process|procedures?|steps?|how (?:do|can|to)|setting up|starting)\b/iu.test(envelope.customerMessageMasked)
      && /\b(?:company|business|free[\s-]?zone|formation|ajman|register|setup)\b/iu.test(envelope.customerMessageMasked);
    const knowledgeEvidenceAvailable = (guardContext.evidence ?? []).some(item =>
      item.sourceRef && !item.sourceRef.startsWith('tool-') && item.approved && !item.revoked);
    // Node's preflight already classified the question and retrieved public
    // knowledge. Do not reclassify it with a narrower process-only regex:
    // otherwise questions such as "How does incorporation work?" retrieve
    // sources but are ineligible for a grounded response repair.
    const hasTrustedPrefetch = (envelope.approvedKnowledge ?? []).some(item =>
      (request.evidence ?? []).some(approved =>
        approved.approved && !approved.revoked && approved.citationId === item.citationId
        && approved.sourceRef === item.sourceRef && approved.sourceVersion === item.sourceVersion
        && approved.text === item.text));
    if (asksForProcess && !envelope.intentProjection.pendingRequirementKey && !knowledgeEvidenceAvailable && candidateResponse.citationIds.length === 0) {
      const unavailableAnswer = 'I couldn’t find approved company-formation process guidance to verify the steps. Once the official setup guide is published in the knowledge base, I can explain the process without guessing.';
      const unavailableResponse: PersonaComposedResponseV2 = {
        schemaVersion: 2, personaVersionId: envelope.personaVersionId,
        language: envelope.persona.permittedLanguages[0] ?? 'en',
        answer: unavailableAnswer, citationIds: [], nextQuestion: null, nextQuestionKey: null,
        reasonNoQuestion: 'missing_knowledge', decisionRef: `missing-knowledge-${envelope.requestId.slice(0, 60)}`,
      };
      const safe = guardV2Response(unavailableResponse, { ...guardContext, questionPolicy: 'optional', approvedNoEvidenceAnswer: unavailableAnswer });
      if (safe.verdict.accepted) return {
        response: safe.response, candidateResponse: agentResult.response, repairApplied,
        draft: toDraft(safe.response), toolTrace: agentResult.toolTrace,
        approvedEvidence: guardContext.evidence ?? [], claimProvenance: [],
        modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount,
        guardReason: 'missing_approved_knowledge', candidateGuardReason: 'uncited_process_reply',
        diagnosticCandidate: agentResult.diagnosticCandidate ?? null,
      };
    }
    // Do not substitute a generic no-evidence question when verified public
    // knowledge is available for a factual process question. Evaluate and,
    // if necessary, repair the cited factual answer instead.
    if (uncitedDialogueCandidate && !hasTrustedPrefetch) {
      // A safe question and acknowledgement can be authored by the model without
      // RAG citations. Constrain the accepted text shape and forbid factual claims.
      const authored = guardV2Response(candidateResponse, { ...guardContext, allowNonFactualDialogue: true });
      candidateGuardReason = authored.verdict.reasonCode;
      if (authored.verdict.accepted) return {
        response: authored.response, candidateResponse: agentResult.response, repairApplied, draft: toDraft(authored.response), toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [], claimProvenance: authored.claims,
        modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount,
        guardReason: 'accepted_model_dialogue', candidateGuardReason, diagnosticCandidate: agentResult.diagnosticCandidate ?? null,
      };
      const natural = noEvidenceReply(envelope, request.lastQuestionKey ?? null);
      const safe = guardV2Response(natural, {
        ...guardContext,
        lastQuestionKey: null,
        questionPolicy: natural.nextQuestion ? guardContext.questionPolicy : 'optional',
        approvedNoEvidenceAnswer: natural.answer,
      });
      if (safe.verdict.accepted) return {
        response: safe.response, candidateResponse: agentResult.response, repairApplied, draft: toDraft(safe.response), toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [], claimProvenance: safe.claims,
        modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount,
        guardReason: 'safe_no_evidence_dialogue', candidateGuardReason, diagnosticCandidate: agentResult.diagnosticCandidate ?? null,
      };
    }
    const guarded = guardV2Response(candidateResponse, guardContext);
    candidateGuardReason = guarded.verdict.reasonCode;
    // Independent review is restricted to the exact public excerpts approved
    // and pinned by Node before the model turn. Other tool evidence cannot be
    // smuggled into this relaxed language path.
    const trustedReviewEvidence = (request.evidence ?? []).filter(approved =>
      approved.approved && !approved.revoked && (envelope.approvedKnowledge ?? []).some(item =>
        item.citationId === approved.citationId && item.sourceRef === approved.sourceRef
        && item.sourceVersion === approved.sourceVersion && item.text === approved.text));
    const reviewClaims = buildV2GroundingReviewClaims(candidateResponse, trustedReviewEvidence);
    const lexicalOverlap = v2MeanLexicalOverlapPercent(reviewClaims);
    if (guarded.verdict.accepted) return { response: guarded.response, candidateResponse: agentResult.response, repairApplied, draft: toDraft(guarded.response), toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [], claimProvenance: guarded.claims, modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount, guardReason: 'accepted', candidateGuardReason, groundingLexicalOverlapPercent: lexicalOverlap, diagnosticCandidate: agentResult.diagnosticCandidate ?? null };
    // An independent model reviewer can rescue a *lexical* false rejection only
    // after Node has authenticated the source versions, resolved exact citations
    // and rejected no business outcome. It may not authorize a stage transition.
    let groundingReviewStatus: NonNullable<V2CoordinatorResult['groundingReviewStatus']> = this.groundingVerifier ? 'not_eligible' : 'not_configured';
    let groundingReviewRequests = 0;
    const eligibleForEntailment = this.groundingVerifier && guarded.verdict.reasonCode === 'unsupported_claim'
      && guarded.firstFailure?.reason === 'single_source_support_not_established'
      && hasTrustedPrefetch && !hasPositiveBusinessOutcomeClaim(candidateResponse.answer)
      && reviewClaims.length > 0;
    if (eligibleForEntailment) {
      const remaining = Date.parse(envelope.budgets.deadlineAt) - Date.now();
      if (agentResult.modelRequestCount >= envelope.budgets.maxModelRequests || remaining < 3_500) {
        groundingReviewStatus = 'skipped_budget';
      } else {
        // Count this review pessimistically even if the HTTP call fails after dispatch.
        groundingReviewRequests = 1;
        try {
          const results = await this.groundingVerifier!.verify({
            requestId: envelope.requestId, deadlineAt: envelope.budgets.deadlineAt, claims: reviewClaims,
          });
          const proofs = proofsFromV2GroundingReview(reviewClaims, results);
          if (proofs) {
            const verified = guardV2Response(candidateResponse, { ...guardContext, groundingProofs: proofs });
            if (verified.verdict.accepted) return {
              response: verified.response, candidateResponse: agentResult.response,
              repairApplied, draft: toDraft(verified.response), toolTrace: agentResult.toolTrace,
              approvedEvidence: guardContext.evidence ?? [], claimProvenance: verified.claims,
              modelRequestCount: agentResult.modelRequestCount + groundingReviewRequests,
              toolCallCount: agentResult.toolCallCount, guardReason: 'accepted_entailment',
              candidateGuardReason, groundingReviewStatus: 'accepted',
              groundingLexicalOverlapPercent: lexicalOverlap, diagnosticCandidate: agentResult.diagnosticCandidate ?? null,
            };
          }
          groundingReviewStatus = 'rejected';
        } catch {
          groundingReviewStatus = 'error';
        }
      }
    }
    // A factual answer rejected for insufficient claim support can receive ONE
    // independent, read-only evidence repair. The failed draft is never returned.
    // All source identities must match the trusted Node prefetch (not untrusted
    // model/tool claims); the second model pass has no callable tools or actions.
    let repairModelRequests = 0;
    let knowledgeRepairStatus: NonNullable<V2CoordinatorResult['knowledgeRepairStatus']> = 'not_eligible';
    let repairCitationCount: number | null = null;
    let repairFailureReason: string | null = null;
    let repairClaimFailureReason: string | null = null;
    let repairFailedClauseOrdinal: number | null = null;
    const timeLeft = Date.parse(envelope.budgets.deadlineAt) - Date.now();
    if (guarded.verdict.reasonCode === 'unsupported_claim'
      && (envelope.approvedKnowledge?.length ?? 0) > 0) {
      if (!hasTrustedPrefetch) {
        knowledgeRepairStatus = 'skipped_untrusted_evidence';
      } else if (agentResult.modelRequestCount + groundingReviewRequests >= envelope.budgets.maxModelRequests || timeLeft < 2_500) {
        knowledgeRepairStatus = 'skipped_budget';
      } else {
        // The original answer is already rejected. We can safely repair even
        // if it asserted a completed business action, because that assertion
        // is never returned and the second answer must pass the same guard.
        knowledgeRepairStatus = 'attempted_invalid_result';
        repairFailureReason = 'repair_invalid_model_result_or_budget';
        try {
          const repairEnvelope = turnEnvelopeSchema.parse({
            ...envelope,
            knowledgeRepair: { reason: 'unsupported_claim', strategy: 'source_close' },
            toolAllowlist: [],
            budgets: { ...envelope.budgets, maxModelRequests: 1, maxToolCalls: 0, maxToolRounds: 0 },
          });
          const candidateRepair = agentTurnResultSchema.safeParse(await this.agent.turn(repairEnvelope));
          if (candidateRepair.success && candidateRepair.data.modelRequestCount === 1
            && candidateRepair.data.toolCallCount === 0 && candidateRepair.data.toolTrace.length === 0) {
            repairModelRequests = 1;
            const repaired = repairTrailingQuestionContract(repairAuthoritativeStagePlaceholder(
              addVerifiedFactCitations(candidateRepair.data.response, request.verifiedFacts ?? []),
              envelope.intentProjection.currentStageKey,
            ));
            // Do not carry model-authored business goal, stage or action plans
            // across a factual knowledge repair.
            const groundedRepair: PersonaComposedResponseV2 = { ...repaired, planning: null };
            knowledgeRepairStatus = 'attempted_rejected';
            repairCitationCount = groundedRepair.citationIds.length;
            if (repairCitationCount === 0) repairFailureReason = 'repair_missing_citations';
            else if (groundedRepair.decisionRef.startsWith('fallback-')) repairFailureReason = 'repair_gateway_fallback';
            else if (hasPositiveBusinessOutcomeClaim(groundedRepair.answer)) repairFailureReason = 'repair_unverified_business_outcome';
            else {
              const verifiedRepair = guardV2Response(groundedRepair, guardContext);
              if (!verifiedRepair.verdict.accepted) {
                repairFailureReason = 'repair_guard_' + verifiedRepair.verdict.reasonCode;
                repairClaimFailureReason = verifiedRepair.firstFailure?.reason ?? null;
                repairFailedClauseOrdinal = verifiedRepair.firstFailure?.clauseOrdinal ?? null;
              }
              if (verifiedRepair.verdict.accepted && verifiedRepair.response) return {
                response: verifiedRepair.response, candidateResponse: agentResult.response,
                repairApplied: true, draft: toDraft(verifiedRepair.response),
                toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [],
                claimProvenance: verifiedRepair.claims,
                modelRequestCount: agentResult.modelRequestCount + 1,
                toolCallCount: agentResult.toolCallCount,
                guardReason: 'accepted_knowledge_repair', candidateGuardReason,
                knowledgeRepairStatus: 'accepted',
                repairCitationCount, repairFailureReason: null,
                initialClaimFailureReason: guarded.firstFailure?.reason ?? null,
                initialFailedClauseOrdinal: guarded.firstFailure?.clauseOrdinal ?? null,
                diagnosticCandidate: agentResult.diagnosticCandidate ?? null,
              };
            }
          }
        } catch {
          // A second-pass error must never release the rejected original draft.
          knowledgeRepairStatus = 'attempted_error';
          repairFailureReason = 'repair_execution_error';
        }
      }
    }
    // A missing RAG source must not block conversation. Never use this path when
    // evidence exists, citations are invalid, or the model/tool failed.
    const unverifiedActionOutcome = hasPositiveBusinessOutcomeClaim(candidateResponse.answer);
    if (['unsupported_claim', 'invalid_question'].includes(guarded.verdict.reasonCode)
      && !unverifiedActionOutcome
      && candidateResponse.citationIds.length === 0
      && (request.evidence?.length ?? 0) === 0
      && !agentResult.response.decisionRef.startsWith('fallback-')) {
      const natural = noEvidenceReply(envelope, request.lastQuestionKey ?? null);
      const safe = guardV2Response(natural, {
        ...guardContext,
        // This is a server-authored recovery question for an unanswered requirement;
        // the model's repeated question is not allowed through this path.
        lastQuestionKey: null,
        questionPolicy: natural.nextQuestion ? guardContext.questionPolicy : 'optional',
        approvedNoEvidenceAnswer: natural.answer,
      });
      if (safe.verdict.accepted) return {
        response: safe.response, candidateResponse: agentResult.response, repairApplied, draft: toDraft(safe.response), toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [], claimProvenance: safe.claims,
        modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount,
        guardReason: 'safe_no_evidence_dialogue', candidateGuardReason, diagnosticCandidate: agentResult.diagnosticCandidate ?? null,
      };
    }
    const fallback = guardV2OfflineFallback(fallbackFamilyFor(guarded.verdict.reasonCode), guardContext);
    if (!fallback.verdict.accepted || !fallback.response) throw new Error('V2_RESPONSE_REJECTED');
    return { response: fallback.response, candidateResponse: agentResult.response, repairApplied, draft: toDraft(fallback.response), toolTrace: agentResult.toolTrace, approvedEvidence: guardContext.evidence ?? [], claimProvenance: [], modelRequestCount: agentResult.modelRequestCount + repairModelRequests + groundingReviewRequests, toolCallCount: agentResult.toolCallCount, guardReason: guarded.verdict.reasonCode, candidateGuardReason, knowledgeRepairStatus, groundingReviewStatus, groundingLexicalOverlapPercent: lexicalOverlap,
      initialClaimFailureReason: guarded.firstFailure?.reason ?? null,
      initialFailedClauseOrdinal: guarded.firstFailure?.clauseOrdinal ?? null,
      repairCitationCount, repairFailureReason, repairClaimFailureReason, repairFailedClauseOrdinal,
      diagnosticCandidate: agentResult.diagnosticCandidate ?? null };
  }
}

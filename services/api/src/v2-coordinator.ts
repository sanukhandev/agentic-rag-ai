import { agentTurnResultSchema, turnEnvelopeSchema, type AgentTurnResultV2, type PersonaComposedResponseV2, type TurnEnvelopeV2 } from './python-model/v2-contracts.js';
import { guardV2OfflineFallback, guardV2Response, type V2ResponseGuardContext } from './v2-response-guard.js';
import type { ModelDraft } from './model.js';
import type { V2ApprovedEvidence, V2VerifiedFact } from './v2-evidence.js';
import type { V2ApprovedFallbackTemplateSet, V2FallbackFamily } from './v2-fallbacks.js';

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
  draft: ModelDraft;
  toolTrace: AgentTurnResultV2['toolTrace'];
  modelRequestCount: number;
  toolCallCount: number;
  guardReason: string;
}

const fallbackFamilyFor = (reason: string): V2FallbackFamily => reason === 'stale_state' ? 'reconciliation' : reason === 'invalid_citation' || reason === 'unsupported_claim' || reason === 'metadata_leak' || reason === 'persona_mismatch' ? 'invalid_model' : 'tool_unavailable';
const toDraft = (response: PersonaComposedResponseV2): ModelDraft => ({ answer: response.answer, citationIds: response.citationIds, proposedIntent: null });

export const conversationEngineV2EnabledForTenant = (tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env.CONVERSATION_ENGINE_V2_ENABLED === 'false' || !tenantId) return false;
  const tenants = new Set((env.CONVERSATION_ENGINE_V2_TENANTS ?? '').split(',').map(value => value.trim()).filter(Boolean));
  // Blank allowlist means enabled by default; a populated allowlist scopes rollout to named tenants.
  return tenants.size === 0 || tenants.has(tenantId);
};

/** A deterministic no-evidence reply: acknowledge uncertainty and continue the dialogue,
 * without asking the model to invent factual claims or alter any journey/action state. */
const noEvidenceReply = (envelope: TurnEnvelopeV2, previousQuestionKey: string | null): PersonaComposedResponseV2 => {
  const message = envelope.customerMessageMasked.toLocaleLowerCase('en-US');
  const specificFactsRequested = /\b(?:price|pricing|cost|fees?|aed|visa|eligib|licen[cs]e|requirement|documents?|how long|timeline|policy|regulation|law)\b/u.test(message);
  const goal = envelope.intentProjection.primaryGoalKey;
  const pending = envelope.intentProjection.pendingRequirementKey;
  const questionByRequirement: Record<string, string> = {
    business_activity: 'What business activity are you planning?',
    entity_type: 'What company structure are you considering?',
    visa_count: 'How many visas do you expect to need?',
    timeline: 'When are you hoping to get started?',
    business_structure: 'What company structure are you considering?',
  };
  const repeated = Boolean(pending && pending === previousQuestionKey);
  const questionKey = repeated ? null : pending ?? 'conversation_focus';
  const question = repeated ? null : pending ? (questionByRequirement[pending] ?? 'Could you tell me more about that requirement?') : goal ? 'Which part of your setup would you like to discuss first?' : 'What would you like help with?';
  const prefix = specificFactsRequested
    ? 'I don’t have a verified answer to that specific detail yet, so I don’t want to guess.'
    : 'I can help you work through that.';
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
  constructor(private readonly agent: V2ConversationAgent) {}

  async run(request: V2CoordinatorRequest): Promise<V2CoordinatorResult> {
    const envelope = turnEnvelopeSchema.parse(request.envelope);
    const rawResult = await this.agent.turn(envelope);
    const parsed = agentTurnResultSchema.safeParse(rawResult);
    if (!parsed.success) throw new Error('V2_MODEL_INVALID_RESPONSE');
    const agentResult = parsed.data;
    const guardContext: V2ResponseGuardContext = {
      personaVersionId: envelope.personaVersionId,
      permittedLanguages: envelope.persona.permittedLanguages,
      pendingRequirementKey: envelope.intentProjection.pendingRequirementKey,
      lastQuestionKey: request.lastQuestionKey ?? null,
      questionPolicy: request.questionPolicy ?? (envelope.intentProjection.pendingRequirementKey ? 'required' : 'optional'),
      evidence: request.evidence ?? [],
      verifiedFacts: request.verifiedFacts ?? [],
      conversational: envelope.intentProjection.primaryGoalKey === null,
      fallbackTemplateVersion: envelope.persona.fallbackTemplateVersion,
      ...(request.fallbackTemplates ? { fallbackTemplates: request.fallbackTemplates } : {}),
    };
    const guarded = guardV2Response(agentResult.response, guardContext);
    if (guarded.verdict.accepted) return { response: guarded.response, draft: toDraft(guarded.response), toolTrace: agentResult.toolTrace, modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount, guardReason: 'accepted' };
    // A missing RAG source must not block conversation. Never use this path when
    // evidence exists, citations are invalid, or the model/tool failed.
    if (guarded.verdict.reasonCode === 'unsupported_claim'
      && agentResult.response.citationIds.length === 0
      && (request.evidence?.length ?? 0) === 0
      && !agentResult.response.decisionRef.startsWith('fallback-')) {
      const natural = noEvidenceReply(envelope, request.lastQuestionKey ?? null);
      const safe = guardV2Response(natural, {
        ...guardContext,
        questionPolicy: natural.nextQuestion ? guardContext.questionPolicy : 'optional',
        approvedNoEvidenceAnswer: natural.answer,
      });
      if (safe.verdict.accepted) return {
        response: safe.response, draft: toDraft(safe.response), toolTrace: agentResult.toolTrace,
        modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount,
        guardReason: 'safe_no_evidence_dialogue',
      };
    }
    const fallback = guardV2OfflineFallback(fallbackFamilyFor(guarded.verdict.reasonCode), guardContext);
    if (!fallback.verdict.accepted || !fallback.response) throw new Error('V2_RESPONSE_REJECTED');
    return { response: fallback.response, draft: toDraft(fallback.response), toolTrace: agentResult.toolTrace, modelRequestCount: agentResult.modelRequestCount, toolCallCount: agentResult.toolCallCount, guardReason: guarded.verdict.reasonCode };
  }
}

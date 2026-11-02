import { createHash, randomUUID } from 'node:crypto';
import { cacheKey, type CacheStore } from './cache.js';
import { classifyScopedGoalDecision, newConversationState, prompt } from './conversation-state.js';
import { validatePublishedCatalogV2 } from './catalog-v2-runtime.js';
import { validateV2PlanningProposal } from './v2-planning.js';
import { validateQuotedV2CustomerFacts } from './v2-customer-fact-provenance.js';
import { HttpError } from './http/errors.js';
import { assertKnownTokens, maskPiiForSession, rehydrateForSession, TokenVault } from './privacy.js';
import { issueV2Scope, V2_TOOL_NAMES } from './v2-tool-gateway.js';
import { assertSafeUserIntentDocument, assertSafeIntentTurn } from './user-intent-document.js';
import { type V2ConversationCoordinator, type V2CoordinatorRequest, type V2CoordinatorResult } from './v2-coordinator.js';
import type { V2ApprovedEvidence, V2VerifiedFact } from './v2-evidence.js';
import type { V2ApprovedFallbackTemplateSet } from './v2-fallbacks.js';
import type { Citation, GoalConfirmationRecord, Message, PersonaVersion, Session, Store, Tenant, UserIntentDocument, UserIntentFact } from './types.js';

/** A single guarded model turn. Never invokes the legacy planner or creates an action. */
export const executeV2Turn = async (
  coordinator: Pick<V2ConversationCoordinator, 'run'>,
  request: V2CoordinatorRequest,
): Promise<V2CoordinatorResult> => {
  const result = await coordinator.run(request);
  const budget = request.envelope.budgets;
  if (!Number.isSafeInteger(result.modelRequestCount)
      || !Number.isSafeInteger(result.toolCallCount)
      || result.modelRequestCount < 0 || result.toolCallCount < 0
      || result.modelRequestCount > budget.maxModelRequests
      || result.toolCallCount > budget.maxToolCalls) {
    throw new Error('V2_TURN_BUDGET_EXCEEDED');
  }
  if (new Set(result.response.citationIds).size !== result.response.citationIds.length) {
    throw new Error('V2_DUPLICATE_CITATIONS');
  }
  return result;
};

export interface GPTFirstTurnInput {
  store: Store;
  cache: CacheStore;
  tokenVault: TokenVault;
  session: Session;
  tenant: Tenant;
  userMessage: Message;
  clientMessageId: string;
  messageHash: string;
  maskedMessage: string;
  requestId: string;
  responseCacheTtlSeconds: number;
  coordinator: Pick<V2ConversationCoordinator, 'run'>;
  scopeSecret: string;
  updateSession: (session: Session) => Promise<Session>;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const safeFactValue = (value: string | undefined, max: number): string | undefined =>
  value && value.trim().length <= max && !/[\r\n<>@]/u.test(value) && !/https?:\/\//iu.test(value)
    && !/\+?\d[\d()\s-]{7,}/u.test(value) ? value.trim() : undefined;

const fallbackTemplates = (persona: PersonaVersion): V2ApprovedFallbackTemplateSet => ({
  approved: true, personaVersionId: persona.id, templateVersion: 'fallback-' + persona.id,
  language: persona.permittedLanguages[0] ?? 'en',
  templates: {
    invalid_model: 'I cannot verify that answer safely. I can continue with confirmed information.',
    tool_unavailable: 'The approved information is temporarily unavailable.',
    reconciliation: 'I need to verify the request status before I confirm the outcome.',
  },
});

const trustedFacts = (values: Record<string, string>, catalogVersionId: string): { facts: NonNullable<V2CoordinatorRequest['envelope']['intentProjection']['confirmedCustomerFacts']>; evidence: V2VerifiedFact[] } => {
  const facts: NonNullable<V2CoordinatorRequest['envelope']['intentProjection']['confirmedCustomerFacts']> = {};
  const evidence: V2VerifiedFact[] = [];
  for (const [key, max] of Object.entries({ business_activity: 180, entity_type: 80, visa_count: 12, timeline: 100 }) as Array<[keyof typeof facts, number]>) {
    const value = safeFactValue(values[key], max);
    if (!value) continue;
    facts[key] = value;
    evidence.push({ factId: 'customer-fact-' + key, text: 'The customer provided ' + key.replace(/_/gu, ' ') + ' as ' + value + '.', sourceVersion: catalogVersionId, verified: true });
  }
  return { facts, evidence };
};

const resolvePublicCitations = async (store: Store, tenantId: string, ids: string[], evidence: V2ApprovedEvidence[]): Promise<Citation[]> => {
  const byId = new Map(evidence.map(item => [item.citationId, item]));
  const citations: Citation[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || !item.approved || item.revoked || !item.sourceRef) continue;
    const source = await store.getSource(item.sourceRef);
    if (!source || source.tenantId !== tenantId || source.status !== 'active' || source.versionId !== item.sourceVersion) continue;
    citations.push({ sourceId: source.id, versionId: source.versionId, chunkId: id, title: source.title, locator: id });
  }
  return citations;
};

const factPatch = (facts: Record<string, string>, sequence: number): Record<string, UserIntentFact> => Object.fromEntries(
  Object.entries(facts).map(([key, maskedValue]) => [key, {
    maskedValue, source: 'node' as const, messageSequence: sequence, evidenceRefs: ['customer-fact-' + key], corrected: false,
  }]),
);

/** Called after HTTP authentication and durable message-idempotency checks. */
export const runGPTFirstChatTurn = async (input: GPTFirstTurnInput) => {
  const { store, session, tenant, userMessage, coordinator, maskedMessage } = input;
  if (session.tenantId !== tenant.id || userMessage.sessionId !== session.id || userMessage.tenantId !== tenant.id) {
    throw new HttpError(403, 'V2_TENANT_SCOPE_DENIED', 'Conversation scope does not match.');
  }
  if (!session.personaVersionId) throw new HttpError(409, 'V2_PERSONA_NOT_PINNED', 'A published persona must be pinned to this session.');
  const persona = await store.getPersonaVersion(tenant.id, session.personaVersionId);
  if (!persona || persona.status !== 'published') throw new HttpError(409, 'V2_PERSONA_UNAVAILABLE', 'The pinned persona is not available.');
  if (userMessage.response || (await store.listIntentTurns(tenant.id, session.id))
    .some(turn => turn.clientMessageId === input.clientMessageId)) {
    throw new HttpError(409, 'V2_TURN_REPLAY', 'This customer message has already been assessed.');
  }
  const originalState = session.conversationState ?? newConversationState();
  const catalog = originalState.catalogVersionId
    ? await store.getIntentCatalogVersion(tenant.id, originalState.catalogVersionId)
    : await store.getPublishedIntentCatalog(tenant.id);
  if (!catalog || catalog.status !== 'published') throw new HttpError(409, 'V2_CATALOG_UNAVAILABLE', 'The pinned published catalog is required for authorized tools.');
  // Pin before issuing any read-tool scope. New sessions otherwise have a null
  // catalog ID in the Store, and the first model-selected tool is rejected.
  if (!originalState.catalogVersionId) {
    session.conversationState = { ...originalState, catalogVersionId: catalog.id };
    await input.updateSession(session);
    if (session.conversationState?.catalogVersionId !== catalog.id) {
      throw new HttpError(409, 'V2_CATALOG_PIN_CONFLICT', 'The published catalog changed while starting this turn.');
    }
  }
  const intentDocument = await store.getUserIntentDocument(tenant.id, session.id);
  if (intentDocument && (intentDocument.personaVersionId !== persona.id || intentDocument.tenantId !== tenant.id || intentDocument.sessionId !== session.id)) {
    throw new HttpError(409, 'V2_PINNED_CONTEXT_STALE', 'The session intent document does not match its trusted context.');
  }
  // Canonical Catalog V2 publication is independent of the V1 catalog used by
  // rollback tools. Never auto-promote a legacy intent document or reuse its consent.
  const publishedV2 = (await store.listIntentCatalogV2Versions(tenant.id))
    .find(version => version.status === 'published') ?? null;
  const v2Version = intentDocument?.catalogSource === 'v2'
    ? (publishedV2?.catalogVersionRef === intentDocument.catalogVersionRef ? publishedV2 : null)
    : !intentDocument ? publishedV2 : null;
  if (intentDocument?.catalogSource === 'v2' && !v2Version) {
    throw new HttpError(409, 'V2_CATALOG_PIN_STALE', 'The pinned V2 catalog is no longer published.');
  }
  const validatedV2 = v2Version ? validatePublishedCatalogV2(v2Version.catalog, {
    published: v2Version.status === 'published',
    tenantScope: tenant.slug, pinnedVersionRef: v2Version.catalogVersionRef,
  }) : null;
  if (v2Version && (!validatedV2?.ok || !validatedV2.catalog)) {
    throw new HttpError(409, 'V2_CATALOG_INVALID', 'The published V2 catalog cannot be validated.');
  }
  const catalogV2 = validatedV2?.catalog ?? null;
  const activeGoal = (intentDocument?.catalogSource === 'v2' ? intentDocument.businessGoalKey : null)
    ?? originalState.activeFollowUpIntentKey ?? originalState.intentProgress?.activeIntentKey
    ?? originalState.selectedIntentKey ?? intentDocument?.businessGoalKey ?? null;
  const entry = activeGoal ? originalState.intentProgress?.entries[activeGoal] : null;
  const opportunityId = entry?.journeyId ?? intentDocument?.opportunityId ?? null;
  const pendingRequirement = originalState.pendingPrompt?.requirementKey ?? entry?.currentRequirementKey ?? intentDocument?.pendingRequirementKey ?? null;
  const documentFacts = intentDocument ? Object.fromEntries(Object.entries(intentDocument.verifiedFacts)
    .filter(([, item]) => item.source === 'node' || item.source === 'visitor')
    .map(([key, item]) => [key, item.maskedValue])) : {};
  const { facts, evidence } = trustedFacts({ ...documentFacts, ...originalState.slotValues, ...(entry?.slotValues ?? {}) }, catalog.id);
  const sessionRevision = session.stateVersion ?? 0;
  const history = (await store.listMessages(session.id, tenant.id, 12)).filter(msg => msg.id !== userMessage.id).slice(-8)
    .map(msg => ({ role: msg.role === 'user' ? 'customer' as const : 'assistant' as const, content: msg.maskedContent.slice(0, 2_000) }));
  const scopeRef = issueV2Scope({
    tenantId: tenant.id, sessionId: session.id, opportunityId, catalogVersionId: catalog.id,
    personaVersionId: persona.id, stateRevision: sessionRevision, toolAllowlist: [...V2_TOOL_NAMES],
  }, input.scopeSecret);
  const envelope: V2CoordinatorRequest['envelope'] = {
    schemaVersion: 2, requestId: input.requestId, clientMessageId: input.clientMessageId, scopeRef,
    sessionRevision, intentRevision: originalState.intentProgress?.journeyRevision ?? 0,
    catalogVersionId: catalog.id, personaVersionId: persona.id, customerMessageMasked: maskedMessage.slice(0, 5_000),
    latestTurns: history, catalogDigest: hash(JSON.stringify(catalog.catalog)),
    ...(catalogV2 && v2Version ? { catalogV2: {
      versionRef: v2Version.catalogVersionRef,
      businessGoals: catalogV2.sheets.BusinessGoals.filter(goal => goal.active)
        .map(goal => ({ key: goal.businessGoalKey, name: goal.name.slice(0, 120), confirmationRequired: goal.confirmationRequired })),
      turnIntents: catalogV2.sheets.TurnIntents.filter(turn => turn.active)
        .map(turn => ({ key: turn.turnIntentKey, categoryKey: turn.categoryKey, businessGoalKey: turn.businessGoalKey })),
      signals: catalogV2.sheets.IntentSignals
        .map(signal => ({ signalId: signal.signalId, targetKey: signal.targetKey, value: signal.value })),
      requirementKeys: catalogV2.sheets.RequirementPolicies.filter(req => req.required).map(req => req.requirementKey),
      enabledReadToolKeys: catalogV2.sheets.ToolBindings.filter(tool => tool.enabled && tool.sideEffectClass === 'read_only')
        .map(tool => tool.toolKey).slice(0, 32),
    } } : {}),
    persona: { personaVersionId: persona.id, assistantName: persona.name, assistantRole: 'AI assistant',
      permittedLanguages: persona.permittedLanguages,
      tone: persona.tone.split(/[,;]+/u).map(x => x.trim()).filter(Boolean).slice(0, 12),
      speakingStyle: persona.speakingStyle, fallbackTemplateVersion: 'fallback-' + persona.id },
    intentProjection: { primaryGoalKey: activeGoal, goalConfirmed: intentDocument?.catalogSource === 'v2' ? intentDocument.goalConfirmed : Boolean(originalState.selectedIntentKey || intentDocument?.goalConfirmed),
      currentStageKey: entry?.lifecycle?.currentStage ?? null, pendingRequirementKey: pendingRequirement, confirmedCustomerFacts: facts },
    toolAllowlist: [...V2_TOOL_NAMES],
    budgets: { maxModelRequests: 4, maxToolCalls: 4, maxToolRounds: 2, deadlineAt: new Date(Date.now() + 90_000).toISOString() },
  };
  const result = await executeV2Turn(coordinator, {
    envelope, verifiedFacts: evidence, lastQuestionKey: originalState.pendingPrompt?.requirementKey ?? null,
    questionPolicy: 'optional', fallbackTemplates: fallbackTemplates(persona),
  });
  if (result.toolTrace.some(trace => trace.status === 'stale_state')) throw new HttpError(409, 'V2_STALE_TOOL_STATE', 'The conversation state changed; retry this message.');
  const current = await store.getSession(session.id);
  if (!current || current.tenantId !== tenant.id || (current.stateVersion ?? 0) !== sessionRevision) {
    throw new HttpError(409, 'V2_STALE_SESSION', 'The conversation changed while the model was reasoning.');
  }

  // Model planning is advisory until checked against the exact canonical,
  // published V2 catalog. Never accept a fabricated signal as score evidence.
  const modelPlan = result.guardReason === 'accepted' || result.guardReason === 'accepted_model_dialogue'
    ? result.response.planning ?? null : null;
  const existingConfirmedGoal = intentDocument?.catalogSource === 'v2' && intentDocument.goalConfirmed
    ? intentDocument.businessGoalKey : null;
  const planningDecision = modelPlan && catalogV2 ? validateV2PlanningProposal(modelPlan, catalogV2, {
    confirmedGoalKey: existingConfirmedGoal, currentStageKey: intentDocument?.catalogSource === 'v2'
      ? intentDocument.currentStageKey : null,
    verifiedRequirementKeys: Object.keys(intentDocument?.catalogSource === 'v2' ? intentDocument.verifiedFacts : facts),
    goalConfirmed: Boolean(existingConfirmedGoal),
    allowedToolKeys: catalogV2.sheets.ToolBindings.filter(tool => tool.enabled && tool.sideEffectClass === 'read_only')
      .map(tool => tool.toolKey),
    observedText: maskedMessage,
  }) : null;
  // Only validated proposals and independently observed signals influence
  // the candidate goal. High model confidence never confirms a goal.
  const validPlan = Boolean(planningDecision?.accepted);
  const selectedV2Goal = existingConfirmedGoal ?? (validPlan && planningDecision?.score?.thresholdMet
    && !planningDecision.score.ambiguous ? planningDecision.primaryGoalKey
    : intentDocument?.catalogSource === 'v2' ? intentDocument.businessGoalKey : null);
  const selectedTurnCategory = validPlan ? planningDecision?.proposal?.turnCategory ?? null : null;
  // The model may propose a goal, but only Node may interpret a customer
  // decision against the already persisted prompt and its optimistic cursor.
  const previousDecision = intentDocument?.catalogSource === 'v2' ? intentDocument.goalConfirmation ?? null : null;
  const pendingDecision = previousDecision?.status === 'pending' ? previousDecision : null;
  if (pendingDecision) {
    const requiredGoal = catalogV2?.sheets.BusinessGoals.find(goal =>
      goal.active && goal.confirmationRequired && goal.businessGoalKey === pendingDecision.goalKey);
    if (!requiredGoal || !intentDocument || intentDocument.businessGoalKey !== pendingDecision.goalKey
      || pendingDecision.catalogVersionRef !== v2Version?.catalogVersionRef
      || pendingDecision.personaVersionId !== persona.id
      || pendingDecision.sessionRevision !== sessionRevision
      || pendingDecision.intentRevision !== intentDocument.revision
      || pendingDecision.proposalMessageId === userMessage.id) {
      throw new HttpError(409, 'V2_GOAL_CONFIRMATION_STALE', 'The goal confirmation prompt is no longer current.');
    }
  }
  const decision = pendingDecision ? classifyScopedGoalDecision(maskedMessage) : null;
  const selectedTurnIntent = validPlan && selectedV2Goal && selectedTurnCategory && catalogV2
    ? catalogV2.sheets.TurnIntents.find(turn =>
        turn.active && turn.businessGoalKey === selectedV2Goal && turn.categoryKey === selectedTurnCategory)?.turnIntentKey ?? null
    : null;
  const selectedRequirement = validPlan && selectedV2Goal && planningDecision?.score?.thresholdMet
    ? planningDecision.nextRequirementKey : null;
  const catalogSignalRefs = validPlan ? (planningDecision?.proposal?.matchedSignalIds ?? [])
    .map(signal => 'catalog-signal:' + signal) : [];
  // Publication can change during a model/tool turn. Fail closed rather than
  // attributing a new decision to a no-longer-published version.
  if (v2Version) {
    const stillPublished = await store.getIntentCatalogV2Version(tenant.id, v2Version.id);
    if (!stillPublished || stillPublished.status !== 'published' || stillPublished.catalogVersionRef !== v2Version.catalogVersionRef) {
      throw new HttpError(409, 'V2_CATALOG_PIN_STALE', 'The V2 catalog publication changed during the turn.');
    }
  }
  const modelCitations = await resolvePublicCitations(store, tenant.id, result.response.citationIds, result.approvedEvidence ?? []);
  const responseId = randomUUID();
  // A model-authored next-question key can become durable only when it refers
  // to an existing, required slot in the active, pinned catalog. The model
  // cannot create consent, document, confirmation or stage transitions.
  const nextKey = result.response.nextQuestionKey;
  const proposedRequirement = !originalState.pendingPrompt && activeGoal && nextKey && !catalogV2
    ? catalog.catalog.journeyRequirements?.find(candidate =>
        candidate.intentKey === activeGoal && candidate.requirementKey === nextKey
        && candidate.required && candidate.requirementType === 'slot'
        && !entry?.completedRequirementKeys.includes(candidate.requirementKey))
    : null;
  // V2 requirements are kept in the authoritative intent document; they
  // cannot create a legacy action or stage transition by themselves.
  const nextPendingPrompt = originalState.pendingPrompt ?? (
    proposedRequirement && activeGoal
      ? prompt('slot', activeGoal, proposedRequirement.slotKey, proposedRequirement.requirementKey)
      : null);
  const effectivePendingRequirement = nextPendingPrompt?.requirementKey ?? selectedRequirement ?? pendingRequirement;
  const state = { ...originalState, catalogVersionId: catalog.id, pendingPrompt: nextPendingPrompt,
    rollingSummary: (originalState.rollingSummary + '\nCustomer: ' + maskedMessage.slice(0, 1_000)).trim().slice(-4_000),
    messageSequence: originalState.messageSequence + 1, summaryRevision: originalState.summaryRevision + 1,
    lastTurnAt: userMessage.createdAt };
  session.conversationState = state;
  const at = new Date().toISOString();
  const requirementGoal = catalogV2?.sheets.BusinessGoals.find(goal => goal.active
    && goal.businessGoalKey === selectedV2Goal) ?? null;
  // Advisory/knowledge-only turns cannot activate a business journey. A new
  // prompt must be tied to observed, validated business-goal planning.
  const shouldPrompt = Boolean(catalogV2 && requirementGoal?.confirmationRequired
    && validPlan && selectedTurnCategory === 'business_goal'
    && planningDecision?.score?.thresholdMet && !planningDecision.score.ambiguous
    && !intentDocument?.goalConfirmed && !pendingDecision && !decision
    && modelPlan?.nextMove === 'confirm_goal');
  let goalConfirmation: GoalConfirmationRecord | null = previousDecision;
  let goalConfirmed = Boolean(intentDocument?.goalConfirmed);
  let nextGoalKey = intentDocument?.goalConfirmed ? intentDocument.businessGoalKey : selectedV2Goal;
  let effectiveAnswer = result.response.answer;
  let effectiveQuestion = result.response.nextQuestion;
  let overrideResponse = false;
  if (pendingDecision) {
    const goalName = catalogV2?.sheets.BusinessGoals.find(goal => goal.businessGoalKey === pendingDecision.goalKey)?.name ?? 'this service';
    if (decision === 'confirmed') {
      goalConfirmed = true;
      nextGoalKey = pendingDecision.goalKey;
      goalConfirmation = { ...pendingDecision, status: 'confirmed', customerMessageId: userMessage.id,
        customerClientMessageId: input.clientMessageId, decidedAt: at,
        decisionSessionRevision: sessionRevision, decisionIntentRevision: intentDocument?.revision };
      effectiveAnswer = 'Understood. We can focus on ' + goalName.toLowerCase() + '. What would you like to discuss first?';
      effectiveQuestion = 'What would you like to discuss first?';
      overrideResponse = true;
    } else if (decision === 'rejected' || decision === 'corrected') {
      goalConfirmed = false;
      nextGoalKey = null;
      goalConfirmation = { ...pendingDecision, status: decision, customerMessageId: userMessage.id,
        customerClientMessageId: input.clientMessageId, decidedAt: at,
        decisionSessionRevision: sessionRevision, decisionIntentRevision: intentDocument?.revision };
      effectiveAnswer = decision === 'rejected'
        ? 'Understood. I will keep this informational. What would you like to know?'
        : 'Which service would you like to explore instead?';
      effectiveQuestion = decision === 'rejected' ? 'What would you like to know?' : 'Which service would you like to explore instead?';
      overrideResponse = true;
    } else {
      // Interruption: answer the knowledge question without consuming the
      // original prompt. Ambiguity: ask exactly one scoped clarification.
      goalConfirmation = { ...pendingDecision, sessionRevision: sessionRevision + 1,
        intentRevision: (intentDocument?.revision ?? 0) + 1 };
      nextGoalKey = pendingDecision.goalKey;
      if (decision === 'ambiguous') {
        effectiveAnswer = 'Would you like to proceed with ' + goalName.toLowerCase() + ', or only explore information?';
        effectiveQuestion = effectiveAnswer;
        overrideResponse = true;
      }
    }
  } else if (shouldPrompt && requirementGoal && selectedV2Goal) {
    goalConfirmed = false;
    nextGoalKey = selectedV2Goal;
    goalConfirmation = { status: 'pending', promptId: responseId, proposalMessageId: userMessage.id,
      goalKey: selectedV2Goal, catalogVersionRef: v2Version!.catalogVersionRef,
      personaVersionId: persona.id, sessionRevision: sessionRevision + 1,
      intentRevision: (intentDocument?.revision ?? -1) + 1, issuedAt: at };
    effectiveQuestion = 'Would you like to proceed with ' + requirementGoal.name.toLowerCase() + '?';
    effectiveAnswer = 'I can help with ' + requirementGoal.name.toLowerCase() + '. ' + effectiveQuestion;
    overrideResponse = true;
  }
  const effectiveCitationIds = overrideResponse ? [] : result.response.citationIds;
  const citations = overrideResponse ? [] : modelCitations;
  const grounded = effectiveCitationIds.length > 0 && !result.guardReason.startsWith('safe_no_evidence');
  const answerMasked = maskPiiForSession(session, effectiveAnswer, input.tokenVault);
  assertKnownTokens(session, answerMasked, input.tokenVault);
  const approvedResponse = { answer: answerMasked, grounded, citationRefs: effectiveCitationIds,
    pendingRequirementKey: effectivePendingRequirement };
  // Persist only facts that Node already verified in its session/intent store.
  // Never promote model-generated facts to verified customer facts.
  const proposedFacts = validPlan && selectedV2Goal && modelPlan && !decision
    ? validateQuotedV2CustomerFacts(modelPlan.proposedFacts ?? [], maskedMessage, userMessage.id, state.messageSequence)
    : {};
  const incomingFacts = { ...factPatch(facts as Record<string, string>, state.messageSequence), ...proposedFacts };
  const verifiedFactPatch: Record<string, UserIntentFact> = Object.fromEntries(
    Object.entries(incomingFacts).filter(([key, value]) =>
      !intentDocument?.verifiedFacts[key] || intentDocument.verifiedFacts[key]?.maskedValue !== value.maskedValue)
      .map(([key, value]) => [key, { ...value, corrected: Boolean(intentDocument?.verifiedFacts[key]) }]),
  );
  const nextDoc: UserIntentDocument = intentDocument ? {
    ...intentDocument, approvedResponse, lastQuestion: effectiveQuestion,
    verifiedFacts: { ...intentDocument.verifiedFacts, ...verifiedFactPatch },
    businessGoalKey: intentDocument.catalogSource === 'v2' ? nextGoalKey : intentDocument.businessGoalKey,
    goalConfirmed: intentDocument.catalogSource === 'v2' ? goalConfirmed : intentDocument.goalConfirmed,
    goalConfirmation: intentDocument.catalogSource === 'v2' ? goalConfirmation : intentDocument.goalConfirmation,
    turnIntentKey: intentDocument.catalogSource === 'v2' ? (nextGoalKey ? selectedTurnIntent ?? intentDocument.turnIntentKey : null) : intentDocument.turnIntentKey,
    pendingRequirementKey: effectivePendingRequirement,
    toolRefs: result.toolTrace.map(trace => trace.toolCallId),
    sourceRefs: [...result.response.citationIds, ...catalogSignalRefs], summary: state.rollingSummary,
    summaryRevision: intentDocument.summaryRevision + 1,
    revision: intentDocument.revision + 1, updatedAt: at,
  } : {
    id: randomUUID(), tenantId: tenant.id, sessionId: session.id, opportunityId,
    catalogSource: catalogV2 ? 'v2' : 'legacy_v1',
    catalogVersionRef: v2Version?.catalogVersionRef ?? catalog.id, personaVersionId: persona.id,
    businessGoalKey: nextGoalKey ?? (catalogV2 ? null : activeGoal),
    goalConfirmation: catalogV2 ? goalConfirmation : null,
    turnIntentKey: selectedTurnIntent, currentStageKey: entry?.lifecycle?.currentStage ?? null,
    stageRevision: entry?.lifecycle?.revision ?? 0,
    goalConfirmed: catalogV2 ? goalConfirmed : Boolean(originalState.selectedIntentKey), verifiedFacts: incomingFacts,
    pendingRequirementKey: effectivePendingRequirement, lastQuestion: effectiveQuestion, approvedResponse,
    toolRefs: result.toolTrace.map(trace => trace.toolCallId), sourceRefs: [...result.response.citationIds, ...catalogSignalRefs],
    summary: state.rollingSummary, summaryRevision: 1, revision: 0, createdAt: at, updatedAt: at,
  };
  assertSafeUserIntentDocument(nextDoc);
  const assessment = { id: randomUUID(), documentId: nextDoc.id, tenantId: tenant.id, sessionId: session.id,
    opportunityId, turnSequence: state.messageSequence, clientMessageId: input.clientMessageId,
    messageHash: input.messageHash,
    businessGoalKey: nextDoc.businessGoalKey, turnIntentKey: nextDoc.turnIntentKey,
    intentCategory: selectedTurnCategory,
    verifiedFactPatch, pendingRequirementKey: effectivePendingRequirement, lastQuestion: effectiveQuestion,
    approvedResponse, toolRefs: result.toolTrace.map(trace => trace.toolCallId),
    sourceRefs: [...result.response.citationIds, ...catalogSignalRefs], createdAt: at };
  assertSafeIntentTurn(assessment);
  const transition = !pendingDecision && shouldPrompt ? 'prompted'
    : decision === 'confirmed' || decision === 'rejected' || decision === 'corrected' ? decision : null;
  const decisionAudit = transition && goalConfirmation ? { id: randomUUID(), tenantId: tenant.id,
    actorId: null, eventName: 'v2.goal_confirmation.' + transition, createdAt: at,
    metadata: { sessionId: session.id, promptId: goalConfirmation.promptId,
      customerMessageId: transition === 'prompted' ? null : userMessage.id,
      clientMessageId: input.clientMessageId, businessGoalKey: goalConfirmation.goalKey,
      catalogVersionRef: goalConfirmation.catalogVersionRef, personaVersionId: persona.id,
      sessionRevision, intentRevision: nextDoc.revision, actionAuthorized: false } } : null;
  if (catalogV2) {
    const committed = await store.commitV2IntentTurn({ session, document: nextDoc,
      expectedDocumentRevision: intentDocument?.revision ?? null, assessment, audit: decisionAudit });
    session.stateVersion = committed.session.stateVersion;
  } else {
    await input.updateSession(session);
    if (intentDocument) {
      const updated = await store.updateUserIntentDocument({ document: nextDoc, expectedRevision: intentDocument.revision });
      if (!updated) throw new HttpError(409, 'V2_INTENT_REVISION_CONFLICT', 'The intent document changed concurrently.');
    } else await store.createUserIntentDocument(nextDoc);
    await store.appendIntentTurn(assessment);
  }
  if (modelPlan && v2Version) {
    await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: null,
      eventName: 'v2.catalog.planning_reviewed',
      metadata: { sessionId: session.id, sessionRevision, intentRevision: nextDoc.revision,
        catalogVersionRef: v2Version.catalogVersionRef, clientMessageId: input.clientMessageId,
        planDigest: hash(JSON.stringify(modelPlan)),
        accepted: validPlan, candidateGoalKey: selectedV2Goal,
        turnCategory: selectedTurnCategory, nextMove: validPlan ? modelPlan.nextMove : null,
        matchedSignalIds: catalogSignalRefs.join(',').slice(0, 600),
        acceptedCustomerFactKeys: Object.keys(proposedFacts).join(','),
        score: planningDecision?.score?.evidenceScore ?? null,
        modelConfidenceBand: modelPlan.confidenceBand,
        proposedToolKey: modelPlan.proposedToolKey,
        validatedReadToolKey: validPlan ? planningDecision?.proposedToolKey ?? null : null,
        reasons: planningDecision?.reasons.join(',').slice(0, 600) ?? '',
        actionAuthorized: false }, createdAt: at });
  }

  const response = {
    messageId: responseId, sessionId: session.id, answer: rehydrateForSession(session, answerMasked, input.tokenVault),
    grounded, conversational: !grounded, citations, actionProposal: null,
    pendingPromptId: goalConfirmation?.status === 'pending' ? goalConfirmation.promptId : nextPendingPrompt?.id ?? null, pendingIntentKey: nextDoc.businessGoalKey,
    pendingRequirementKey: effectivePendingRequirement, requestId: input.requestId,
  };
  await store.addMessage({ id: responseId, sessionId: session.id, tenantId: tenant.id, role: 'assistant',
    maskedContent: answerMasked, citations, clientMessageId: null,
    response: { conversational: !grounded, catalogVersionId: catalog.id, catalogIntentKey: activeGoal, catalogOpportunityId: opportunityId },
    createdAt: at });
  const persisted = { ...response, answer: answerMasked };
  await store.updateMessage({ ...userMessage, response: persisted });
  const responseCacheKey = cacheKey('tenant', tenant.id, 'chat-response', session.id, hash(input.clientMessageId));
  await input.cache.set(responseCacheKey, { messageHash: input.messageHash, response: persisted }, input.responseCacheTtlSeconds);
  await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: null, eventName: 'v2.gpt_first.turn',
    metadata: { sessionId: session.id, clientMessageId: input.clientMessageId,
      catalogVersionId: catalog.id, personaVersionId: persona.id, modelRequestCount: result.modelRequestCount,
      toolCallCount: result.toolCallCount, guardReason: result.guardReason, executionPath: 'langgraph' }, createdAt: at });
  return response;
};

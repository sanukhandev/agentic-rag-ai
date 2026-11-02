import { createHash, randomUUID } from 'node:crypto';
import { cacheKey, type CacheStore } from './cache.js';
import { newConversationState, prompt } from './conversation-state.js';
import { HttpError } from './http/errors.js';
import { assertKnownTokens, maskPiiForSession, rehydrateForSession, TokenVault } from './privacy.js';
import { issueV2Scope, V2_TOOL_NAMES } from './v2-tool-gateway.js';
import { assertSafeUserIntentDocument, assertSafeIntentTurn } from './user-intent-document.js';
import { type V2ConversationCoordinator, type V2CoordinatorRequest, type V2CoordinatorResult } from './v2-coordinator.js';
import type { V2ApprovedEvidence, V2VerifiedFact } from './v2-evidence.js';
import type { V2ApprovedFallbackTemplateSet } from './v2-fallbacks.js';
import type { Citation, Message, PersonaVersion, Session, Store, Tenant, UserIntentDocument, UserIntentFact } from './types.js';

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
  const activeGoal = originalState.activeFollowUpIntentKey ?? originalState.intentProgress?.activeIntentKey
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
    persona: { personaVersionId: persona.id, assistantName: persona.name, assistantRole: 'AI assistant',
      permittedLanguages: persona.permittedLanguages,
      tone: persona.tone.split(/[,;]+/u).map(x => x.trim()).filter(Boolean).slice(0, 12),
      speakingStyle: persona.speakingStyle, fallbackTemplateVersion: 'fallback-' + persona.id },
    intentProjection: { primaryGoalKey: activeGoal, goalConfirmed: Boolean(originalState.selectedIntentKey || intentDocument?.goalConfirmed),
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

  const citations = await resolvePublicCitations(store, tenant.id, result.response.citationIds, result.approvedEvidence ?? []);
  const answerMasked = maskPiiForSession(session, result.response.answer, input.tokenVault);
  assertKnownTokens(session, answerMasked, input.tokenVault);
  const grounded = result.response.citationIds.length > 0 && !result.guardReason.startsWith('safe_no_evidence');
  const responseId = randomUUID();
  // A model-authored next-question key can become durable only when it refers
  // to an existing, required slot in the active, pinned catalog. The model
  // cannot create consent, document, confirmation or stage transitions.
  const nextKey = result.response.nextQuestionKey;
  const proposedRequirement = !originalState.pendingPrompt && activeGoal && nextKey
    ? catalog.catalog.journeyRequirements?.find(candidate =>
        candidate.intentKey === activeGoal && candidate.requirementKey === nextKey
        && candidate.required && candidate.requirementType === 'slot'
        && !entry?.completedRequirementKeys.includes(candidate.requirementKey))
    : null;
  const nextPendingPrompt = originalState.pendingPrompt ?? (
    proposedRequirement && activeGoal
      ? prompt('slot', activeGoal, proposedRequirement.slotKey, proposedRequirement.requirementKey)
      : null);
  const effectivePendingRequirement = nextPendingPrompt?.requirementKey ?? pendingRequirement;
  const state = { ...originalState, catalogVersionId: catalog.id, pendingPrompt: nextPendingPrompt,
    rollingSummary: (originalState.rollingSummary + '\nCustomer: ' + maskedMessage.slice(0, 1_000)).trim().slice(-4_000),
    messageSequence: originalState.messageSequence + 1, summaryRevision: originalState.summaryRevision + 1,
    lastTurnAt: userMessage.createdAt };
  session.conversationState = state;
  await input.updateSession(session);
  const approvedResponse = { answer: answerMasked, grounded, citationRefs: result.response.citationIds,
    pendingRequirementKey: effectivePendingRequirement };
  const at = new Date().toISOString();
  const nextDoc: UserIntentDocument = intentDocument ? {
    ...intentDocument, approvedResponse, lastQuestion: result.response.nextQuestion,
    pendingRequirementKey: effectivePendingRequirement,
    toolRefs: result.toolTrace.map(trace => trace.toolCallId),
    sourceRefs: result.response.citationIds, summary: state.rollingSummary,
    summaryRevision: intentDocument.summaryRevision + 1,
    revision: intentDocument.revision + 1, updatedAt: at,
  } : {
    id: randomUUID(), tenantId: tenant.id, sessionId: session.id, opportunityId, catalogSource: 'legacy_v1',
    catalogVersionRef: catalog.id, personaVersionId: persona.id, businessGoalKey: activeGoal,
    turnIntentKey: null, currentStageKey: entry?.lifecycle?.currentStage ?? null,
    stageRevision: entry?.lifecycle?.revision ?? 0,
    goalConfirmed: Boolean(originalState.selectedIntentKey), verifiedFacts: factPatch(facts as Record<string,string>, state.messageSequence),
    pendingRequirementKey: effectivePendingRequirement, lastQuestion: result.response.nextQuestion, approvedResponse,
    toolRefs: result.toolTrace.map(trace => trace.toolCallId), sourceRefs: result.response.citationIds,
    summary: state.rollingSummary, summaryRevision: 1, revision: 0, createdAt: at, updatedAt: at,
  };
  assertSafeUserIntentDocument(nextDoc);
  if (intentDocument) {
    const updated = await store.updateUserIntentDocument({ document: nextDoc, expectedRevision: intentDocument.revision });
    if (!updated) throw new HttpError(409, 'V2_INTENT_REVISION_CONFLICT', 'The intent document changed concurrently.');
  } else await store.createUserIntentDocument(nextDoc);
  const assessment = { id: randomUUID(), documentId: nextDoc.id, tenantId: tenant.id, sessionId: session.id,
    opportunityId, turnSequence: state.messageSequence, clientMessageId: input.clientMessageId,
    messageHash: input.messageHash, businessGoalKey: activeGoal, turnIntentKey: null, intentCategory: null,
    verifiedFactPatch: {}, pendingRequirementKey: effectivePendingRequirement, lastQuestion: result.response.nextQuestion,
    approvedResponse, toolRefs: result.toolTrace.map(trace => trace.toolCallId), sourceRefs: result.response.citationIds, createdAt: at };
  assertSafeIntentTurn(assessment);
  await store.appendIntentTurn(assessment);

  const response = {
    messageId: responseId, sessionId: session.id, answer: rehydrateForSession(session, answerMasked, input.tokenVault),
    grounded, conversational: !grounded, citations, actionProposal: null,
    pendingPromptId: nextPendingPrompt?.id ?? null, pendingIntentKey: activeGoal,
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

import { createHash, randomUUID } from 'node:crypto';
import { cacheKey, type CacheStore } from '../cache.js';
import { ConversationContextCache } from '../conversation-context.js';
import { classifyScopedGoalDecision, newConversationState, prompt } from '../conversation-state.js';
import { scoreCatalogV2CompetingGoals, validatePublishedCatalogV2 } from './catalog-runtime.js';
import type { CatalogV2Document } from './catalog.js';
import { resolveV2IntentEvidence } from './intent-evidence.js';
import { authorizedPendingRequirement } from './conversation-decision.js';
import { authorizedV2ReadToolsForTurn, catalogBindingKeyForV2Read, catalogEnabledV2ReadTools } from './tool-policy.js';
import { validateV2PlanningProposal } from './planning.js';
import { proposeV2CatalogAction, v2ActionConsentScope } from './action-gate.js';
import { extractQuotedV2CustomerFacts, validateQuotedV2CustomerFacts } from './customer-fact-provenance.js';
import { contextForConfirmedV2Action, initializeConfirmedV2Journey } from './journey-bootstrap.js';
import type { ActionGateway } from '../actions.js';
import { classifyOfferReplyDeterministically, extractLeadData, normalizePendingLeadName } from '../model.js';
import { HttpError } from '../http/errors.js';
import { contextualizeV2KnowledgeQuery, isV2FactualKnowledgeQuestion, prefetchV2ApprovedKnowledge } from './knowledge-preflight.js';
import { KnowledgeRetrievalError } from '../knowledge.js';
import type { EmbeddingProvider } from '../embedding.js';
import { assertKnownTokens, maskPiiForSession, rehydrateForSession, TokenVault } from '../privacy.js';
import { issueV2Scope, listApprovedV2PackageEvidence, listApprovedV2PackageOptions, packageEvidenceText, V2_TOOL_NAMES, type V2PackageOption } from './tool-gateway.js';
import { assertSafeUserIntentDocument, assertSafeIntentTurn } from '../user-intent-document.js';
import { type ConversationTurnCoordinator, type V2CoordinatorRequest, type V2CoordinatorResult } from './coordinator.js';
import type { V2ApprovedEvidence, V2VerifiedFact } from './evidence.js';
import { guardV2Response } from './response-guard.js';
import type { V2ApprovedFallbackTemplateSet } from './fallbacks.js';
import type { Citation, FollowUpOfferOption, GoalConfirmationRecord, Message, PendingFollowUpOffer, PersonaVersion, Session, Store, Tenant, UserIntentDocument, UserIntentFact } from '../types.js';

/** A single guarded model turn. Never invokes the legacy planner or creates an action. */
export const executeV2Turn = async (
  coordinator: Pick<ConversationTurnCoordinator, 'run'>,
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
  /** Trusted server-side retrieval used before GPT composes factual knowledge answers. */
  embedding?: EmbeddingProvider;
  cache: CacheStore;
  tokenVault: TokenVault;
  session: Session;
  tenant: Tenant;
  userMessage: Message;
  clientMessageId: string;
  messageHash: string;
  maskedMessage: string;
  postbackValue?: string | null;
  requestId: string;
  responseCacheTtlSeconds: number;
  coordinator: Pick<ConversationTurnCoordinator, 'run'>;
  actionGateway?: Pick<ActionGateway, 'propose' | 'confirm'>;
  leadProviderReady?: boolean;
  scopeSecret: string;
  updateSession: (session: Session) => Promise<Session>;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const packageFollowUpOptions = (options: V2PackageOption[]): FollowUpOfferOption[] => options
  .map(option => ({
    key: `package_${option.packageKey.toLocaleLowerCase('en-US').replace(/[^a-z0-9_.-]+/gu, '_')}`,
    label: option.name,
    retrievalHints: [option.packageKey, option.name],
  }))
  .filter(option => /^package_[a-z0-9][a-z0-9_.-]{0,79}$/u.test(option.key));
const buildPackageEvidenceFallback = (message: string, options: V2PackageOption[], evidence: V2ApprovedEvidence[]) => {
  const messageTokens = new Set(message.toLocaleLowerCase('en-US').match(/[a-z0-9]{4,}/gu) ?? []);
  const matches = options.filter(option => [option.name, option.packageKey]
    .flatMap(value => value.toLocaleLowerCase('en-US').match(/[a-z0-9]{4,}/gu) ?? [])
    .some(token => !['ancfz', 'sample', 'package', 'option', 'options'].includes(token) && messageTokens.has(token)));
  const selectedEvidence = matches.length === 1
    ? evidence.filter(item => item.text.toLocaleLowerCase('en-US').includes(matches[0]!.name.toLocaleLowerCase('en-US').split(' (')[0]!.trim()))
    : evidence;
  const usableEvidence = selectedEvidence.length > 0 ? selectedEvidence : evidence;
  return {
    answer: `${usableEvidence.map(item => item.text).join('\n')}\n\nWhich package would you like to explore first?`,
    citationIds: usableEvidence.map(item => item.citationId),
  };
};
const guardPackageEvidenceFallback = (persona: PersonaVersion, fallback: ReturnType<typeof buildPackageEvidenceFallback>, evidence: V2ApprovedEvidence[]) => {
  const decision = guardV2Response({
    schemaVersion: 2, personaVersionId: persona.id, language: persona.permittedLanguages[0] ?? 'en',
    answer: fallback.answer, citationIds: fallback.citationIds,
    nextQuestion: 'Which package would you like to explore first?', nextQuestionKey: 'package_selection',
    reasonNoQuestion: null, decisionRef: `package-evidence-${hash(JSON.stringify(fallback.citationIds))}`,
  }, {
    personaVersionId: persona.id, assistantName: persona.name, permittedLanguages: persona.permittedLanguages,
    pendingRequirementKey: null, lastQuestionKey: null, questionPolicy: 'optional', evidence,
  });
  return decision.verdict.accepted ? decision.response : null;
};
export const chatTurnTimeoutMs = (env: NodeJS.ProcessEnv = process.env): number => {
  const configured = Number(env.CHAT_TURN_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(configured) ? Math.min(300_000, Math.max(120_000, Math.floor(configured))) : 120_000;
};
const safeFactValue = (value: string | undefined, max: number): string | undefined =>
  value && value.trim().length <= max && !/[\r\n<>@]/u.test(value) && !/https?:\/\//iu.test(value)
    && !/\+?\d[\d()\s-]{7,}/u.test(value) ? value.trim() : undefined;

const safePendingLeadName = (value: string): string | undefined => {
  const raw = value.trim();
  const candidate = normalizePendingLeadName(value);
  const namePart = String.raw`[\p{L}\p{M}][\p{L}\p{M}\d]*(?:['’.-][\p{L}\p{M}\d]+)*`;
  if (/[?]/u.test(raw)
    || /^(?:what|which|how|where|when|why)\b/iu.test(candidate)
    || /^(?:can|could|would)\s+(?:i|you|we)\b/iu.test(candidate)
    || /^i\s+(?:choose|select|want|need|prefer|proceed)\b/iu.test(candidate)
    || /^(?:yes|no)$/iu.test(candidate)) return undefined;
  return candidate.split(/\s+/u).filter(Boolean).length <= 6
    && safeFactValue(candidate, 120)
    && new RegExp(`^${namePart}(?:\\s+${namePart}){0,5}$`, 'u').test(candidate)
    ? candidate : undefined;
};

export const isCommercialDocumentRequest = (message: string): boolean =>
  /\b(?:document|documents|paperwork)\b/iu.test(message)
  && !/\b(?:status|uploaded|submitted|already|missing)\b/iu.test(message);

const fallbackTemplates = (persona: PersonaVersion, customerMessage?: string): V2ApprovedFallbackTemplateSet => {
  const isArabic = (persona.permittedLanguages.length === 1 && persona.permittedLanguages[0] === 'ar') || Boolean(customerMessage && /[\u0600-\u06FF]/u.test(customerMessage));
  return {
    approved: true, personaVersionId: persona.id, templateVersion: 'fallback-' + persona.id,
    language: isArabic ? 'ar' : (persona.permittedLanguages[0] ?? 'en'),
    templates: {
      invalid_model: isArabic
        ? 'لا يمكنني تأكيد هذه الإجابة بأمان في الوقت الحالي. يمكنني المتابعة بالمعلومات المؤكدة.'
        : 'I cannot verify that answer safely. I can continue with confirmed information.',
      tool_unavailable: isArabic
        ? 'المعلومات المعتمدة غير متاحة مؤقتاً.'
        : 'The approved information is temporarily unavailable.',
      reconciliation: isArabic
        ? 'أحتاج إلى التحقق من حالة الطلب قبل تأكيد النتيجة.'
        : 'I need to verify the request status before I confirm the outcome.',
    },
  };
};

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

export const resolvePublicCitations = async (store: Store, tenantId: string, ids: string[], evidence: V2ApprovedEvidence[]): Promise<Citation[]> => {
  const byId = new Map(evidence.map(item => [item.citationId, item]));
  const citations: Citation[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || !item.approved || item.revoked || !item.sourceRef) continue;
    // Tool evidence is trusted through its correlated read-only trace, not by
    // looking up a synthetic source id in the PostgreSQL source table.
    if (item.sourceRef.startsWith('tool-')) continue;
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

const contactRequirementKey = (catalog: NonNullable<ReturnType<typeof validatePublishedCatalogV2>['catalog']>, goalKey: string | null, suffix: string): string | null =>
  catalog.sheets.RequirementPolicies.find(requirement => requirement.goalKey === goalKey && requirement.requirementKey.endsWith(suffix))?.requirementKey ?? null;

const explicitLeadSubmissionRequest = (message: string): boolean =>
  /\b(?:create|submit|register|send|make)\b[\s\S]{0,80}\blead\b|\blead\b[\s\S]{0,80}\b(?:create|submit|register|send|make)\b/iu.test(message)
  || /\bgo\s+ahead\b[\s\S]{0,40}\b(?:with|and)\b[\s\S]{0,40}\blead\b/iu.test(message);

const explicitLeadActionConfirmation = (message: string): boolean =>
  /\b(?:confirm|confirmed|authorize|authorized|approve|approved)\b[\s\S]{0,80}\b(?:lead|submission|submit)\b/iu.test(message)
  || /\bconfirm\s+the\s+authorized\s+submission\b/iu.test(message);

const explicitContactConsent = (message: string): boolean =>
  /^\s*(?:yes|yes,?\s*(?:please|i do)|i consent|i agree|go ahead)\s*[.!]?\s*$/iu.test(message)
  || /\b(?:consent|permission|authorize)\b[\s\S]{0,80}\b(?:contact|details|use)\b/iu.test(message);

const escapedWordPattern = (value: string): string => value.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const isV2PackageQuestion = (message: string, knownPackageNames: readonly string[] = []): boolean =>
  /\b(?:package|packages|price|prices|pricing|cost|costs|fee|fees|quote|quotation)\b/iu.test(message)
  || /\b(?:package|plan|tier)\s+(?:option|options|choice|choices)\b/iu.test(message)
  || knownPackageNames.some((name) => name.trim().length > 0 && new RegExp(`\\b${escapedWordPattern(name)}\\b`, 'iu').test(message));

export const isPackageSummaryRequest = (message: string): boolean =>
  !/\b(?:document|documents|passport|identity|upload|provide|require\w*|eligible|eligibility|activit\w*|licen[cs]e|steps|recommend\w*|best)\b/iu.test(message)
  && !/\b(?:selected|this|that)\s+package\b/iu.test(message)
  && !/\b(?:quote|quotation)\b/iu.test(message)
  && (/\b(?:price|prices|pricing|cost|costs|fee|fees|visa|visas|office|includ\w*|availab\w*|process(?:ing)?|compare|comparison|versus|vs\.?)\b/iu.test(message)
    || (/\b(?:package|packages|plan|plans|tier|tiers)\b/iu.test(message)
      && /\b(?:what|which|offer\w*|availab\w*|option\w*|choice\w*|compare|comparison|versus|vs\.?)\b/iu.test(message)));

export const resolveDocumentRequirement = (
  catalog: CatalogV2Document | null,
  goalKey: string | null,
  stageKey: string | null,
  pendingRequirementKey: string | null,
): string | null => {
  if (!catalog || !goalKey || stageKey !== 'document_upload') return null;
  const pendingIsDocumentRequirement = Boolean(pendingRequirementKey && (
    pendingRequirementKey.startsWith('document.')
    || catalog.sheets.RequirementPolicies.some(requirement => requirement.goalKey === goalKey
      && requirement.stageKey === stageKey && requirement.requirementKey === pendingRequirementKey)));
  if (pendingIsDocumentRequirement) return pendingRequirementKey;
  return catalog.sheets.DocumentPolicies.find(policy => policy.goalKey === goalKey && policy.stageKey === stageKey && policy.required && policy.enabled)?.policyKey ?? null;
};

/** Called after HTTP authentication and durable message-idempotency checks. */
export const runGPTFirstChatTurn = async (input: GPTFirstTurnInput) => {
  let { store, session, tenant, userMessage, coordinator, maskedMessage } = input;
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
  const activeFollowUpOffer: PendingFollowUpOffer | null = originalState.pendingFollowUpOffer
    && Date.parse(originalState.pendingFollowUpOffer.expiresAt) > Date.now()
    && (!originalState.pendingFollowUpOffer.intentKey || !originalState.selectedIntentKey || originalState.pendingFollowUpOffer.intentKey === originalState.selectedIntentKey)
    ? originalState.pendingFollowUpOffer : null;
  const offerReply = activeFollowUpOffer ? classifyOfferReplyDeterministically(maskedMessage, activeFollowUpOffer) : null;
  const acceptedOfferOption: FollowUpOfferOption | null = activeFollowUpOffer
    && (offerReply?.action === 'accept' || offerReply?.action === 'select_option') && offerReply.optionKey
    ? activeFollowUpOffer.options.find(option => option.key === offerReply.optionKey) ?? null : null;
  // Canonical GPT-first selection: V2 first for new sessions, then V1 rollback.
  // Existing sessions remain pinned to their exact catalog publication.
  const publishedV2 = (await store.listIntentCatalogV2Versions(tenant.id))
    .find(version => version.status === 'published') ?? null;
  const pinnedLegacy = originalState.catalogVersionId
    ? await store.getIntentCatalogVersion(tenant.id, originalState.catalogVersionId) : null;
  const pinnedV2 = originalState.catalogVersionId && !pinnedLegacy
    ? await store.getIntentCatalogV2Version(tenant.id, originalState.catalogVersionId) : null;
  const catalog = originalState.catalogVersionId
    ? pinnedLegacy ?? pinnedV2
    : publishedV2 ?? await store.getPublishedIntentCatalog(tenant.id);
  if (pinnedV2 && pinnedV2.status !== 'published') {
    throw new HttpError(409, 'V2_CATALOG_PIN_STALE', 'The pinned V2 catalog is no longer published.');
  }
  if (!catalog || catalog.status !== 'published') {
    throw new HttpError(409, 'V2_CATALOG_UNAVAILABLE',
      'Publish the reviewed V2 intent catalog for this tenant before using GPT-first chat.');
  }
  const legacyCatalog = 'catalogVersionRef' in catalog ? null : catalog;
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
  const crmLead = await store.getCrmLeadBySessionId(session.id, tenant.id);
  if (intentDocument && (intentDocument.personaVersionId !== persona.id || intentDocument.tenantId !== tenant.id || intentDocument.sessionId !== session.id)) {
    throw new HttpError(409, 'V2_PINNED_CONTEXT_STALE', 'The session intent document does not match its trusted context.');
  }
  // Do not borrow a newer V2 revision when an existing journey pins the prior one.
  const v2Version = intentDocument?.catalogSource === 'v2'
    ? (publishedV2?.catalogVersionRef === intentDocument.catalogVersionRef
        && (!pinnedV2 || pinnedV2.id === publishedV2.id) ? publishedV2 : null)
    : !intentDocument ? (pinnedV2 ?? (!pinnedLegacy ? publishedV2 : null)) : null;
  if (pinnedV2 && (!v2Version || pinnedV2.id !== v2Version.id)) {
    throw new HttpError(409, 'V2_CATALOG_PIN_STALE', 'The pinned V2 catalog was replaced or unpublished.');
  }
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
  const commercialDocumentRequest = Boolean(catalogV2 && !crmLead && !intentDocument?.goalConfirmed
    && isCommercialDocumentRequest(maskedMessage));
  const enabledActionToolKeys = catalogV2
    ? catalogV2.sheets.ToolBindings.filter(tool => tool.enabled && tool.sideEffectClass !== 'read_only')
      .map(tool => tool.toolKey).slice(0, 32)
    : [];
  const activeGoal = (intentDocument?.catalogSource === 'v2' ? intentDocument.businessGoalKey : null)
    ?? originalState.activeFollowUpIntentKey ?? originalState.intentProgress?.activeIntentKey
    ?? originalState.selectedIntentKey ?? intentDocument?.businessGoalKey ?? null;
  const entry = activeGoal ? originalState.intentProgress?.entries[activeGoal] : null;
  const opportunityId = entry?.journeyId ?? intentDocument?.opportunityId ?? null;
  const contextCache = new ConversationContextCache(input.cache);
  // Interest in a goal is not a confirmed journey. Never expose a stale
  // qualification requirement on a knowledge-only or unconfirmed V2 turn.
  const priorPendingRequirement = catalogV2 && (!intentDocument?.goalConfirmed || !intentDocument.currentStageKey)
    ? null : originalState.pendingPrompt?.requirementKey ?? entry?.currentRequirementKey ?? intentDocument?.pendingRequirementKey ?? null;
  const documentFacts = intentDocument ? Object.fromEntries(Object.entries(intentDocument.verifiedFacts)
    .filter(([, item]) => item.source === 'node' || item.source === 'visitor')
    .map(([key, item]) => [key, item.maskedValue])) : {};
  const persistedContact = { ...originalState.slotValues, ...(entry?.slotValues ?? {}) };
  const extractedContact = extractLeadData(maskedMessage);
  const contactActive = Boolean(catalogV2 && intentDocument?.goalConfirmed
    && (/(?:contact|crm_consent|action_confirmation)/iu.test(priorPendingRequirement ?? '') || Object.keys(extractedContact).length > 0));
  const nameRequirementKey = catalogV2 ? contactRequirementKey(catalogV2, intentDocument?.businessGoalKey ?? null, 'contact_name') : null;
  const channelRequirementKey = catalogV2 ? contactRequirementKey(catalogV2, intentDocument?.businessGoalKey ?? null, 'contact_channel') : null;
  const consentRequirementKey = catalogV2 ? contactRequirementKey(catalogV2, intentDocument?.businessGoalKey ?? null, 'crm_consent') : null;
  const actionConfirmationRequirementKey = catalogV2 ? contactRequirementKey(catalogV2, intentDocument?.businessGoalKey ?? null, 'action_confirmation') : null;
  const pendingNameCandidate = contactActive && Boolean(nameRequirementKey)
    && priorPendingRequirement === nameRequirementKey && !extractedContact.name
    ? safePendingLeadName(maskedMessage) : null;
  const pendingNameToken = pendingNameCandidate
    ? extractLeadData(maskPiiForSession(session, `My name is ${pendingNameCandidate}`, input.tokenVault)).name ?? null
    : null;
  if (pendingNameToken) {
    maskedMessage = `My name is ${pendingNameToken}`;
    userMessage = await store.updateMessage({ ...userMessage, maskedContent: maskedMessage });
  }
  const contactFromMessage = { ...extractedContact, ...(pendingNameToken ? { name: pendingNameToken } : {}) };
  const contactSlots: Record<string, string> = Object.fromEntries(Object.entries(contactFromMessage).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const contactValues = { ...persistedContact, ...contactSlots };
  const resolvedConsentRequirementKey = consentRequirementKey ?? (/contact.*consent/iu.test(priorPendingRequirement ?? '') ? priorPendingRequirement : null);
  const nextContactRequirement = contactActive
    ? !contactValues.name ? nameRequirementKey
      : !contactValues.email && !contactValues.phone ? channelRequirementKey
        : originalState.contactConsent !== 'granted' ? consentRequirementKey
          : actionConfirmationRequirementKey
    : null;
  const pendingRequirement = nextContactRequirement ?? priorPendingRequirement;
  const { facts, evidence } = trustedFacts({ ...documentFacts, ...originalState.slotValues, ...(entry?.slotValues ?? {}) }, catalog.id);
  const sessionRevision = session.stateVersion ?? 0;
  const cachedContext = await contextCache.get({ tenantId: tenant.id, sessionId: session.id, opportunityId });
  const priorMessages = (await store.listMessages(session.id, tenant.id, 12))
    .filter(msg => msg.id !== userMessage.id).slice(-8);
  const databaseHistory = priorMessages.map(msg => ({
    role: msg.role === 'user' ? 'customer' as const : 'assistant' as const,
    content: msg.maskedContent.slice(0, 2_000),
  }));
  const history = cachedContext?.stateRevision === sessionRevision && cachedContext.recentTurns.length > 0
    ? cachedContext.recentTurns.slice(-8).map(turn => ({ role: turn.role === 'user' ? 'customer' as const : 'assistant' as const, content: turn.content.slice(0, 2_000) }))
    : databaseHistory;
  // Only prior customer-authored messages in this tenant/session may supply
  // bounded context evidence. Model/assistant text cannot create intent proof.
  const intentEvidence = catalogV2 && v2Version ? resolveV2IntentEvidence({
    catalog: catalogV2, catalogVersionRef: v2Version.catalogVersionRef,
    currentMessage: maskedMessage, currentMessageId: userMessage.id,
    recentCustomerTurns: priorMessages.filter(msg => msg.role === 'user')
      .map(msg => ({ messageId: msg.id, text: msg.maskedContent })),
    confirmedGoalKey: intentDocument?.goalConfirmed ? intentDocument.businessGoalKey : null,
  }) : null;
  const contextualTopic = intentDocument?.catalogSource === 'v2'
    && intentDocument.businessGoalKey && intentDocument.goalConfirmation?.status !== 'rejected'
    && intentDocument.goalConfirmation?.status !== 'corrected'
    ? catalogV2?.sheets.BusinessGoals.find(goal =>
      goal.active && goal.businessGoalKey === intentDocument.businessGoalKey)?.name ?? null
    : priorMessages.some(message => message.role === 'user' && /\b(?:company|business|formation|incorporat\w*|register\w*|setup)\b/iu.test(message.maskedContent))
      ? 'Company formation' : null;
  const contextualizedQuery = acceptedOfferOption && activeFollowUpOffer
    ? `${activeFollowUpOffer.sourceQuery}\n${acceptedOfferOption.label}\n${acceptedOfferOption.retrievalHints.join(' ')}`
    : contextualizeV2KnowledgeQuery(maskedMessage, contextualTopic);
  const preflightQuery = acceptedOfferOption ? contextualizedQuery : contextualizedQuery === maskedMessage ? contextualizedQuery : `${contextualizedQuery} process steps`;
  const statusOrRecapTurn = /\b(?:status|recap|summary|summarize|what did i tell you|without assuming)\b/iu.test(maskedMessage);
  const packageIntent = isV2PackageQuestion(maskedMessage, activeFollowUpOffer?.options.map(option => option.label));
  const quoteContinuationRequest = Boolean(catalogV2 && packageIntent
    && /\b(?:quote|quotation)\b/iu.test(maskedMessage)
    && !intentDocument?.goalConfirmed);
  const authorizedReadTools = catalogV2
    ? authorizedV2ReadToolsForTurn(catalogV2, V2_TOOL_NAMES, packageIntent, isV2FactualKnowledgeQuestion(contextualizedQuery) || !statusOrRecapTurn)
    : [...V2_TOOL_NAMES];
  let approvedKnowledge: V2ApprovedEvidence[] = [];
  let packageOptions: V2PackageOption[] | null = null;
  if (acceptedOfferOption && (acceptedOfferOption.key === 'explain_more' || acceptedOfferOption.key.startsWith('package_')) && acceptedOfferOption.retrievalHints[0]) {
    const packageHint = acceptedOfferOption.retrievalHints[0].toLocaleLowerCase('en-US');
    const packageSourceVersion = v2Version?.catalogVersionRef ?? legacyCatalog?.id ?? catalog.id;
    try {
      if (v2Version) {
        const now = Date.now();
        const offerings = await store.listPackageOfferings(tenant.id, { catalogVersionRef: v2Version.catalogVersionRef });
        const selected = offerings.find(offering => (offering.packageKey.toLocaleLowerCase('en-US') === packageHint
          || offering.name.toLocaleLowerCase('en-US').replace(/\s*\(sample\)\s*$/iu, '').split(/\s+/u).at(-1) === packageHint)
          && offering.approvalStatus === 'approved'
          && (!offering.pricingEffectiveFrom || Date.parse(offering.pricingEffectiveFrom) <= now)
          && (!offering.pricingEffectiveTo || Date.parse(offering.pricingEffectiveTo) > now));
        if (selected) {
          const text = packageEvidenceText(selected, 'The approved package', 'verified');
          approvedKnowledge = [{
            citationId: `tool-${hash(`${v2Version.catalogVersionRef}:${selected.id}:${text}`).slice(0, 32)}`,
            sourceVersion: v2Version.catalogVersionRef, sourceRef: 'tool-get_available_packages', text, approved: true, revoked: false,
          }];
        }
      } else {
        const now = Date.now();
        const offerings = await store.listPackageOfferings(tenant.id, { catalogVersionId: legacyCatalog?.id ?? catalog.id });
        const selected = offerings.find(offering => offering.approvalStatus === 'approved'
          && (!offering.pricingEffectiveFrom || Date.parse(offering.pricingEffectiveFrom) <= now)
          && (!offering.pricingEffectiveTo || Date.parse(offering.pricingEffectiveTo) > now)
          && (offering.packageKey.toLocaleLowerCase('en-US') === packageHint
            || offering.name.toLocaleLowerCase('en-US').replace(/\s*\(sample\)\s*$/iu, '').split(/\s+/u).at(-1) === packageHint));
        if (selected) {
          const text = packageEvidenceText(selected, 'The approved package', 'verified');
          approvedKnowledge = [{
            citationId: `tool-${hash(`${packageSourceVersion}:${selected.id}:${text}`).slice(0, 32)}`,
            sourceVersion: packageSourceVersion, sourceRef: 'tool-get_available_packages', text, approved: true, revoked: false,
          }];
        }
      }
    } catch {
      approvedKnowledge = [];
    }
  }
  if (approvedKnowledge.length === 0 && v2Version && packageIntent) {
    try {
      approvedKnowledge = await listApprovedV2PackageEvidence(store, tenant.id, v2Version.catalogVersionRef);
      packageOptions = await listApprovedV2PackageOptions(store, tenant.id, v2Version.catalogVersionRef);
    } catch {
      approvedKnowledge = [];
      packageOptions = [];
    }
  }
  if (approvedKnowledge.length === 0 && input.embedding) {
    try {
      approvedKnowledge = await prefetchV2ApprovedKnowledge(store, input.embedding, tenant.id, preflightQuery);
    } catch (error) {
      if (error instanceof KnowledgeRetrievalError) {
        throw new HttpError(503, 'V2_KNOWLEDGE_RETRIEVAL_UNAVAILABLE', 'Approved knowledge retrieval is unavailable. Please retry the question.');
      }
      throw error;
    }
  }
  const scopeRef = issueV2Scope({
    tenantId: tenant.id, sessionId: session.id, opportunityId, catalogVersionId: catalog.id,
    personaVersionId: persona.id, stateRevision: sessionRevision, toolAllowlist: authorizedReadTools,
  }, input.scopeSecret);
  const envelope: V2CoordinatorRequest['envelope'] = {
    schemaVersion: 2, requestId: input.requestId, clientMessageId: input.clientMessageId, scopeRef,
    sessionRevision, intentRevision: originalState.intentProgress?.journeyRevision ?? 0,
    catalogVersionId: catalog.id, personaVersionId: persona.id, customerMessageMasked: maskedMessage.slice(0, 5_000),
    latestTurns: history, ...(cachedContext?.summary ? { conversationSummary: cachedContext.summary } : {}), catalogDigest: hash(JSON.stringify(catalog.catalog)),
    approvedKnowledge: approvedKnowledge.map(item => ({
      citationId: item.citationId, sourceVersion: item.sourceVersion,
      sourceRef: item.sourceRef!, text: item.text,
    })),
    ...(catalogV2 && v2Version ? { catalogV2: {
      versionRef: v2Version.catalogVersionRef,
      businessGoals: catalogV2.sheets.BusinessGoals.filter(goal => goal.active)
        .map(goal => ({ key: goal.businessGoalKey, name: goal.name.slice(0, 120), description: goal.description.slice(0, 4_000),
          keywords: goal.keywords.slice(0, 64), customerExpressions: goal.customerExpressions.slice(0, 24),
          requiredInformation: goal.requiredInformation.slice(0, 24), requiredDocuments: goal.requiredDocuments.slice(0, 24),
          orderedSteps: goal.orderedSteps.slice(0, 16), packageReferences: goal.packageReferences.slice(0, 24),
          productReferences: goal.productReferences.slice(0, 24), authorizedToolKeys: goal.authorizedToolKeys.slice(0, 32),
          completionConditions: goal.completionConditions.slice(0, 24), confirmationRequired: goal.confirmationRequired })),
      turnIntents: catalogV2.sheets.TurnIntents.filter(turn => turn.active)
        .map(turn => ({ key: turn.turnIntentKey, categoryKey: turn.categoryKey, businessGoalKey: turn.businessGoalKey })),
      signals: catalogV2.sheets.IntentSignals
        .map(signal => ({ signalId: signal.signalId, targetKey: signal.targetKey, value: signal.value, ...(signal.aliases ? { aliases: signal.aliases } : {}) })),
      knowledgeTopics: catalogV2.sheets.KnowledgeTopics.filter(topic => topic.active)
        .map(topic => ({ topicKey: topic.topicKey, goalKey: topic.goalKey, citationRequired: topic.citationRequired })),
      requirementKeys: catalogV2.sheets.RequirementPolicies.filter(req => req.required).map(req => req.requirementKey),
      enabledReadToolKeys: catalogV2.sheets.ToolBindings.filter(tool => tool.enabled && tool.sideEffectClass === 'read_only')
        .length > 0 ? catalogEnabledV2ReadTools(catalogV2, V2_TOOL_NAMES).slice(0, 32) : [],
      enabledActionToolKeys,
    } } : {}),
    persona: { personaVersionId: persona.id, assistantName: persona.name, assistantRole: 'AI assistant',
      permittedLanguages: persona.permittedLanguages,
      tone: persona.tone.split(/[,;]+/u).map(x => x.trim()).filter(Boolean).slice(0, 12),
      speakingStyle: persona.speakingStyle, fallbackTemplateVersion: 'fallback-' + persona.id },
    intentProjection: { primaryGoalKey: activeGoal, goalConfirmed: intentDocument?.catalogSource === 'v2' ? intentDocument.goalConfirmed : Boolean(originalState.selectedIntentKey || intentDocument?.goalConfirmed),
      currentStageKey: entry?.lifecycle?.currentStage ?? null, pendingRequirementKey: pendingRequirement, confirmedCustomerFacts: facts },
    toolAllowlist: authorizedReadTools,
    budgets: { maxModelRequests: 4, maxToolCalls: 4, maxToolRounds: 2, deadlineAt: new Date(Date.now() + chatTurnTimeoutMs()).toISOString() },
  };
  const result = await executeV2Turn(coordinator, {
    envelope, evidence: approvedKnowledge, verifiedFacts: evidence, lastQuestionKey: originalState.pendingPrompt?.requirementKey ?? null,
    questionPolicy: 'optional', fallbackTemplates: fallbackTemplates(persona, envelope.customerMessageMasked),
  });
  if (result.toolTrace.some(trace => trace.status === 'stale_state')) throw new HttpError(409, 'V2_STALE_TOOL_STATE', 'The conversation state changed; retry this message.');
  const current = await store.getSession(session.id);
  if (!current || current.tenantId !== tenant.id || (current.stateVersion ?? 0) !== sessionRevision) {
    throw new HttpError(409, 'V2_STALE_SESSION', 'The conversation changed while the model was reasoning.');
  }

  // Model planning is advisory until checked against the exact canonical,
  // published V2 catalog. Never accept a fabricated signal as score evidence.
  // Validated intent and the final factual answer are distinct artifacts.
  // Recover the original model's advisory plan after safe entailment/knowledge
  // repair, but ALWAYS pass it through Node's catalog and customer-evidence
  // validators below. A rejected answer never becomes authorization.
  // Response wording and customer-intent planning are independent decisions.
  // A rejected draft must not erase a valid, still-unconfirmed goal proposal;
  // Node revalidates the candidate against catalog membership and customer text.
  const rawModelPlan = result.candidateResponse?.planning ?? result.response.planning ?? null;
  const modelPlan = rawModelPlan && rawModelPlan.proposedToolKey
    ? { ...rawModelPlan, proposedToolKey: catalogBindingKeyForV2Read(rawModelPlan.proposedToolKey) } : rawModelPlan;
  const existingConfirmedGoal = intentDocument?.catalogSource === 'v2' && intentDocument.goalConfirmed
    ? intentDocument.businessGoalKey : null;
  const planningDecision = modelPlan && catalogV2 ? validateV2PlanningProposal(modelPlan, catalogV2, {
    confirmedGoalKey: existingConfirmedGoal, currentStageKey: intentDocument?.catalogSource === 'v2'
      ? intentDocument.currentStageKey : null,
    verifiedRequirementKeys: Object.keys(intentDocument?.catalogSource === 'v2' ? intentDocument.verifiedFacts : facts),
    goalConfirmed: Boolean(existingConfirmedGoal),
    allowedToolKeys: catalogV2.sheets.ToolBindings.filter(tool => tool.enabled)
      .map(tool => tool.toolKey),
    observedText: maskedMessage,
    ...(intentEvidence ? {
      serverObservedSignalIds: intentEvidence.observedSignals.map(signal => signal.signalId),
      serverRunnerUpScore: scoreCatalogV2CompetingGoals(catalogV2,
        intentEvidence.observedSignals.map(signal => signal.signalId),
        modelPlan.primaryGoalKey ?? existingConfirmedGoal ?? '').runnerUpScore,
    } : {}),
  }) : null;
  // Only validated proposals and independently observed signals influence
  // the candidate goal. High model confidence never confirms a goal.
  const validPlan = Boolean(planningDecision?.accepted);
  const semanticGoalCandidate = Boolean(validPlan && modelPlan && planningDecision?.primaryGoalKey
    && planningDecision.proposal?.turnCategory === 'business_goal'
    && modelPlan.confidenceBand !== 'low'
    && !planningDecision.score?.ambiguous
    && intentEvidence?.initiation === 'explicit'
    && intentEvidence.ambiguous === false);
  const selectedV2Goal = existingConfirmedGoal ?? (validPlan && (planningDecision?.score?.thresholdMet || semanticGoalCandidate)
    && !planningDecision?.score?.ambiguous ? planningDecision?.primaryGoalKey ?? null
    : intentDocument?.catalogSource === 'v2' ? intentDocument.businessGoalKey
      ?? (commercialDocumentRequest || quoteContinuationRequest ? catalogV2?.sheets.BusinessGoals.find(goal => goal.active && goal.confirmationRequired)?.businessGoalKey ?? null : null)
      : commercialDocumentRequest || quoteContinuationRequest ? catalogV2?.sheets.BusinessGoals.find(goal => goal.active && goal.confirmationRequired)?.businessGoalKey ?? null : null);
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
      || pendingDecision.proposalMessageId === userMessage.id
      || !(await store.listMessages(session.id, tenant.id)).some(message =>
        message.id === pendingDecision.promptId && message.role === 'assistant')) {
      throw new HttpError(409, 'V2_GOAL_CONFIRMATION_STALE', 'The goal confirmation prompt is no longer current.');
    }
  }
  const decision = pendingDecision ? classifyScopedGoalDecision(maskedMessage) : null;
  const pendingGoalName = pendingDecision
    ? catalogV2?.sheets.BusinessGoals.find(goal => goal.active && goal.businessGoalKey === pendingDecision.goalKey)?.name.toLowerCase() ?? 'this service'
    : 'this service';
  const selectedTurnIntent = validPlan && selectedV2Goal && selectedTurnCategory && catalogV2
    ? catalogV2.sheets.TurnIntents.find(turn =>
        turn.active && turn.businessGoalKey === selectedV2Goal && turn.categoryKey === selectedTurnCategory)?.turnIntentKey ?? null
    : null;
  const selectedRequirement = validPlan && selectedV2Goal && planningDecision?.score?.thresholdMet
    ? planningDecision.nextRequirementKey : null;
  const catalogSignalRefs = validPlan ? (planningDecision?.validatedSignalIds ?? [])
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
  // A source can be revoked while GPT is composing. Never return previously
  // grounded factual text with citations that no longer resolve to active data.
  const citedKnowledgeIds = (result.approvedEvidence ?? [])
    .filter(item => item.sourceRef && !item.sourceRef.startsWith('tool-')
      && result.response.citationIds.includes(item.citationId)).map(item => item.citationId);
  if (citedKnowledgeIds.some(id => !modelCitations.some(citation => citation.chunkId === id))) {
    throw new HttpError(409, 'V2_KNOWLEDGE_CITATION_STALE', 'A cited knowledge source changed during the turn. Please retry.');
  }
  const responseId = randomUUID();
  // A model-authored next-question key can become durable only when it refers
  // to an existing, required slot in the active, pinned catalog. The model
  // cannot create consent, document, confirmation or stage transitions.
  const nextKey = result.response.nextQuestionKey;
  const proposedRequirement = !originalState.pendingPrompt && activeGoal && nextKey && !catalogV2 && legacyCatalog
    ? legacyCatalog.catalog.journeyRequirements?.find(candidate =>
        candidate.intentKey === activeGoal && candidate.requirementKey === nextKey
        && candidate.required && candidate.requirementType === 'slot'
        && !entry?.completedRequirementKeys.includes(candidate.requirementKey))
    : null;
  // V2 requirements are kept in the authoritative intent document; they
  // cannot create a legacy action or stage transition by themselves.
  const nextPendingPrompt = catalogV2
    ? (intentDocument?.goalConfirmed && decision !== 'rejected' && decision !== 'corrected'
      ? originalState.pendingPrompt : null)
    : originalState.pendingPrompt ?? (
      proposedRequirement && activeGoal
        ? prompt('slot', activeGoal, proposedRequirement.slotKey, proposedRequirement.requirementKey)
        : null);
  const contactDecision = contactActive && (pendingRequirement === resolvedConsentRequirementKey || nextContactRequirement === resolvedConsentRequirementKey)
    ? (input.postbackValue === 'v2:contact-consent:grant' || explicitContactConsent(maskedMessage)) ? 'granted' : null : null;
  const contactConsent = contactDecision ?? originalState.contactConsent;
  const contactRequirementAfterDecision = contactActive
    ? !contactValues.name ? nameRequirementKey
      : !contactValues.email && !contactValues.phone ? channelRequirementKey
        : contactConsent !== 'granted' ? resolvedConsentRequirementKey
          : actionConfirmationRequirementKey
    : null;
  // An explicit, already-authorized Lead request is an independent customer
  // intent. Do not lose it because the model's prose or optional plan failed
  // response validation.
  const priorActions = await store.listActionsBySession(session.id, tenant.id);
  const explicitLeadRequest = explicitLeadSubmissionRequest(maskedMessage);
  const existingLeadAction = priorActions.find(action => action.actionKey === 'lead.create'
    && !['failed', 'reconcile_required'].includes(action.state));
  const terminalLeadAction = priorActions.some(action => action.actionKey === 'lead.create'
    && ['failed', 'reconcile_required'].includes(action.state));
  const leadProposalAfterConsent = Boolean(contactActive && contactConsent === 'granted'
    && actionConfirmationRequirementKey && (contactDecision === 'granted' || priorPendingRequirement === actionConfirmationRequirementKey)
    && !existingLeadAction && !terminalLeadAction);
  const proposedActionToolKey = explicitLeadRequest || leadProposalAfterConsent
    ? 'lead.create'
    : validPlan && planningDecision?.proposal?.nextMove === 'propose_action'
      ? planningDecision.proposedToolKey : null;
  const proposedActionBinding = proposedActionToolKey && catalogV2
    ? catalogV2.sheets.ToolBindings.find(binding => binding.toolKey === proposedActionToolKey) ?? null : null;
  const leadCreateBinding = catalogV2?.sheets.ToolBindings.find(binding => binding.toolKey === 'lead.create') ?? null;
  const leadActionRequested = explicitLeadRequest;
  const leadActionConfirmed = explicitLeadActionConfirmation(maskedMessage);
  const leadProviderUnavailable = leadCreateBinding?.enabled === true
    && input.leadProviderReady === false
    && (leadActionRequested || leadActionConfirmed || leadProposalAfterConsent);
  const actionProposalRequested = Boolean(input.actionGateway && catalogV2 && v2Version && selectedV2Goal
    && proposedActionToolKey && proposedActionBinding
    && proposedActionBinding.sideEffectClass !== 'read_only'
    && contactConsent === 'granted'
    && !leadProviderUnavailable
    && (explicitLeadRequest || leadProposalAfterConsent || (validPlan && planningDecision?.proposal?.nextMove === 'propose_action')));
  const actionPurposeConsentScope = actionProposalRequested && proposedActionToolKey && catalogV2
    ? v2ActionConsentScope({ catalogVersionId: v2Version?.catalogVersionRef ?? catalog.id }, proposedActionToolKey) : originalState.consentVersion;
  let effectivePendingRequirement = catalogV2 ? authorizedPendingRequirement({
    catalogSource: 'v2', goalConfirmed: Boolean(intentDocument?.goalConfirmed),
    businessGoalKey: intentDocument?.businessGoalKey ?? null,
    currentStageKey: intentDocument?.currentStageKey ?? null,
    selectedRequirementKey: actionProposalRequested ? actionConfirmationRequirementKey : contactRequirementAfterDecision ?? selectedRequirement,
    priorRequirementKey: actionProposalRequested ? null : priorPendingRequirement,
    goalDecision: decision,
  }) : nextPendingPrompt?.requirementKey ?? selectedRequirement ?? pendingRequirement;
  const leadActionPending = Boolean(contactActive && contactConsent === 'granted'
    && actionConfirmationRequirementKey
    && (effectivePendingRequirement === actionConfirmationRequirementKey || explicitLeadRequest));
  const leadSubmissionUnavailable = leadProviderUnavailable
    || (leadActionPending && (leadActionRequested || leadActionConfirmed) && leadCreateBinding?.enabled !== true);
  const state = { ...originalState, catalogVersionId: catalog.id,
    slotValues: contactActive ? { ...originalState.slotValues, ...contactSlots, ...(contactDecision ? { contact_consent: contactDecision === 'granted' ? 'true' : 'false' } : {}) } : originalState.slotValues,
    contactConsent,
    consentVersion: actionPurposeConsentScope,
    consentCapturedAt: contactDecision ? new Date().toISOString() : originalState.consentCapturedAt,
    pendingPrompt: nextPendingPrompt,
    rollingSummary: (originalState.rollingSummary + '\nCustomer: ' + maskedMessage.slice(0, 1_000)).trim().slice(-4_000),
    messageSequence: originalState.messageSequence + 1, summaryRevision: originalState.summaryRevision + 1,
    lastTurnAt: userMessage.createdAt };
  session.conversationState = state;
  const at = new Date().toISOString();
  const requirementGoal = catalogV2?.sheets.BusinessGoals.find(goal => goal.active
    && goal.businessGoalKey === selectedV2Goal) ?? null;
  const greetingTurn = /^(?:hello|hi|hey|good\s+(?:morning|afternoon|evening))\b/iu.test(maskedMessage);
  const documentQuestion = /\b(?:document|documents|passport|identity|upload|provide|next)\b/iu.test(maskedMessage);
  // Advisory/knowledge-only turns cannot activate a business journey. A new
  // prompt must be tied to observed, validated business-goal planning.
  const shouldPrompt = Boolean(catalogV2 && requirementGoal?.confirmationRequired
    && !intentDocument?.goalConfirmed && !pendingDecision && !decision && !greetingTurn
    && (commercialDocumentRequest || (quoteContinuationRequest && /\bquotation\b/iu.test(result.response.nextQuestion ?? '')) || (validPlan
      && (planningDecision?.score?.thresholdMet || semanticGoalCandidate) && !planningDecision?.score?.ambiguous
      && intentEvidence?.initiation === 'explicit'
      && intentEvidence.ambiguous === false
      && (semanticGoalCandidate || (intentEvidence.initiationSupported === true
        && intentEvidence.candidateGoalKeys.length === 1
        && intentEvidence.candidateGoalKeys[0] === selectedV2Goal)))));
  let goalConfirmation: GoalConfirmationRecord | null = previousDecision;
  let goalConfirmed = Boolean(intentDocument?.goalConfirmed);
  let nextGoalKey = intentDocument?.goalConfirmed ? intentDocument.businessGoalKey : selectedV2Goal;
  let effectiveAnswer = result.response.answer;
  let effectiveQuestion = result.response.nextQuestion;
  let overrideResponse = false;
  const packageSummaryRequest = isPackageSummaryRequest(maskedMessage);
  const packageFallbackCandidate = packageIntent && !acceptedOfferOption && packageOptions && packageOptions.length > 0
    && approvedKnowledge.length > 0
    && packageSummaryRequest
    && result.response.citationIds.length === 0
    && !['model_or_tool_unavailable', 'grounding_review_rejected'].includes(result.guardReason)
    ? buildPackageEvidenceFallback(maskedMessage, packageOptions, approvedKnowledge) : null;
  const packageFallback = packageFallbackCandidate
    ? guardPackageEvidenceFallback(persona, packageFallbackCandidate, approvedKnowledge) : null;
  if (packageFallback) {
    effectiveAnswer = packageFallback.answer;
    effectiveQuestion = packageFallback.nextQuestion;
  }
  // Contact details are not collected or used before the customer confirms the
  // business goal, but they still deserve a truthful privacy-safe response.
  const contactSubmittedBeforeGoalConfirmation = Object.keys(contactFromMessage).length > 0
    && !contactActive && !goalConfirmed && Boolean(pendingDecision || selectedV2Goal);
  if (contactSubmittedBeforeGoalConfirmation) {
    const goalName = catalogV2?.sheets.BusinessGoals.find(goal =>
      goal.businessGoalKey === (pendingDecision?.goalKey ?? selectedV2Goal))?.name ?? 'company formation';
    effectiveAnswer = `I can collect contact details once you confirm ${goalName.toLowerCase()}. I have not used them for any action. Would you like to proceed with ${goalName.toLowerCase()}?`;
    effectiveQuestion = `Would you like to proceed with ${goalName.toLowerCase()}?`;
    overrideResponse = true;
  }
  if (leadSubmissionUnavailable) {
    if (leadProviderUnavailable && (leadActionConfirmed || leadActionRequested)) {
      effectiveAnswer = 'The Salesforce connection for this development tenant is not ready. I have not submitted the Lead, and your information remains saved in this conversation.';
      effectiveQuestion = null;
    } else if (leadProviderUnavailable) {
      effectiveAnswer = 'I’ve recorded your contact consent, but Salesforce Lead submission is not ready for this development tenant. I have not created or submitted a Lead.';
      effectiveQuestion = null;
    } else {
      effectiveAnswer = 'I have your contact consent. Before I submit the Lead, please explicitly confirm that you want me to submit it.';
      effectiveQuestion = 'Please explicitly confirm that you want me to submit the Lead.';
    }
    overrideResponse = true;
  }
  if (pendingDecision) {
    const goalName = pendingGoalName;
    if (decision === 'confirmed') {
      goalConfirmed = true;
      nextGoalKey = pendingDecision.goalKey;
      goalConfirmation = { ...pendingDecision, status: 'confirmed', customerMessageId: userMessage.id,
        customerClientMessageId: input.clientMessageId, decidedAt: at,
        decisionSessionRevision: sessionRevision, decisionIntentRevision: intentDocument!.revision };
      effectivePendingRequirement = nameRequirementKey ?? 'lead_contact_name';
      effectiveAnswer = `Understood. We’ll focus on ${goalName}. I’ll first register your enquiry, then guide you through the approved packages and quote. What full name should I use for the Lead?`;
      effectiveQuestion = 'What full name should I use for the Lead?';
      overrideResponse = true;
    } else if (decision === 'rejected' || decision === 'corrected') {
      goalConfirmed = false;
      nextGoalKey = null;
      goalConfirmation = { ...pendingDecision, status: decision, customerMessageId: userMessage.id,
        customerClientMessageId: input.clientMessageId, decidedAt: at,
        decisionSessionRevision: sessionRevision, decisionIntentRevision: intentDocument!.revision };
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
    const requestedDocument = documentQuestion
      ? catalogV2!.sheets.DocumentPolicies.find(policy => policy.goalKey === selectedV2Goal && policy.required && policy.enabled)
      : null;
    const preserveQuoteContinuation = quoteContinuationRequest && /\bquotation\b/iu.test(result.response.nextQuestion ?? '');
    if (preserveQuoteContinuation) {
      effectiveQuestion = result.response.nextQuestion ?? effectiveQuestion;
      effectiveAnswer = result.response.answer;
      overrideResponse = false;
    } else effectiveAnswer = requestedDocument
      ? `For ${requirementGoal.name}, the current journey includes a required identity document step. I can collect it after you confirm the enquiry. ${effectiveQuestion}`
      : `I can help with ${requirementGoal.name.toLowerCase()}. Before we collect documents, I’ll register your enquiry, gather the necessary details, then show you the approved package options and prepare the quote. ${effectiveQuestion}`;
    if (!preserveQuoteContinuation) overrideResponse = true;
  }
  if (greetingTurn && !intentDocument?.goalConfirmed && !pendingDecision && !isV2FactualKnowledgeQuestion(maskedMessage)) {
    const goalLabel = requirementGoal?.name ?? 'your options';
    effectiveAnswer = `Hello! I can help you explore ${goalLabel}. What would you like to understand first?`;
    effectiveQuestion = 'What would you like to understand first?';
    overrideResponse = true;
  }
  if (pendingDecision && !overrideResponse
      && (selectedTurnCategory === 'service_status_support'
        || /\b(?:current status|without (?:crm|salesforce))\b/iu.test(maskedMessage))) {
    effectiveAnswer = 'Your company-formation enquiry is still exploratory; no Lead or CRM action has been submitted. Would you like to proceed with company formation?';
    effectiveQuestion = 'Would you like to proceed with company formation?';
    overrideResponse = true;
  }
  if (contactActive && !pendingDecision && !leadSubmissionUnavailable && (Object.keys(contactFromMessage).length > 0 || contactDecision)) {
    if (!contactValues.name) {
      effectiveAnswer = 'I’m ready to record this enquiry. What name should I use?';
      effectiveQuestion = 'What name should I use?';
    } else if (!contactValues.email && !contactValues.phone) {
      effectiveAnswer = 'Thanks, I’ve noted the name for this enquiry. What email address or phone number should I use?';
      effectiveQuestion = 'What email address or phone number should I use?';
    } else if (contactConsent !== 'granted') {
      effectiveAnswer = 'Thanks, I’ve noted the contact details. Do I have your permission to use them for this company-formation enquiry?';
      effectiveQuestion = 'Do I have your permission to use them for this company-formation enquiry?';
    } else {
      effectiveAnswer = 'Thanks, I’ve recorded your contact consent. When you are ready, please explicitly confirm that you want me to submit the Lead.';
      effectiveQuestion = 'Would you like me to submit the Lead?';
    }
    overrideResponse = true;
  }
  // A pending document requirement is authoritative context. If the model or
  // response guard cannot produce a useful handoff, ask for that requirement
  // directly instead of repeating the generic grounding fallback.
  const documentStageKey = intentDocument?.currentStageKey ?? entry?.lifecycle?.currentStage ?? null;
  const activeDocumentRequirement = resolveDocumentRequirement(catalogV2, intentDocument?.businessGoalKey ?? selectedV2Goal, documentStageKey, effectivePendingRequirement);
  if (activeDocumentRequirement) effectivePendingRequirement = activeDocumentRequirement;
  const pendingDocumentRequirement = Boolean(activeDocumentRequirement);
  const documentAnswer = /\b(?:document|passport|identity|upload)\b/iu.test(effectiveAnswer);
  if (catalogV2 && intentDocument?.goalConfirmed && pendingDocumentRequirement && documentQuestion
      && (!documentAnswer || result.guardReason !== 'accepted')) {
    const label = /identity/iu.test(effectivePendingRequirement ?? '') ? 'identity document' : 'required document';
    effectiveAnswer = `To continue your company-formation enquiry, please provide your ${label}. You can upload it here when you’re ready.`;
    effectiveQuestion = 'Would you like to upload it now?';
    overrideResponse = true;
  }
  // Persist only facts that Node already verified in its session/intent store.
  // Never promote model-generated facts to verified customer facts.
  const proposedFacts = validPlan && selectedV2Goal && modelPlan
    && decision !== 'confirmed' && decision !== 'rejected' && decision !== 'corrected'
    ? validateQuotedV2CustomerFacts(modelPlan.proposedFacts ?? [], maskedMessage, userMessage.id, state.messageSequence)
    : {};
  const extractedFacts = selectedV2Goal
    && decision !== 'confirmed' && decision !== 'rejected' && decision !== 'corrected'
    ? extractQuotedV2CustomerFacts(maskedMessage, userMessage.id, state.messageSequence)
    : {};
  const acceptedCustomerFacts = { ...extractedFacts, ...proposedFacts };
  const currentCustomerFacts = { ...(intentDocument?.verifiedFacts ?? {}), ...acceptedCustomerFacts };
  const factLabels: Record<string, string> = { visa_count: 'your visa requirement', timeline: 'your requested start timeline', business_activity: 'your business activity', entity_type: 'your company structure' };
  const factSummary = Object.entries(currentCustomerFacts).map(([key, value]) => `${factLabels[key] ?? key} as ${value.maskedValue}`);
  const isRecap = /\b(?:recap|summari[sz]e|what did i tell)\b/iu.test(maskedMessage);
  if (pendingDecision && decision !== 'confirmed' && decision !== 'rejected' && decision !== 'corrected'
      && ((isRecap && factSummary.length > 0)
        || (Object.keys(acceptedCustomerFacts).length > 0
          && !isV2FactualKnowledgeQuestion(maskedMessage)))) {
    const changed = Object.keys(acceptedCustomerFacts).filter(key => intentDocument?.verifiedFacts[key]?.maskedValue !== acceptedCustomerFacts[key]!.maskedValue);
    const values = (isRecap ? Object.entries(currentCustomerFacts) : changed.map(key => [key, acceptedCustomerFacts[key]!] as const))
      .map(([key, value]) => `${factLabels[key] ?? key} as ${value.maskedValue}`);
    const verb = changed.length > 0 ? 'updated' : 'noted';
    effectiveAnswer = isRecap
      ? `Here’s what I have noted: ${values.join('; ')}. Would you like to proceed with ${pendingGoalName}?`
      : `Thanks, I’ve ${verb} ${values.join(' and ')}. Would you like to proceed with ${pendingGoalName}?`;
    effectiveQuestion = `Would you like to proceed with ${pendingGoalName}?`;
    overrideResponse = true;
  }
  if (pendingDecision && decision !== 'confirmed' && decision !== 'rejected' && decision !== 'corrected' && !overrideResponse) {
    if (/\b(?:prefer|would like|want)\b[\s\S]{0,50}\b(?:advisor|adviser)\b/iu.test(maskedMessage)) {
      effectiveAnswer = `Of course. I’ve noted that you prefer to speak with an adviser. Would you like to proceed with ${pendingGoalName}?`;
      effectiveQuestion = `Would you like to proceed with ${pendingGoalName}?`;
      overrideResponse = true;
    } else if (/\b(?:do not|don’t|don't)\b[\s\S]{0,60}\b(?:disclose|share)\b[\s\S]{0,60}(?:\bcustomer\b|\binformation\b|\bother\b|\[(?:ID|EMAIL|PHONE)_\d+\])/iu.test(maskedMessage)) {
      effectiveAnswer = `Understood. I won’t disclose information about other customers. Would you like to proceed with ${pendingGoalName}?`;
      effectiveQuestion = `Would you like to proceed with ${pendingGoalName}?`;
      overrideResponse = true;
    } else if (/\b(?:consent|permission)\b/iu.test(maskedMessage)) {
      effectiveAnswer = `I’ve noted your contact preference. It will not authorize any action until you confirm ${pendingGoalName}. Would you like to proceed with ${pendingGoalName}?`;
      effectiveQuestion = `Would you like to proceed with ${pendingGoalName}?`;
      overrideResponse = true;
    } else if (/\bbudget\b[\s\S]{0,40}\b(?:not fixed|uncertain|undecided|open)\b/iu.test(maskedMessage)) {
      effectiveAnswer = `I’ve noted that your budget is not fixed yet. We can keep exploring the approved options without treating a budget as confirmed. Would you like to proceed with ${pendingGoalName}?`;
      effectiveQuestion = `Would you like to proceed with ${pendingGoalName}?`;
      overrideResponse = true;
    } else if (result.guardReason === 'policy_denied' && /\bpackage(?:s)?\b/iu.test(maskedMessage)) {
      effectiveAnswer = `I can’t provide a reliable package summary from the approved sources yet, so I won’t guess. Would you like to proceed with ${pendingGoalName}?`;
      effectiveQuestion = `Would you like to proceed with ${pendingGoalName}?`;
      overrideResponse = true;
    }
  }
  const contactFactPatch = contactActive ? {
    ...(contactValues.name && nameRequirementKey ? { [nameRequirementKey]: {
      maskedValue: contactValues.name, source: 'visitor' as const, messageSequence: state.messageSequence,
      evidenceRefs: ['customer-message:' + userMessage.id], corrected: false,
    } } : {}),
    ...((contactValues.email || contactValues.phone) && channelRequirementKey ? { [channelRequirementKey]: {
      maskedValue: contactValues.email ?? contactValues.phone!, source: 'visitor' as const, messageSequence: state.messageSequence,
      evidenceRefs: ['customer-message:' + userMessage.id], corrected: false,
    } } : {}),
    ...(contactDecision === 'granted' && resolvedConsentRequirementKey ? { [resolvedConsentRequirementKey]: {
      maskedValue: 'true', source: 'visitor' as const, messageSequence: state.messageSequence,
      evidenceRefs: ['customer-message:' + userMessage.id], corrected: false,
    } } : {}),
  } : {};
  const actionConfirmationFactPatch = (actionProposalRequested || leadActionConfirmed) && actionConfirmationRequirementKey ? {
    [actionConfirmationRequirementKey]: {
      maskedValue: 'true', source: 'visitor' as const, messageSequence: state.messageSequence,
      evidenceRefs: ['customer-message:' + userMessage.id], corrected: false,
    },
  } : {};
  const incomingFacts = { ...(intentDocument?.verifiedFacts ?? {}), ...factPatch(facts as Record<string, string>, state.messageSequence), ...contactFactPatch, ...actionConfirmationFactPatch, ...acceptedCustomerFacts };
  const effectiveCitationIds = overrideResponse ? [] : packageFallback?.citationIds ?? result.response.citationIds;
  const citations = overrideResponse ? [] : packageFallback ? await resolvePublicCitations(store, tenant.id, effectiveCitationIds, approvedKnowledge) : modelCitations;
  const grounded = !overrideResponse && (Boolean(packageFallback) || (effectiveCitationIds.length > 0 && !result.guardReason.startsWith('safe_no_evidence')));
  const packageSelectionReady = Boolean(crmLead?.leadId && crmLead.remoteCrm && contactConsent === 'granted');
  let answerMasked = maskPiiForSession(session, effectiveAnswer, input.tokenVault);
  assertKnownTokens(session, answerMasked, input.tokenVault);
  let approvedResponse = { answer: answerMasked, grounded, citationRefs: effectiveCitationIds,
    pendingRequirementKey: effectivePendingRequirement };
  const verifiedFactPatch: Record<string, UserIntentFact> = Object.fromEntries(
    Object.entries(incomingFacts).filter(([key, value]) =>
      !intentDocument?.verifiedFacts[key] || intentDocument.verifiedFacts[key]?.maskedValue !== value.maskedValue)
      .map(([key, value]) => [key, { ...value, corrected: Boolean(intentDocument?.verifiedFacts[key]) }]),
  );
  let nextDoc: UserIntentDocument = intentDocument ? {
    ...intentDocument, approvedResponse, lastQuestion: effectiveQuestion,
    verifiedFacts: { ...intentDocument.verifiedFacts, ...verifiedFactPatch },
    businessGoalKey: intentDocument.catalogSource === 'v2' ? nextGoalKey : intentDocument.businessGoalKey,
    goalConfirmed: intentDocument.catalogSource === 'v2' ? goalConfirmed : intentDocument.goalConfirmed,
    goalConfirmation: intentDocument.catalogSource === 'v2' ? goalConfirmation : intentDocument.goalConfirmation ?? null,
    turnIntentKey: intentDocument.catalogSource === 'v2' ? (nextGoalKey ? selectedTurnIntent ?? intentDocument.turnIntentKey : null) : intentDocument.turnIntentKey,
    pendingRequirementKey: effectivePendingRequirement,
    toolRefs: result.toolTrace.map(trace => trace.toolCallId),
    sourceRefs: [...effectiveCitationIds, ...catalogSignalRefs], summary: state.rollingSummary,
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
    toolRefs: result.toolTrace.map(trace => trace.toolCallId), sourceRefs: [...effectiveCitationIds, ...catalogSignalRefs],
    summary: state.rollingSummary, summaryRevision: 1, revision: 0, createdAt: at, updatedAt: at,
  };
  // Initialize an opportunity only after a customer has explicitly confirmed
  // the goal. Persist the journey, lifecycle, intent cursor, and both messages
  // in the same authoritative V2 transaction. Do not authorize an action.
  const bootstrap = initializeConfirmedV2Journey(state, nextDoc);
  if (bootstrap.created) {
    session.conversationState = bootstrap.state;
    nextDoc = bootstrap.document;
  }
  if (contactActive && nextDoc.businessGoalKey) {
    const contactEntry = bootstrap.state.intentProgress?.entries[nextDoc.businessGoalKey];
    if (contactEntry) contactEntry.slotValues = { ...(contactEntry.slotValues ?? {}), ...contactSlots, ...(contactDecision ? { contact_consent: contactDecision === 'granted' ? 'true' : 'false' } : {}) };
  }
  let confirmedAction: Awaited<ReturnType<ActionGateway['confirm']>> | null = null;
  if (leadActionConfirmed && !leadSubmissionUnavailable && input.actionGateway && nextDoc.opportunityId) {
    const pendingAction = (await store.listActionsBySession(session.id, tenant.id))
      .find(action => action.opportunityId === nextDoc.opportunityId && action.actionKey === 'lead.create' && action.state === 'awaiting_confirmation');
    if (pendingAction) confirmedAction = await input.actionGateway.confirm(pendingAction.id, tenant.id, undefined, { deferPersistence: true });
  }
  let actionDecision: Awaited<ReturnType<typeof proposeV2CatalogAction>> | null = null;
  if (actionProposalRequested && input.actionGateway && proposedActionToolKey && proposedActionBinding && v2Version && nextDoc.opportunityId && nextDoc.businessGoalKey) {
    const reusable = priorActions
      .filter(action => action.opportunityId === nextDoc.opportunityId && action.actionKey === proposedActionToolKey
        && !['failed', 'reconcile_required'].includes(action.state))
      .sort((left, right) => (right.actionRevision ?? 1) - (left.actionRevision ?? 1))[0] ?? null;
    const actionRevision = reusable?.actionRevision ?? Math.max(0, ...priorActions
      .filter(action => action.opportunityId === nextDoc.opportunityId && action.actionKey === proposedActionToolKey)
      .map(action => action.actionRevision ?? 1)) + 1;
    const actionSession: Session = { ...session, conversationState: bootstrap.state };
    const purposeScope = v2ActionConsentScope({ catalogVersionId: v2Version.catalogVersionRef }, proposedActionToolKey);
    const context = contextForConfirmedV2Action({
      session: actionSession, document: nextDoc, catalog: v2Version,
      expectedActionRevision: actionRevision, purposeConsentGranted: state.consentVersion === purposeScope,
      purposeConsentScope: state.consentVersion === purposeScope ? purposeScope : null,
    });
    if (context) {
      const factValue = (key: string): string => nextDoc.verifiedFacts[key]?.maskedValue ?? '';
      actionDecision = await proposeV2CatalogAction({
        schemaVersion: 2, toolKey: proposedActionToolKey, goalKey: nextDoc.businessGoalKey,
        stageKey: nextDoc.currentStageKey ?? 'lead_generation', actionRevision,
        arguments: {
          lead_contact_name: factValue(nameRequirementKey ?? 'lead_contact_name'),
          lead_contact_channel: factValue(channelRequirementKey ?? 'lead_contact_channel'),
          lead_crm_consent: true, lead_action_confirmation: true,
        },
      }, catalogV2!, context, { gateway: input.actionGateway, store });
    }
  }
  if (leadActionConfirmed && !leadSubmissionUnavailable) {
    effectiveAnswer = confirmedAction
      ? 'Thanks — I’ve confirmed the Lead submission and sent it for processing. I’ll report the result after Salesforce is independently verified.'
      : 'I couldn’t find a pending Lead submission to confirm. I have not submitted anything.';
    effectiveQuestion = null;
    overrideResponse = true;
    answerMasked = maskPiiForSession(session, effectiveAnswer, input.tokenVault);
    assertKnownTokens(session, answerMasked, input.tokenVault);
    approvedResponse = { answer: answerMasked, grounded: false, citationRefs: [], pendingRequirementKey: effectivePendingRequirement };
    nextDoc.approvedResponse = approvedResponse;
    nextDoc.lastQuestion = effectiveQuestion;
  }
  const preserveGreetingFollowUp = greetingTurn && !pendingDecision && !intentDocument?.goalConfirmed && result.guardReason === 'accepted';
  const packageOfferOptions = packageFollowUpOptions(packageOptions ?? []);
  const packageSelectionQuestion = /\bwhich\s+package\s+would\s+you\s+like\s+to\s+explore\s+first\?/iu.test(effectiveQuestion ?? '');
  const followUpOptions = packageOfferOptions.length > 0 && packageSelectionQuestion
    ? packageOfferOptions
    : preserveGreetingFollowUp || !overrideResponse ? result.draft?.followUpOptions ?? [] : [];
  state.pendingFollowUpOffer = followUpOptions.length > 0 && effectiveQuestion
    ? { offerKey: randomUUID(), intentKey: state.selectedIntentKey, sourceMessageId: responseId, sourceQuery: contextualizedQuery, options: followUpOptions, issuedAt: at, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
    : acceptedOfferOption || offerReply?.action === 'reject' || offerReply?.action === 'new_request' ? null : activeFollowUpOffer;
  assertSafeUserIntentDocument(nextDoc);
  const assessment = { id: randomUUID(), documentId: nextDoc.id, tenantId: tenant.id, sessionId: session.id,
    opportunityId: nextDoc.opportunityId, turnSequence: state.messageSequence, clientMessageId: input.clientMessageId,
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
  const response = {
    messageId: responseId, sessionId: session.id, answer: rehydrateForSession(session, answerMasked, input.tokenVault),
    grounded, conversational: !grounded, citations,
    packageOptions,
    packageSelectionReady,
    consentProposal: contactActive && contactConsent !== 'granted' && Boolean(contactValues.name && (contactValues.email || contactValues.phone)) ? {
      id: responseId, intent: 'contact.consent', consentRequired: true,
      confirmation: 'May I use these contact details for your company-formation enquiry?',
      expiresAt: new Date(Date.parse(at) + 15 * 60_000).toISOString(),
    } : null,
    actionProposal: actionDecision?.accepted && actionDecision.action ? {
      id: actionDecision.action.id, intent: actionDecision.action.workflowKey, consentRequired: false,
      confirmation: 'Your Lead submission is ready to confirm.',
      expiresAt: new Date(Date.parse(actionDecision.action.createdAt) + 15 * 60_000).toISOString(),
    } : null,
    pendingPromptId: goalConfirmation?.status === 'pending' ? goalConfirmation.promptId : nextPendingPrompt?.id ?? null, pendingIntentKey: nextDoc.businessGoalKey,
    pendingRequirementKey: effectivePendingRequirement, requestId: input.requestId,
  };
  const assistantMessage: Message = { id: responseId, sessionId: session.id, tenantId: tenant.id, role: 'assistant',
    maskedContent: answerMasked, citations, clientMessageId: null,
    response: { conversational: !grounded, catalogVersionId: catalog.id, catalogIntentKey: activeGoal, catalogOpportunityId: nextDoc.opportunityId },
    createdAt: at };
  const persisted = { ...response, answer: answerMasked };
  const answeredCustomerMessage: Message = { ...userMessage, response: persisted };
  if (catalogV2) {
    try {
      const committed = await store.commitV2IntentTurn({ session, document: nextDoc,
        expectedDocumentRevision: intentDocument?.revision ?? null, assessment, audit: decisionAudit,
        assistantMessage, customerMessage: answeredCustomerMessage,
        ...(confirmedAction?.state === 'approved' ? { actionApproval: confirmedAction } : {}) });
      session.stateVersion = committed.session.stateVersion ?? sessionRevision + 1;
    } catch (error) {
      // A proposal is not dispatchable until this V2 turn commits. If the
      // optimistic commit loses a race, leave no executable orphan behind.
      if (actionDecision?.action && ['awaiting_confirmation', 'awaiting_customer'].includes(actionDecision.action.state)) {
        await store.updateAction({ ...actionDecision.action, state: 'failed', result: null });
      }
      throw error;
    }
  } else {
    await input.updateSession(session);
    if (intentDocument) {
      const updated = await store.updateUserIntentDocument({ document: nextDoc, expectedRevision: intentDocument.revision });
      if (!updated) throw new HttpError(409, 'V2_INTENT_REVISION_CONFLICT', 'The intent document changed concurrently.');
    } else await store.createUserIntentDocument(nextDoc);
    await store.appendIntentTurn(assessment);
    await store.addMessage(assistantMessage);
    await store.updateMessage(answeredCustomerMessage);
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
        proposalValid: validPlan,
        goalThresholdMet: planningDecision?.score?.thresholdMet ?? false,
        goalAmbiguous: planningDecision?.score?.ambiguous ?? false,
        initiationSupported: intentEvidence?.initiationSupported ?? false,
        contextSupported: intentEvidence?.contextSupported ?? false,
        contextAnchorMessageId: intentEvidence?.contextAnchorMessageId ?? null,
        validatedSignalIds: (planningDecision?.validatedSignalIds ?? []).slice(0, 32).join(',').slice(0, 600),
        rejectedSignalIds: (planningDecision?.rejectedSignalIds ?? []).slice(0, 32).join(',').slice(0, 600),
        validatedTopicKeys: (planningDecision?.validatedTopicKeys ?? []).slice(0, 16).join(',').slice(0, 600),
        rejectedTopicKeys: (planningDecision?.rejectedTopicKeys ?? []).slice(0, 16).join(',').slice(0, 600),
        goalPromptEligible: shouldPrompt,
        goalPromptHasRequiredCatalogGoal: Boolean(requirementGoal?.confirmationRequired),
        goalPromptValidPlan: validPlan,
        goalPromptSelectedCategory: selectedTurnCategory,
        goalPromptSelectedGoal: selectedV2Goal,
        goalPromptIntentCandidate: intentEvidence?.candidateGoalKeys[0] ?? null,
        goalPromptIntentDecision: decision,
        goalPromptPendingBeforeTurn: Boolean(pendingDecision),
        goalPromptDocumentConfirmed: Boolean(intentDocument?.goalConfirmed),
        goalConfirmationPending: goalConfirmation?.status === 'pending',
        goalConfirmed,
        acceptedCustomerFactKeys: Object.keys(acceptedCustomerFacts).join(','),
        score: planningDecision?.score?.evidenceScore ?? null,
        modelConfidenceBand: modelPlan.confidenceBand,
        proposedToolKey: modelPlan.proposedToolKey,
        validatedReadToolKey: validPlan ? planningDecision?.proposedToolKey ?? null : null,
        reasons: planningDecision?.reasons.join(',').slice(0, 600) ?? '',
        actionAuthorized: Boolean(actionDecision?.accepted), actionProposalStatus: actionDecision?.status ?? null,
        actionProposalReasons: actionDecision?.reasons.join(',') ?? '' }, createdAt: at });
  }


  const responseCacheKey = cacheKey('tenant', tenant.id, 'chat-response', session.id, hash(input.clientMessageId));
  await input.cache.set(responseCacheKey, { messageHash: input.messageHash, response: persisted }, input.responseCacheTtlSeconds);
  try {
    await contextCache.set({ tenantId: tenant.id, sessionId: session.id, opportunityId: nextDoc.opportunityId,
      catalogVersionId: catalog.id, personaVersionId: persona.id, stateRevision: session.stateVersion ?? sessionRevision + 1,
      summary: state.rollingSummary, recentTurns: [...priorMessages, userMessage, assistantMessage].map(message => ({ role: message.role, content: message.maskedContent })), createdAt: session.createdAt });
  } catch {
    // Redis is an accelerator; the committed PostgreSQL session remains authoritative.
  }
  await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: null, eventName: 'v2.gpt_first.turn',
    metadata: { sessionId: session.id, clientMessageId: input.clientMessageId,
      catalogVersionId: catalog.id, personaVersionId: persona.id, modelRequestCount: result.modelRequestCount,
      toolCallCount: result.toolCallCount, guardReason: result.guardReason,
      // Counts and decision codes only. Never persist model draft text or RAG excerpts
      // in audit metadata; those may contain personal data or unsafe instructions.
      candidateGuardReason: result.candidateGuardReason ?? null,
      questionFailureReason: result.questionFailureReason ?? null,
      knowledgeRepairStatus: result.knowledgeRepairStatus ?? null,
      groundingReviewStatus: result.groundingReviewStatus ?? null,
      groundingLexicalOverlapPercent: result.groundingLexicalOverlapPercent ?? null,
      initialClaimFailureReason: result.initialClaimFailureReason ?? null,
      initialFailedClauseOrdinal: result.initialFailedClauseOrdinal ?? null,
      repairCitationCount: result.repairCitationCount ?? null,
      repairFailureReason: result.repairFailureReason ?? null,
      repairClaimFailureReason: result.repairClaimFailureReason ?? null,
      repairFailedClauseOrdinal: result.repairFailedClauseOrdinal ?? null,
      prefetchEvidenceCount: approvedKnowledge.length,
      validatedEvidenceCount: result.approvedEvidence?.length ?? 0,
      candidateCitationCount: result.candidateResponse?.citationIds.length ?? 0,
      responseCitationCount: result.response.citationIds.length,
      failedReadToolCount: result.toolTrace.filter(trace => trace.status !== 'ok').length,
      fallbackApplied: ['fallback-', 'offline-', 'guard-fallback-', 'no-evidence-', 'missing-knowledge-']
        .some(prefix => result.response.decisionRef?.startsWith(prefix)),
      executionPath: 'langgraph' }, createdAt: at });
  return response;
};

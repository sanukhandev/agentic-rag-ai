import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ActionGateway, isSafeExternalReference, leadQuality, verifyN8nPayload, type WorkflowAdapter } from './actions.js';
import { AuthService, authMiddleware, ensureTenant, requireRoles, type AuthedRequest } from './auth.js';
import { cacheKey, createCache, Singleflight, type CacheStore } from './cache.js';
import { channelAuthMiddleware, ChannelSecretVault, getChannel, type StaticChannelAuth } from './channel-auth.js';
import { buildChunksWithEmbeddings, buildIngestionChunksWithEmbeddings, hasConflictingEvidence, KnowledgeRetrievalError, retrieveApprovedKnowledge } from './knowledge.js';
import { DeterministicEmbeddingProvider, type EmbeddingProvider } from './embedding.js';
import { addressesKnowledgeQuestion, classifyOfferReply, conversationalIntent, conversationalReply, DeterministicGroundedModel, detectedLanguage, extractLeadData, hasLeadIntent, hasSufficientEvidence, isCatalogSlotNonAnswer, isContextualReply, isControlledKnowledgeAbstention, isGuidedResponse, isKnowledgeQuestion, isPermittedLanguage, isSafeContinuityAnswer, leadCollectionReply, mergeLeadData, naturalAbstention, needsConversationContext, normalizeConversationQuery, normalizePendingLeadName, openingGreeting, permittedLanguageReply, preservesNormalizationFacts, validateCitations, type ChatModel, type ModelDraft, type ModelEvidence, type QueryNormalizationInput } from './model.js';
import { assertKnownTokens, maskPii, maskPiiForSession, rehydrateForSession, redactUnknownTokens, sanitizeKnowledgeText, sanitizeSensitiveText, TokenVault } from './privacy.js';
import { catalogIntentClarification, catalogIntentLabel, catalogNextFollowUpRequirement, catalogRequirementLabel, catalogSlotLabel, catalogSlotQuestion, isCrmWriteBinding, journeyDocumentMatchesRequirement, resolveIntent, resolveIntentContinuity, validateIntentCatalog } from './intent-catalog.js';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2 } from './conversation/catalog.js';
import { auditLegacyCatalogVersion, createLegacyCatalogV2Candidate } from './conversation/catalog-migration.js';
import { validatePublishedCatalogV2 } from './conversation/catalog-runtime.js';
import { reduceIntentJourney } from './intent-journey.js';
import { completeLifecycleStage, newLifecycleState } from './lifecycle-state.js';
import { normalizeFullTextQuery } from './search-query.js';
import { exportIntentCatalogWorkbook } from './intent-catalog-xlsx.js';
import { exportCatalogV2Workbook } from './conversation/catalog-xlsx.js';
import { composeConversationSummary, consentVersionForState, mergeConcurrentConversationState, mergeWorkflowCallbackState, newConversationState, phaseFor, prompt } from './conversation-state.js';
import { createOutboxEvent } from './events.js';
import { MemoryStore, contentHash } from './store-memory.js';
import { hasValidFileSignature, IngestionStaging, MAX_INGESTION_FILE_BYTES } from './ingestion-staging.js';
import { composeAdminDocumentDetails, composeDocumentMetadata, composeDocumentSummary, DEFAULT_DOCUMENT_MIME_TYPES, documentSha256, hasSupportingDocumentSignature, MAX_DOCUMENT_BYTES, PrivateDocumentStorage } from './document-intake.js';
import { requiredDocumentSetComplete } from './document-stage-evidence.js';
import { buildV2DocumentProviderRequest, DeterministicV2DocumentProvider, validateV2DocumentProviderResult } from './conversation/document-provider.js';
import { buildV2AccountProviderRequest, DeterministicV2AccountProvider, DurableV2OtpChallengeService, V2OtpChallengeService, validateV2AccountProviderResult } from './conversation/account-provider.js';
import { buildV2LeadProviderRequest, DeterministicV2LeadProvider, validateV2LeadProviderResult } from './conversation/lead-provider.js';
import { SalesforceSandboxLeadProvider, type SalesforceSandboxAccountReadbackProvider, type SalesforceSandboxLeadMutationProvider, type SalesforceSandboxLeadReadbackProvider } from './salesforce-sandbox-lead-provider.js';
import { buildV2PaymentProviderRequest, DeterministicV2PaymentProvider, validateV2PaymentProviderResult } from './conversation/payment-provider.js';
import { HttpLiveBillingReadbackProvider, verifyLiveInvoiceReadback, verifyLivePaymentReadback, type LiveBillingReadbackProvider } from './conversation/billing-readback.js';
import { buildV2ContractProviderRequest, DeterministicV2ContractProvider, validateV2ContractProviderResult } from './conversation/contract-provider.js';
import { contactCompletenessScore, isValidLeadEmail, isValidLeadName, isValidLeadPhone, scoreCrmLead } from './crm-scoring.js';
import { CrmSummaryValidationError, formatCrmSummarySpec } from './crm-summary.js';
import { assertPiiVaultSecret } from './runtime-security.js';
import { validateV2ProviderCorrelation, v2ProviderCorrelationSchema, v2CallbackCorrelationSchema, type V2ProviderCorrelation } from './conversation/provider-correlation.js';
import type { ActionExecution, ActionRequest, ActionState, ChannelCredential, CrmLead, DocumentProcessingJob, FollowUpOfferOption, IngestionJob, IngestionJobStatus, IntentCatalogQualityRule, IntentCatalogSlot, LeadData, LifecycleStage, Message, PendingFollowUpOffer, Session, SourceStatus, Store, SupportingDocument } from './types.js';
import { HttpError, parse } from './http/errors.js';
import {
  DEFAULT_CONTEXT_WINDOW_MESSAGES,
  confirmSchema,
  crmAdminSummarySchema,
  crmLeadSchema,
  crmQualitySchema,
  crmQualificationSchema,
  crmRemotePayloadSchema,
  crmRemoteReconcileSchema,
  crmAccountRemoteSchema,
  crmAccountRemotePayloadSchema,
  invoiceRemoteSchema,
  paymentStatusSchema,
  contractRemoteSchema,
  invoiceRemotePayloadSchema,
  contractRemotePayloadSchema,
  crmRemoteSchema,
  crmSummarySchema,
  documentFailureSchema,
  documentRenewSchema,
  documentResultSchema,
  documentUploadSchema,
  historyQuerySchema,
  ingestionFailureSchema,
  ingestionRequestSchema,
  ingestionRenewSchema,
  ingestionResultSchema,
  ingestionArchiveResultSchema,
  intentCatalogEditSchema,
  intentCatalogResultSchema,
  intentCatalogV2Schema,
  intentCatalogV2MigrationSchema,
  intentCatalogUploadSchema,
  messageSchema,
  sessionSchema,
  sourceSchema,
  uploadSchema,
  workflowClaimSchema,
  workflowCompletionSchema,
  workflowFailureSchema,
  v2ProviderEvidenceVerifySchema,
  v2AccountOtpIssueSchema,
  v2AccountProviderEvidenceSchema,
  v2InvoiceProviderEvidenceSchema,
  v2PaymentProviderEvidenceSchema,
  v2ContractProviderEvidenceSchema,
  workflowTransitionSchema,
} from './http/schemas.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerHealthRoutes } from './routes/health.js';
import { runAgentTools, type AgentToolResult } from './agent-tools.js';
import { registerLifecycleRoutes } from './routes/lifecycle.js';
import { createDevelopmentQuoteAfterLead, hasVerifiedLiveInvoiceDelivery } from './business-lifecycle.js';
import { VocabularyLearningService } from './conversation/vocabulary.js';
import { issueV2Scope, registerV2ToolGateway, V2_TOOL_NAMES } from './conversation/tool-gateway.js';
import { V2ConversationCoordinator, conversationEngineV2EnabledForTenant } from './conversation/coordinator.js';
import { chatTurnTimeoutMs, executeV2Turn, runGPTFirstChatTurn } from './conversation/turn-controller.js';
import { evaluatePersistedV2ActionConfirmation, evaluateV2CallbackStageCompletion } from './conversation/journey-bootstrap.js';
import type { V2ApprovedFallbackTemplateSet } from './conversation/fallbacks.js';
import type { PersonaComposedResponseV2 } from './python-model/contracts.js';

type Telemetry = { requests: number; serverErrors: number; totalLatencyMs: number; lastRequestAt: string | null; chatResponses: number; groundedResponses: number; abstentions: number; actionProposals: number; estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: number | null; normalizationAttempts: number; normalizationFallbacks: number; normalizationFailures: number; normalizationLatencyMs: number };
export type RateLimitEntry = { count: number; resetAt: number };
export const pruneExpiredRateLimits = (entries: Map<string, RateLimitEntry>, now = Date.now()): void => {
  for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
};
const catalogQuality = (score: number, rule: IntentCatalogQualityRule | undefined): ReturnType<typeof leadQuality> => rule ? score >= rule.hotThreshold ? 'hot' : score >= rule.warmThreshold ? 'warm' : score >= rule.nurtureThreshold ? 'nurture' : 'new' : leadQuality(score);

// shortcut: catalog currently exposes fallback references, not template bodies; replace these with Admin-published text before production cutover.
const approvedV2FallbackTemplates = (personaVersionId: string, language: string): V2ApprovedFallbackTemplateSet => ({
  approved: true,
  personaVersionId,
  templateVersion: `fallback-${personaVersionId}`,
  language,
  templates: {
    invalid_model: 'I’m unable to use that response safely yet. I can continue with verified information.',
    tool_unavailable: 'I’m unable to retrieve the approved information right now. I can continue once it is available.',
    reconciliation: 'I need to verify the request status before I confirm the outcome.',
  },
});

const publicUser = (user: { id: string; email: string; role: string; tenantId: string | null }) => ({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });
const publicChannelCredential = (credential: ChannelCredential) => ({ id: credential.id, tenantId: credential.tenantId, channel: credential.channel, authMode: credential.authMode, keyId: credential.keyId, active: credential.active, createdAt: credential.createdAt, revokedAt: credential.revokedAt });

const errorProperty = (error: unknown, property: string): unknown => typeof error === 'object' && error !== null && property in error ? error[property as keyof typeof error] : undefined;
const errorType = (error: unknown): string | undefined => { const value = errorProperty(error, 'type'); return typeof value === 'string' ? value : undefined; };
const errorCode = (error: unknown): string | undefined => { const value = errorProperty(error, 'code'); return typeof value === 'string' ? value : undefined; };
const ingestionErrorDetail = (error: unknown): string | null => { const value = error instanceof Error ? error.message : String(error); const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); return normalized ? normalized.slice(0, 2_000) : null; };

const groundedKnowledgeFallback = (question: string, evidence: ModelEvidence[]): ModelDraft | null => {
  const normalizedQuestion = question.toLocaleLowerCase('en-US');
  const terms = normalizedQuestion.match(/[a-z]{4,}/g) ?? [];
  const packageQuestion = /\b(?:package|packages|visa|visas|price|prices|cost|costs|fee|fees)\b/u.test(normalizedQuestion);
  const processQuestion = /\b(?:step|steps|process|procedure|how|register|registration)\b/u.test(normalizedQuestion);
  const timelineQuestion = /\b(?:timeline|timelines|time|long|duration|when|month|months|week|weeks|days)\b/u.test(normalizedQuestion);
  const topicTerms = /\b(?:package|packages|visa|visas|price|prices|cost|costs|fee|fees)\b/u.test(normalizedQuestion)
    ? ['package', 'packages', 'visa', 'visas', 'price', 'prices', 'cost', 'costs', 'fee', 'fees']
    : /\b(?:step|steps|process|procedure|how|register|registration)\b/u.test(normalizedQuestion)
      ? ['step', 'steps', 'process', 'procedure', 'register', 'registration', 'application', 'formation', 'license', 'licence']
      : timelineQuestion
        ? ['timeline', 'timelines', 'time', 'duration', 'processing', 'days', 'weeks', 'months', 'start']
      : terms;
  const candidates = [...new Set(evidence.flatMap((item) => item.content.split(/(?<=[.!?])\s+|\n+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 20
    && !/answer only from approved|knowledge base|retrieval metadata|source validation|validate all prices|ingestion|do not invent|where the answer depends on/iu.test(sentence)
    && (topicTerms.some((term) => sentence.toLocaleLowerCase('en-US').includes(term)) || terms.some((term) => sentence.toLocaleLowerCase('en-US').includes(term))))))]
    .map((sentence) => ({ sentence, score: topicTerms.filter((term) => sentence.toLocaleLowerCase('en-US').includes(term)).length + terms.filter((term) => sentence.toLocaleLowerCase('en-US').includes(term)).length }))
    .filter(({ sentence }) => /^[A-Z]/u.test(sentence)
      && (!packageQuestion || /\b(?:package|packages|visa|visas|price|prices|cost|costs|fee|fees|quote|quotation)\b/u.test(sentence))
      && (!processQuestion || (/\b(?:process|procedure|register|registration|application|formation|license|licence|document|required)\b/u.test(sentence) && !/\b(?:also\s+)?offers?\b/iu.test(sentence)))
      && (!timelineQuestion || /\b(?:timeline|timelines|time|duration|processing|days?|weeks?|months?|start)\b/iu.test(sentence)))
    .filter(({ sentence }) => !processQuestion || (!/\b(?:all-inclusive|package prices?|visa issuance|investor security approval|up to \d+ visas?)\b/iu.test(sentence)
      && /\b(?:activity|activities|application|registration|register|formation|license|licence|document|documents|proposed company)\b/iu.test(sentence)))
    .sort((left, right) => right.score - left.score);
  const sentences = candidates.slice(0, 4).map(({ sentence }) => sentence);
  if (sentences.length === 0) return null;
  const safeSentences = [...new Map(sentences
    .filter((sentence) => !/[?؟]$/u.test(sentence) && !/\b(?:would you like|what would you like)\b/iu.test(sentence) && !/\||https?:\/\/|(?:\.docx|\.pdf)|\b(?:office\s+\d+|floor|tower|street|road|pending business validation|source validation|retrieval metadata|validate all prices)\b/iu.test(sentence))
    .map((sentence) => [sentence.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, ''), sentence]))
    .values()];
  if (safeSentences.length === 0) return null;
  const answer = processQuestion
    ? safeSentences.map((sentence, index) => `${index + 1}) ${sentence}`).join(' ')
    : safeSentences.join(' ');
  return { answer, citationIds: evidence.filter((item) => safeSentences.some((sentence) => item.content.includes(sentence))).map((item) => item.citation.chunkId).slice(0, 4), proposedIntent: null };
};
const INGESTION_LEASE_MS = 120_000;
const publishIngestionProgress = async (store: Store, job: IngestionJob, stage: string, processed: number, total: number, status: IngestionJobStatus = job.status, failureCode: string | null = null): Promise<void> => {
  try {
    await store.enqueueOutboxEvent(createOutboxEvent({
      eventId: randomUUID(),
      eventType: 'ingestion.progress.v1',
      tenantId: job.tenantId,
      aggregateId: job.id,
      aggregateVersion: Math.max(1, processed + 1),
      payloadRef: job.id,
      idempotencyKey: `ingestion:${job.id}:${status}:${stage}:${processed}:${failureCode ?? ''}`,
      payload: { jobId: job.id, status, stage, processed, total, errorCode: failureCode },
    }));
  } catch {
    // Job state in PostgreSQL is authoritative; Redis progress is best effort.
  }
};
export const isValidBase64 = (value: string): boolean => {
  if (value.length === 0 || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const payloadLength = value.length - padding;
  if (value.slice(0, payloadLength).includes('=')) return false;
  for (let index = 0; index < payloadLength; index += 1) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) return false;
  }
  return padding === 0 || (padding === 1 ? payloadLength % 4 === 3 : payloadLength % 4 === 2);
};

const getAuth = (req: Request) => (req as AuthedRequest).auth;
const routeParam = (req: Request, name: string): string => {
  const value = req.params[name];
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_ROUTE', 'Invalid route parameter.');
  return value;
};

export const resolveTenantForPlatformAdmin = async (store: Pick<Store, 'getTenant' | 'getTenantBySlug'>, requested: string): Promise<string> => {
  const tenant = z.string().uuid().safeParse(requested).success
    ? await store.getTenant(requested)
    : await store.getTenantBySlug(requested);
  if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  return tenant.id;
};

export const crmLeadQualityRule = async (
  store: Pick<Store, 'getIntentCatalogVersion'>,
  lead: Pick<CrmLead, 'tenantId' | 'catalogVersionId' | 'intent'>
): Promise<IntentCatalogQualityRule | undefined> => {
  if (!lead.tenantId || !lead.catalogVersionId || !z.string().uuid().safeParse(lead.catalogVersionId).success) return undefined;
  const version = await store.getIntentCatalogVersion(lead.tenantId, lead.catalogVersionId);
  return version?.catalog.qualityRules?.find((rule) => rule.intentKey === lead.intent);
};

const tenantForRequest = async (store: Store, req: Request): Promise<string> => {
  const auth = getAuth(req);
  if (auth?.role === 'platform_admin') {
    const requested = req.header('x-tenant-id') || (typeof req.query.tenantId === 'string' ? req.query.tenantId : null);
    if (requested) return resolveTenantForPlatformAdmin(store, requested);
    const firstTenant = (await store.listTenants())[0];
    if (firstTenant) return firstTenant.id;
  }
  if (!auth?.tenantId) throw new HttpError(403, 'TENANT_REQUIRED', 'A tenant-scoped identity is required.');
  return auth.tenantId;
};

const activeTenant = async (store: Store, tenantId: string) => {
  const tenant = await store.getTenant(tenantId);
  if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  if (tenant.status !== 'active') throw new HttpError(423, 'TENANT_SUSPENDED', 'This tenant is not accepting new activity.');
  return tenant;
};

const enforcePublicOrigin = (req: Request, tenant: { publicOrigin: string | null }, nodeEnv: string): void => {
  const origin = req.header('origin');
  if ((tenant.publicOrigin && origin !== tenant.publicOrigin) || (nodeEnv === 'production' && !tenant.publicOrigin)) throw new HttpError(403, 'CHAT_ORIGIN_FORBIDDEN', 'This chat channel is not authorized for the request origin.');
};

const enforcePublicChatEnabled = (req: Request, tenant: { publicChatEnabled: boolean }): void => {
  if (!getAuth(req) && !getChannel(req) && !tenant.publicChatEnabled) throw new HttpError(423, 'TENANT_UNAVAILABLE', 'This tenant is not accepting public chat.');
};

const sessionExpired = (lastActivityAt: string, closedAt: string | null, ttlMs: number): boolean => Boolean(closedAt) || !Number.isFinite(Date.parse(lastActivityAt)) || Date.parse(lastActivityAt) + ttlMs <= Date.now();
// shortcut: four characters per token is a bounded local estimate; replace with provider usage metadata when available.
const estimateTokens = (input: string): number => Math.max(1, Math.ceil(input.length / 4));

const validateSourceUrl = async (store: Store, tenantId: string, sourceUrl: string | undefined): Promise<void> => {
  if (!sourceUrl) return;
  if (!sourceUrl.startsWith('https://')) throw new HttpError(422, 'UNSAFE_SOURCE_URL', 'Only authorized HTTPS source URLs are accepted.');
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  const allowedHosts = (await store.listDomains(tenantId)).map((domain) => domain.hostname);
  if (allowedHosts.length === 0 || !allowedHosts.includes(hostname)) throw new HttpError(422, 'UNAUTHORIZED_SOURCE_HOST', 'The HTTPS source host is not allowlisted.');
};

const canonicalKnowledgeText = (input: string): string => sanitizeKnowledgeText(input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());

const crmDedupeKey = (tenantId: string, leadData: { email?: string; phone?: string }, session: Session, tokenVault: TokenVault, secret: string): string => {
  const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault, 'admin_crm');
  const email = leadData.email ? rehydrate(leadData.email).trim().toLowerCase() : '';
  const phone = leadData.phone ? rehydrate(leadData.phone).replace(/\D/g, '') : '';
  if (!email || !phone) throw new HttpError(422, 'LEAD_IDENTITY_REQUIRED', 'A lead requires both an email address and phone number.');
  const identity = `email:${email}:phone:${phone}`;
  return createHmac('sha256', secret).update(`crm-lead:${tenantId}:${identity}`).digest('hex');
};

const ensureV2LocalLead = async (input: {
  store: Store;
  action: ActionRequest;
  session: Session;
  tokenVault: TokenVault;
  vaultSecret: string;
}): Promise<CrmLead> => {
  const { store, action, session, tokenVault, vaultSecret } = input;
  const existing = await store.getCrmLeadByActionId(action.id, action.tenantId);
  if (existing) return existing;
  const slotValues = action.payload.slotValues ?? {};
  const contactChannel = slotValues.lead_contact_channel;
  const contactName = slotValues.lead_contact_name;
  const conversation = (await store.listMessages(action.sessionId, action.tenantId)).map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt }));
  const extractedContact = extractLeadData(conversation.filter((message) => message.role === 'user').map((message) => message.content).join(' '));
  const contactEmail = action.payload.email ?? (/^\[EMAIL_\d+\]$/u.test(contactChannel ?? '') ? contactChannel : extractedContact.email);
  const contactPhone = action.payload.phone ?? (/^\[PHONE_\d+\]$/u.test(contactChannel ?? '') ? contactChannel : extractedContact.phone);
  const leadData: LeadData = {
    ...(action.payload.name ?? contactName ? { name: action.payload.name ?? contactName } : {}),
    ...(contactEmail ? { email: contactEmail } : {}),
    ...(contactPhone ? { phone: contactPhone } : {}),
    ...(action.payload.interest ? { interest: action.payload.interest } : {}),
    ...(action.payload.slotValues ? { slotValues: action.payload.slotValues } : {}),
  };
  assertKnownTokens(session, JSON.stringify(leadData), tokenVault);
  const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault, 'admin_crm');
  const name = leadData.name ? rehydrate(leadData.name) : '';
  const email = leadData.email ? rehydrate(leadData.email) : '';
  const phone = leadData.phone ? rehydrate(leadData.phone) : '';
  const validName = Boolean(name && isValidLeadName(name));
  const validEmail = Boolean(email && isValidLeadEmail(email));
  const validPhone = Boolean(phone && isValidLeadPhone(phone));
  const conversationText = conversation.filter((message) => message.role === 'user').map((message) => message.content).join(' ');
  const score = scoreCrmLead({
    commercialIntent: true,
    timelineMentioned: /\b(?:today|tomorrow|urgent|asap|next\s+(?:week|month)|this\s+(?:week|month)|deadline|quarter)\b/i.test(conversationText),
    businessFit: /\b(?:company|business|licen[cs]e|visa|it|software|platform|quote|demo|service|setup)\b/i.test(conversationText),
    validName,
    validContact: validEmail && validPhone,
    engagedUserTurns: conversation.filter((message) => message.role === 'user').length,
  }).total;
  if (!validName || !validEmail || !validPhone || action.payload.contactConsent !== true || score < 70) throw new HttpError(422, 'LEAD_VALIDATION_FAILED', 'The authorized V2 action does not contain a complete verified lead.');
  const now = new Date().toISOString();
  const lead: CrmLead = {
    id: randomUUID(), tenantId: action.tenantId, actionId: action.id, sessionId: action.sessionId,
    intent: action.intentKey ?? action.workflowKey, secondaryIntentKeys: [], intentScore: action.intentScore ?? 0,
    intentConfidence: action.intentConfidence ?? 0, catalogVersionId: action.catalogVersionId ?? null, score,
    contactCompletenessScore: contactCompletenessScore({ validName, validEmail, validPhone }), validationPass: true,
    qualificationStatus: 'pending', qualificationEvidence: {}, leadData, conversation, summary: null,
    summaryStatus: 'pending', createdAt: now, updatedAt: now,
  };
  const created = await store.upsertCrmLead(lead, crmDedupeKey(action.tenantId, leadData, session, tokenVault, vaultSecret));
  if (created.actionId !== action.id) throw new HttpError(409, 'LEAD_DEDUPE_RECONCILIATION_REQUIRED', 'A matching lead belongs to another authorized action and requires reconciliation.');
  await store.createCrmLeadAssociation({ id: randomUUID(), tenantId: action.tenantId, crmLeadId: created.id, actionId: action.id, sessionId: action.sessionId, opportunityId: action.opportunityId ?? null, associationType: 'canonical', createdAt: now });
  await store.linkSessionDocuments(action.sessionId, action.tenantId, created.id);
  return created;
};

const pendingCatalogSlotValue = (validationRule: string, rawInput: string, maskedInput: string, session: Session, tokenVault: TokenVault): string | null => {
  const tokenKind = validationRule.match(/^token:(NAME|EMAIL|PHONE)$/u)?.[1];
  if (tokenKind) {
    const existing = maskedInput.match(new RegExp(`\\[${tokenKind}_\\d+\\]`, 'u'))?.[0];
    if (existing) return existing;
    const name = tokenKind === 'NAME' ? normalizePendingLeadName(rawInput) : '';
    if (tokenKind !== 'NAME' || !/^\p{L}+(?:[ '\u2019-]\p{L}+){0,3}$/u.test(name)) return null;
    return maskPiiForSession(session, `My name is ${name}`, tokenVault).match(/\[NAME_\d+\]/u)?.[0] ?? null;
  }
  if (validationRule === 'boolean:explicit_opt_in') {
    if (/^(?:no|n|nope|nah|no thanks|do not|don't|not now|not interested|decline|cancel|stop|i do not consent|i don't consent|i refuse)[.!\s]*$/iu.test(rawInput.trim())) return 'false';
    return /^(?:yes|y|yeah|yep|sure|ok|okay|absolutely|confirmed|confirm|i confirm|of course|sounds good|please do|yes please|yes\s*,?\s+i\s+(?:(?:do|explicitly)\s+)?consent(?:\s+to\s+.*)?|i\s+(?:(?:do|explicitly)\s+)?consent(?:\s+to\s+.*)?|i\s+agree(?:\s+to\s+.*)?|i\s+authorize(?:\s+.*)?|go\s+ahead|you\s+may\s+contact\s+me)[.!\s]*$/iu.test(rawInput.trim()) ? 'true' : null;
  }
  if (/^text:/u.test(validationRule)) return maskedInput.trim() && !/^(?:yes|no|ok|okay|sure|confirm|nope)$/iu.test(rawInput.trim()) && !isCatalogSlotNonAnswer(rawInput) ? maskedInput.trim() : null;
  const integerMatches = [...rawInput.matchAll(/(?<![\d.])\d+(?![\d.])/gu)].map((match) => match[0]);
  const integerValue = integerMatches.length === 1 && !/-\s*\d/u.test(rawInput) ? integerMatches[0] : null;
  const integerRule = validationRule.match(/^integer:(positive|nonnegative|(\d+)-(\d+))$/u);
  if (integerRule) {
    if (!integerValue) return null;
    const numericValue = Number(integerValue);
    if (integerRule[1] === 'positive') return numericValue > 0 ? integerValue : null;
    if (integerRule[1] === 'nonnegative') return integerValue;
    const minimum = Number(integerRule[2]);
    const maximum = Number(integerRule[3]);
    return numericValue >= minimum && numericValue <= maximum ? integerValue : null;
  }
  const numberMatches = [...rawInput.matchAll(/(?<![\d.])\d+(?:[.,]\d+)?(?![\d.])/gu)].map((match) => match[0]);
  const numberValue = numberMatches.length === 1 && numberMatches[0] && !/-\s*\d/u.test(rawInput) ? numberMatches[0].replace(',', '.') : null;
  if (validationRule === 'number:positive') return numberValue && Number(numberValue) > 0 ? numberValue : null;
  if (validationRule === 'number:nonnegative') return numberValue && Number(numberValue) >= 0 ? numberValue : null;
  if (validationRule === 'money:nonnegative') return /\d/u.test(rawInput) && !/^-\s*/u.test(rawInput) ? maskedInput.trim() : null;
  const enumRule = validationRule.match(/^enum:(.+)$/u)?.[1];
  if (enumRule && enumRule !== 'catalog_value') {
    const normalizedInput = rawInput.trim().toLocaleLowerCase('en-US').replace(/[\s-]+/gu, '_');
    const value = enumRule.split('|').find((candidate) => candidate.toLocaleLowerCase('en-US') === normalizedInput);
    return value ?? null;
  }
  if (validationRule === 'enum:catalog_value') return maskedInput.trim() && !/^(?:yes|no|ok|okay|sure|confirm|nope)$/iu.test(rawInput.trim()) ? maskedInput.trim() : null;
  return null;
};

const catalogSlotTerms = (slot: IntentCatalogSlot): string[] => {
  const keyTerms = slot.slotKey.split(/[._-]+/u).filter((term) => term.length >= 3);
  const promptTerms = slot.promptKey.split(/[._-]+/u).filter((term) => term.length >= 4 && !['lead', 'ask'].includes(term));
  const semanticTerms = /visa/iu.test(slot.slotKey) ? ['visa', 'visas']
    : /timeline|start/iu.test(slot.slotKey) ? ['timeline', 'start', 'month', 'months', 'week', 'weeks', 'asap']
      : /budget|amount|price|cost|money/iu.test(`${slot.slotKey} ${slot.validationRule}`) ? ['budget', 'aed', 'amount', 'spend', 'cost']
        : /office|workspace|desk/iu.test(slot.slotKey) ? ['office', 'workspace', 'desk', 'shared', 'private']
          : [];
  return [...new Set([...keyTerms, ...promptTerms, ...semanticTerms])];
};

const messageMentionsCatalogSlot = (slot: IntentCatalogSlot, message: string): boolean => catalogSlotTerms(slot).some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\b`, 'iu').test(message));

const catalogSlotValueForSlot = (slot: IntentCatalogSlot, rawInput: string, maskedInput: string, session: Session, tokenVault: TokenVault): string | null => {
  if (/structure|legal|entity|company_type/iu.test(slot.slotKey)) {
    if (!/\b(?:limited\s+liability|llc|fze|fzc|free\s+zone|branch|sole\s+(?:proprietorship|establishment)|partnership|corporation|incorporated)\b/iu.test(rawInput)) return null;
  }
  return pendingCatalogSlotValue(slot.validationRule, rawInput, maskedInput, session, tokenVault);
};

const inferredCatalogSlotValue = (slot: IntentCatalogSlot, rawInput: string, maskedInput: string, session: Session, tokenVault: TokenVault): string | null => {
  const normalized = rawInput.toLocaleLowerCase('en-US');
  if (/visa_count/iu.test(slot.slotKey)) {
    const match = rawInput.match(/(?<![\d.])\d+(?![\d.])(?=\s*(?:visa|visas))/iu);
    if (match) return pendingCatalogSlotValue(slot.validationRule, match[0], match[0], session, tokenVault);
    const correction = rawInput.match(/\b(?:to|of|is|=)\s*(\d+)\b/iu)?.[1];
    if (correction) return pendingCatalogSlotValue(slot.validationRule, correction, correction, session, tokenVault);
    const contextualNumber = rawInput.match(/\b(?:visa(?:s)?\s+(?:requirement|count)|number\s+of\s+visas?)\b[\s\S]{0,24}?\b(?:to|of|is|=)?\s*(\d+)\b/iu)?.[1];
    if (contextualNumber) return pendingCatalogSlotValue(slot.validationRule, contextualNumber, contextualNumber, session, tokenVault);
    const word = normalized.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+visas?\b/iu)?.[1]?.toLocaleLowerCase('en-US');
    const numeric = word ? { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' }[word] : null;
    if (numeric) return pendingCatalogSlotValue(slot.validationRule, numeric, numeric, session, tokenVault);
    const contextualWord = normalized.match(/\b(?:visa(?:s)?\s+(?:requirement|count)|number\s+of\s+visas?)\b[\s\S]{0,24}?\b(?:to|of|is)?\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/iu)?.[1]?.toLocaleLowerCase('en-US');
    const correctionWord = normalized.match(/\b(?:to|of|is)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/iu)?.[1]?.toLocaleLowerCase('en-US');
    const selectedWord = contextualWord ?? correctionWord;
    return selectedWord ? pendingCatalogSlotValue(slot.validationRule, ({ one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' }[selectedWord] ?? selectedWord), selectedWord, session, tokenVault) : null;
  }
  if (/timeline|start/iu.test(slot.slotKey)) {
    const match = normalized.match(/\b(?:next|this|within)\s+(?:month|months|week|weeks)|\b(?:asap|immediately|urgent)\b/iu);
    return match?.[0] ?? null;
  }
  if (/budget|amount|price|cost|money/iu.test(`${slot.slotKey} ${slot.validationRule}`)) {
    const match = rawInput.match(/(?:aed|usd|eur|gbp)\s*[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s*(?:aed|usd|eur|gbp)\b/iu);
    if (match) return pendingCatalogSlotValue(slot.validationRule === 'money:nonnegative' ? 'number:positive' : slot.validationRule, match[0], match[0], session, tokenVault);
  }
  if (/office|workspace|desk/iu.test(slot.slotKey)) {
    const match = normalized.match(/\b(?:shared|private)\s+(?:office|workspace|desk)\b|\b(?:office|workspace|desk)\b/iu);
    return match?.[0] ?? null;
  }
  return catalogSlotValueForSlot(slot, rawInput, maskedInput, session, tokenVault);
};

const explicitCatalogSlotValue = (slot: IntentCatalogSlot, rawInput: string, maskedInput: string, session: Session, tokenVault: TokenVault): string | null => {
  if (/activity|business/iu.test(slot.slotKey)) {
    const value = rawInput.match(/(?:business\s+activity|activity|business)\s*(?:is|:|=)\s*(.+?)(?=\s*(?:,\s*(?:and\s+)?(?:the\s+)?(?:timeline|start|visa|entity|company|structure)|;|$))/iu)?.[1]?.trim();
    return value ? catalogSlotValueForSlot(slot, value, value, session, tokenVault) : null;
  }
  if (/timeline|start/iu.test(slot.slotKey)) {
    const value = rawInput.match(/(?:timeline|start(?:ing)?|start\s+date)\s*(?:is|:|=)\s*(.+?)(?=\s*(?:,|;|$))/iu)?.[1]?.trim();
    return value ? catalogSlotValueForSlot(slot, value, value, session, tokenVault) : null;
  }
  if (/structure|legal|entity|company_type/iu.test(slot.slotKey)) {
    const value = rawInput.match(/\b(?:limited\s+liability|llc|fze|fzc|free\s+zone|branch|sole\s+(?:proprietorship|establishment)|partnership|corporation|incorporated)\b/iu)?.[0];
    return value && slot.validationRule !== 'enum:catalog_value' ? catalogSlotValueForSlot(slot, value, value, session, tokenVault) : null;
  }
  return null;
};

const offerText = (text: string): string => normalizeConversationQuery(text).toLocaleLowerCase('en-US');
const offerOptionIsPresented = (answer: string, option: FollowUpOfferOption): boolean => offerText(answer).includes(offerText(option.label));
const presentsUntrackedOffer = (answer: string): boolean => {
  const normalized = offerText(answer);
  return /[?؟]/u.test(normalized) && /\b(?:would you like|do you want|would you prefer|do you prefer|shall i|should i|which (?:option|one|path)|either|what would you prefer)\b/u.test(normalized);
};
const offerHintIsGrounded = (evidence: ModelEvidence[], hint: string): boolean => {
  const evidenceText = offerText(evidence.map((item) => item.content).join(' '));
  const terms = offerText(hint).match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return terms.length === 0 || terms.some((term) => evidenceText.includes(term));
};

export interface AppDependencies {
  store?: Store;
  model?: ChatModel;
  summaryModel?: Pick<ChatModel, 'summarize'>;
  workflow?: WorkflowAdapter;
  jwtSecret?: string;
  channelCredentialKey?: string;
  staticChannelApiKey?: string;
  staticChannelTenantId?: string;
  staticChannelTenantSlug?: string;
  staticChannelName?: string;
  allowStaticChannelApiKey?: boolean;
  nodeEnv?: string;
  tokenVault?: TokenVault;
  embedding?: EmbeddingProvider;
  n8nCallbackSecret?: string;
  ingestionWorkerSecret?: string;
  ingestionStagingRoot?: string;
  documentStorageRoot?: string;
  chatSessionTtlMs?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  inputCostUsdPerMillion?: number;
  outputCostUsdPerMillion?: number;
  cache?: CacheStore;
  chatResponseCacheTtlSeconds?: number;
  catalogQueryNormalizationEnabled?: boolean;
  sessionAccessTokenRequired?: boolean;
  v2Coordinator?: V2ConversationCoordinator;
  v2AccountOtp?: V2OtpChallengeService | DurableV2OtpChallengeService;
  v2AccountProvider?: DeterministicV2AccountProvider;
  v2SalesforceLeadProvider?: SalesforceSandboxLeadReadbackProvider;
  v2SalesforceLeadMutationProvider?: SalesforceSandboxLeadMutationProvider;
  v2SalesforceAccountProvider?: SalesforceSandboxAccountReadbackProvider;
  v2DocumentProvider?: DeterministicV2DocumentProvider;
  v2PaymentProvider?: DeterministicV2PaymentProvider;
  v2BillingReadbackProvider?: LiveBillingReadbackProvider;
  v2ContractProvider?: DeterministicV2ContractProvider;
}

export const v2ModelAuditMetadata = (input: { sessionId: string; clientMessageId: string }) => ({
  sessionId: input.sessionId,
  clientMessageId: input.clientMessageId,
});

const diagnosticText = (value: string | null, maxLength: number): string | null => value === null
  ? null
  : maskPii(sanitizeSensitiveText(value)).masked.slice(0, maxLength);

export const v2DiagnosticCaptureMetadata = (
  candidate: Pick<PersonaComposedResponseV2, 'answer' | 'citationIds' | 'nextQuestion' | 'nextQuestionKey' | 'reasonNoQuestion' | 'decisionRef'>,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (env.V2_DIAGNOSTIC_CAPTURE !== 'true' || env.NODE_ENV === 'production') return undefined;
  return {
    answer: diagnosticText(candidate.answer, 2_000),
    citationIds: [...new Set(candidate.citationIds)].slice(0, 32),
    nextQuestion: diagnosticText(candidate.nextQuestion, 500),
    nextQuestionKey: candidate.nextQuestionKey,
    reasonNoQuestion: diagnosticText(candidate.reasonNoQuestion, 120),
    decisionRefDigest: createHash('sha256').update(candidate.decisionRef).digest('hex').slice(0, 32),
  };
};

export const createApp = (dependencies: AppDependencies = {}) => {
  const store = dependencies.store ?? new MemoryStore();
  const vocabulary = new VocabularyLearningService(store);
  const cache = dependencies.cache ?? createCache(process.env.REDIS_URL);
  const cacheFlights = new Singleflight();
  const tenantCachePrefix = (tenantId: string): string => cacheKey('tenant', tenantId);
  const invalidateTenantCache = async (tenantId: string): Promise<void> => { try { await cache.invalidate(tenantCachePrefix(tenantId)); } catch { /* cache invalidation must not block durable state */ } };
  const auditCacheEvent = async (tenantId: string, eventName: string, key: string): Promise<void> => {
    await store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName, metadata: { keyDigest: contentHash(key).slice(0, 12) }, createdAt: new Date().toISOString() });
  };
  const model: ChatModel = dependencies.model ?? new DeterministicGroundedModel();
  const summaryModel = dependencies.summaryModel ?? (model.summarize ? model : undefined);
  const v2Coordinator = dependencies.v2Coordinator;
  const workflow = dependencies.workflow;
  const nodeEnv = dependencies.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const jwtSecret = dependencies.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only-change-me';
  const configuredChannelCredentialKey = dependencies.channelCredentialKey ?? process.env.CHANNEL_CREDENTIAL_KEY;
  const channelCredentialKey = configuredChannelCredentialKey ?? 'local-development-channel-key';
  const staticChannelApiKey = dependencies.staticChannelApiKey || process.env.OMNI_CHANNEL_API_KEY || undefined;
  const staticChannelTenantId = dependencies.staticChannelTenantId || process.env.OMNI_CHANNEL_TENANT_ID || undefined;
  const staticChannelTenantSlug = dependencies.staticChannelTenantSlug || process.env.OMNI_CHANNEL_TENANT_SLUG || undefined;
  const staticChannelName = dependencies.staticChannelName ?? process.env.OMNI_CHANNEL_NAME ?? 'omnichannel';
  const chatStreamInternalSecret = process.env.CHAT_STREAM_INTERNAL_SECRET;
  const allowStaticChannelApiKey = dependencies.allowStaticChannelApiKey ?? process.env.OMNI_ALLOW_STATIC_API_KEY === 'true';
  if (staticChannelApiKey && ((!staticChannelTenantId && !staticChannelTenantSlug) || (staticChannelTenantId && staticChannelTenantSlug) || staticChannelApiKey.length < 32)) throw new Error('Static omnichannel API key requires exactly one tenant scope and at least 32 characters.');
  if (nodeEnv === 'production' && staticChannelApiKey && !allowStaticChannelApiKey) throw new Error('Production static omnichannel API keys require OMNI_ALLOW_STATIC_API_KEY=true; prefer signed channel credentials.');
  const vaultSecret = process.env.PII_VAULT_KEY ?? 'local-development-pii-vault-key';
  if (nodeEnv === 'production' && ((!dependencies.jwtSecret && !process.env.JWT_SECRET) || (!dependencies.tokenVault && !process.env.PII_VAULT_KEY))) throw new Error('Production JWT_SECRET and PII_VAULT_KEY are required.');
  if (!dependencies.tokenVault) assertPiiVaultSecret(process.env.PII_VAULT_KEY, nodeEnv);
  const tokenVault = dependencies.tokenVault ?? new TokenVault(vaultSecret);
  const channelVault = new ChannelSecretVault(channelCredentialKey);
  const fallbackEmbeddingDimension = process.env.STORE === 'postgres' ? Number(process.env.AZURE_AI_EMBEDDING_DIMENSION ?? 1536) : 8;
  const embedding = dependencies.embedding ?? new DeterministicEmbeddingProvider(fallbackEmbeddingDimension);
  const n8nCallbackSecret = dependencies.n8nCallbackSecret ?? process.env.N8N_WEBHOOK_SECRET ?? '';
  const ingestionWorkerSecret = dependencies.ingestionWorkerSecret ?? process.env.INGESTION_WORKER_SECRET ?? '';
  const ingestionStaging = new IngestionStaging(dependencies.ingestionStagingRoot ?? process.env.INGESTION_STAGING_ROOT ?? join(process.cwd(), 'data', 'ingestion-staging'));
  const documentStorage = new PrivateDocumentStorage(dependencies.documentStorageRoot ?? process.env.SUPPORTING_DOCUMENT_ROOT ?? join(process.cwd(), 'data', 'supporting-documents'));
  const quoteWorkflowEnabled = nodeEnv !== 'production' && process.env.QUOTE_WORKFLOW_ENABLED === 'true';
  const renderQuotePdf = async (quote: Awaited<ReturnType<typeof createDevelopmentQuoteAfterLead>>, packageName: string, customer: { name: string; email: string; phone: string }, sellerLabel: string): Promise<{ artifactId: string; sha256: string; fileName: string; mimeType: 'application/pdf'; storageKey: string }> => {
    const renderUrl = process.env.QUOTE_PDF_RENDER_URL ?? '';
    const apiKey = process.env.QUOTE_PDF_API_KEY ?? '';
    if (!renderUrl || !apiKey) throw new HttpError(503, 'QUOTE_PDF_UNAVAILABLE', 'The quote PDF service is not configured.');
    const amount = (quote.amountMinor / 100).toFixed(2);
    const payload = { mode: 'MOCK', document_type: 'quote', reference: quote.id, issue_date: quote.createdAt.slice(0, 10), due_date: quote.validUntil.slice(0, 10), currency: quote.currency, customer_label: customer.name, customer_name: customer.name, customer_email: customer.email, customer_phone: customer.phone, seller_label: sellerLabel, tax_amount: '0.00', grand_total: amount, items: [{ description: packageName, quantity: '1', unit_price: amount }] };
    const rendered = await fetch(renderUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    if (!rendered.ok) throw new HttpError(502, 'QUOTE_PDF_RENDER_FAILED', 'The development quote PDF could not be rendered.');
    const metadata = await rendered.json() as { artifactId?: unknown; sha256?: unknown; bytes?: unknown };
    if (typeof metadata.artifactId !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.artifactId) || typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(metadata.sha256)) throw new HttpError(502, 'QUOTE_PDF_METADATA_INVALID', 'The development PDF service returned invalid artifact metadata.');
    const artifactUrl = renderUrl.replace(/\/v1\/render$/u, `/v1/artifacts/${metadata.artifactId}`);
    const artifactResponse = await fetch(artifactUrl, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    if (!artifactResponse.ok) throw new HttpError(502, 'QUOTE_PDF_ARTIFACT_UNAVAILABLE', 'The rendered quote PDF could not be retrieved.');
    const bytes = Buffer.from(await artifactResponse.arrayBuffer());
    if (bytes.length !== Number(metadata.bytes) || documentSha256(bytes) !== metadata.sha256) throw new HttpError(502, 'QUOTE_PDF_INTEGRITY_FAILED', 'The rendered quote PDF failed integrity verification.');
    const storageKey = documentStorage.key(quote.tenantId, quote.id, 'application/pdf');
    const existing = await documentStorage.read(storageKey);
    if (existing) { if (documentSha256(existing) !== metadata.sha256) throw new HttpError(409, 'QUOTE_PDF_CONFLICT', 'A different quote PDF already exists for this quote.'); }
    else await documentStorage.write(storageKey, bytes);
    return { artifactId: metadata.artifactId, sha256: metadata.sha256, fileName: `quote-${quote.id}.pdf`, mimeType: 'application/pdf', storageKey };
  };
  const resolveQuoteCustomer = async (session: Session): Promise<{ name: string; email: string; phone: string }> => {
    const lead = await store.getCrmLeadBySessionId(session.id, session.tenantId);
    const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault, 'admin_crm').trim();
    const customer = { name: lead?.leadData.name ? rehydrate(lead.leadData.name) : '', email: lead?.leadData.email ? rehydrate(lead.leadData.email) : '', phone: lead?.leadData.phone ? rehydrate(lead.leadData.phone) : '' };
    if (!lead?.validationPass || !isValidLeadName(customer.name) || !isValidLeadEmail(customer.email) || !isValidLeadPhone(customer.phone)) throw new HttpError(409, 'QUOTE_CUSTOMER_DETAILS_REQUIRED', 'The verified customer contact details are required before a quote can be rendered.');
    return customer;
  };
  const resolveActiveDocumentRequirementKey = async (tenantId: string, catalogVersionRef: string | null, goalKey: string | null): Promise<string | null> => {
    if (!catalogVersionRef || !goalKey) return null;
    const version = (await store.listIntentCatalogV2Versions(tenantId)).find((candidate) => candidate.status === 'published' && (candidate.id === catalogVersionRef || candidate.catalogVersionRef === catalogVersionRef));
    if (!version) return null;
    const binding = version.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === 'anc.document.ocr.extract' && candidate.enabled);
    const tool = version.catalog.sheets.ToolBindings.find((candidate) => ['document.ocr.extract', 'document.sf02_upload'].includes(candidate.toolKey) && candidate.goalKey === goalKey && candidate.enabled && candidate.stageKey === 'document_upload');
    return binding && tool ? version.catalog.sheets.DocumentPolicies.find((policy) => policy.goalKey === goalKey && policy.stageKey === 'document_upload' && policy.required && policy.enabled)?.policyKey ?? null : null;
  };
  const handoffDevelopmentQuoteToDocumentStage = async (session: Session, opportunityId: string, requirementKey: string): Promise<void> => {
    const current = await store.getSession(session.id);
    const state = current?.conversationState;
    const intentKey = state?.activeFollowUpIntentKey ?? state?.intentProgress?.activeIntentKey ?? state?.selectedIntentKey;
    const entry = intentKey ? state?.intentProgress?.entries[intentKey] : null;
    if (!current || !state || !entry || entry.journeyId !== opportunityId || !entry.lifecycle) return;
    if (entry.lifecycle.currentStage !== 'document_upload') {
      // The local Lead-to-quote shortcut intentionally omits Account creation;
      // keep its verified quote handoff usable without enabling this bypass in production.
      const lifecycle = { ...entry.lifecycle, currentStage: 'document_upload' as const, revision: entry.lifecycle.revision + 1, stages: { ...entry.lifecycle.stages, document_upload: { ...entry.lifecycle.stages.document_upload, status: 'awaiting_customer' as const } } };
      const nextEntry = { ...entry, lifecycle, currentRequirementKey: requirementKey, revision: entry.revision + 1 };
      const nextProgress = { ...(state.intentProgress!), entries: { ...(state.intentProgress?.entries ?? {}), [intentKey!]: nextEntry }, journeys: { ...(state.intentProgress?.journeys ?? {}), [entry.journeyId]: nextEntry }, journeyRevision: Math.max(state.intentProgress?.journeyRevision ?? 0, lifecycle.revision) };
      await updateSessionSafely({ ...current, conversationState: { ...state, intentProgress: nextProgress } }, true, 'workflow');
    } else if (entry.currentRequirementKey !== requirementKey) {
      const nextEntry = { ...entry, currentRequirementKey: requirementKey, revision: entry.revision + 1 };
      const nextProgress = { ...(state.intentProgress!), entries: { ...(state.intentProgress?.entries ?? {}), [intentKey!]: nextEntry }, journeys: { ...(state.intentProgress?.journeys ?? {}), [entry.journeyId]: nextEntry }, journeyRevision: state.intentProgress?.journeyRevision ?? 0 };
      await updateSessionSafely({ ...current, conversationState: { ...state, intentProgress: nextProgress } }, true, 'workflow');
    }
  };
  const mockDocumentProvider = dependencies.v2DocumentProvider ?? (process.env.REMOTE_CRM_PROVIDER === 'deterministic_mock' ? new DeterministicV2DocumentProvider() : null);
  const v2AccountOtp = dependencies.v2AccountOtp ?? new DurableV2OtpChallengeService(store, process.env.V2_OTP_SECRET ?? 'local-development-v2-otp-secret');
  const mockAccountProvider = dependencies.v2AccountProvider ?? (process.env.REMOTE_CRM_PROVIDER === 'deterministic_mock' ? new DeterministicV2AccountProvider() : null);
  const salesforceLeadProvider = dependencies.v2SalesforceLeadProvider
    ?? (process.env.REMOTE_CRM_PROVIDER === 'salesforce' ? new SalesforceSandboxLeadProvider({
      ...(process.env.REMOTE_CRM_ACCESS_TOKEN ? { accessToken: process.env.REMOTE_CRM_ACCESS_TOKEN } : {}),
      ...(process.env.REMOTE_CRM_TOKEN_URL ? { tokenUrl: process.env.REMOTE_CRM_TOKEN_URL } : {}),
      ...(process.env.REMOTE_CRM_CLIENT_ID ? { clientId: process.env.REMOTE_CRM_CLIENT_ID } : {}),
      ...(process.env.REMOTE_CRM_CLIENT_SECRET ? { clientSecret: process.env.REMOTE_CRM_CLIENT_SECRET } : {}),
      ...(process.env.REMOTE_CRM_LEAD_READ_URL ? { readbackUrl: process.env.REMOTE_CRM_LEAD_READ_URL } : {}),
      ...(process.env.REMOTE_CRM_LEAD_UPDATE_URL ? { leadUpdateUrl: process.env.REMOTE_CRM_LEAD_UPDATE_URL } : {}),
      ...(process.env.REMOTE_CRM_ATTACHMENT_URL ? { attachmentUrl: process.env.REMOTE_CRM_ATTACHMENT_URL } : {}),
      ...(process.env.REMOTE_CRM_ATTACHMENT_READ_URL ? { attachmentReadbackUrl: process.env.REMOTE_CRM_ATTACHMENT_READ_URL } : {}),
    }) : null);
  const salesforceLeadMutationProvider: SalesforceSandboxLeadMutationProvider | null = dependencies.v2SalesforceLeadMutationProvider
    ?? (salesforceLeadProvider instanceof SalesforceSandboxLeadProvider ? salesforceLeadProvider : null);
  const salesforceAccountProvider = dependencies.v2SalesforceAccountProvider
    ?? (process.env.REMOTE_CRM_PROVIDER === 'salesforce' ? new SalesforceSandboxLeadProvider({
      ...(process.env.REMOTE_CRM_ACCESS_TOKEN ? { accessToken: process.env.REMOTE_CRM_ACCESS_TOKEN } : {}),
      ...(process.env.REMOTE_CRM_TOKEN_URL ? { tokenUrl: process.env.REMOTE_CRM_TOKEN_URL } : {}),
      ...(process.env.REMOTE_CRM_CLIENT_ID ? { clientId: process.env.REMOTE_CRM_CLIENT_ID } : {}),
      ...(process.env.REMOTE_CRM_CLIENT_SECRET ? { clientSecret: process.env.REMOTE_CRM_CLIENT_SECRET } : {}),
      ...(process.env.REMOTE_CRM_ACCOUNT_READ_URL ? { accountReadbackUrl: process.env.REMOTE_CRM_ACCOUNT_READ_URL } : {}),
      ...(process.env.REMOTE_CRM_CONTACT_READ_URL ? { contactReadbackUrl: process.env.REMOTE_CRM_CONTACT_READ_URL } : {}),
      ...(process.env.REMOTE_CRM_OPPORTUNITY_READ_URL ? { opportunityReadbackUrl: process.env.REMOTE_CRM_OPPORTUNITY_READ_URL } : {}),
    }) : null);
  const salesforceLeadProviderReady = salesforceLeadProvider instanceof SalesforceSandboxLeadProvider
    ? salesforceLeadProvider.isLeadReadbackConfigured() && process.env.V2_LEAD_WORKFLOW_READY === 'true'
      : Boolean(salesforceLeadProvider);
  const mockPaymentProvider = dependencies.v2PaymentProvider ?? (process.env.REMOTE_PAYMENT_PROVIDER === 'deterministic_mock' ? new DeterministicV2PaymentProvider() : null);
  const billingReadbackProvider = dependencies.v2BillingReadbackProvider
    ?? (process.env.V2_BILLING_READBACK_BASE_URL && process.env.V2_BILLING_READBACK_TOKEN
      ? new HttpLiveBillingReadbackProvider(process.env.V2_BILLING_READBACK_BASE_URL, process.env.V2_BILLING_READBACK_TOKEN)
      : null);
  const mockContractProvider = dependencies.v2ContractProvider ?? (process.env.REMOTE_SIGNATURE_PROVIDER === 'deterministic_mock' ? new DeterministicV2ContractProvider() : null);
  if (nodeEnv === 'production' && !dependencies.v2AccountOtp && !process.env.V2_OTP_SECRET) throw new Error('V2_OTP_SECRET is required in production.');
  const chatSessionTtlMs = dependencies.chatSessionTtlMs ?? Number(process.env.CHAT_SESSION_TTL_MS ?? 10 * 60 * 1000);
  const readRate = (value: number | undefined, name: string): number | null => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return null; const parsed = Number(raw); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`); return parsed; };
  const inputCostUsdPerMillion = readRate(dependencies.inputCostUsdPerMillion, 'MODEL_INPUT_COST_USD_PER_MILLION');
  const outputCostUsdPerMillion = readRate(dependencies.outputCostUsdPerMillion, 'MODEL_OUTPUT_COST_USD_PER_MILLION');
  const readCacheTtl = (value: number | undefined, name: string, fallback: number, max: number): number => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${name} must be an integer between 0 and ${max}.`); return parsed; };
  const readRateLimit = (value: number | undefined, name: string, fallback: number, max: number): number => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${name} must be an integer between 1 and ${max}.`); return parsed; };
  const chatResponseCacheTtlSeconds = readCacheTtl(dependencies.chatResponseCacheTtlSeconds, 'CHAT_RESPONSE_CACHE_TTL_SECONDS', 60, 300);
  const catalogQueryNormalizationEnabled = dependencies.catalogQueryNormalizationEnabled ?? process.env.CATALOG_QUERY_NORMALIZATION_ENABLED === 'true';
  const sessionAccessTokenRequired = nodeEnv === 'production' || (dependencies.sessionAccessTokenRequired ?? process.env.CHAT_SESSION_TOKEN_REQUIRED === 'true');
  const updateSessionSafely = async (session: Session, preserveConcurrentState: boolean, conflictMerge: 'conversation' | 'workflow' = 'conversation'): Promise<Session> => {
    let candidate = session;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const saved = await store.updateSession(candidate);
        session.lastActivityAt = saved.lastActivityAt;
        session.closedAt = saved.closedAt;
        if (saved.conversationState) session.conversationState = saved.conversationState;
        session.tokenMap = saved.tokenMap;
        if (saved.stateVersion !== undefined) session.stateVersion = saved.stateVersion;
        return session;
      } catch (error) {
        if (errorCode(error) !== 'SESSION_STATE_CONFLICT' || attempt === 2) throw error;
        const latest = await store.getSession(session.id);
        if (!latest) throw error;
        const tokenMap = new Map(latest.tokenMap);
        for (const [token, ciphertext] of session.tokenMap) if (!tokenMap.has(token)) tokenMap.set(token, ciphertext);
        candidate = { ...latest, lastActivityAt: session.lastActivityAt, closedAt: session.closedAt ?? latest.closedAt, tokenMap };
        if (preserveConcurrentState && latest.conversationState && session.conversationState) candidate.conversationState = conflictMerge === 'workflow'
          ? mergeWorkflowCallbackState(latest.conversationState, session.conversationState)
          : mergeConcurrentConversationState(latest.conversationState, session.conversationState);
      }
    }
    throw new HttpError(409, 'SESSION_STATE_CONFLICT', 'Another message changed this conversation. Retry with the latest prompt.');
  };
  const advanceLifecycleStage = async (session: Session, stage: LifecycleStage, evidence: Record<string, string | number | boolean>, nextRequirementKey: string | null = null): Promise<void> => {
    const current = await store.getSession(session.id);
    if (!current || current.tenantId !== session.tenantId) return;
    const state = current.conversationState ?? newConversationState();
    const intentKey = state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey;
    const entry = intentKey ? state.intentProgress?.entries[intentKey] : null;
    if (!entry || !entry.journeyId || !entry.lifecycle) return;
    if (entry.lifecycle.stages[stage]?.status === 'completed') {
      if (entry.lifecycle.currentStage === 'document_upload' && entry.currentRequirementKey !== nextRequirementKey) {
        const nextEntry = { ...entry, currentRequirementKey: nextRequirementKey, revision: entry.revision + 1 };
        const nextProgress = { ...(state.intentProgress!), entries: { ...(state.intentProgress?.entries ?? {}), [intentKey!]: nextEntry }, journeys: { ...(state.intentProgress?.journeys ?? {}), [entry.journeyId]: nextEntry }, journeyRevision: state.intentProgress?.journeyRevision ?? 0 };
        await updateSessionSafely({ ...current, conversationState: { ...state, intentProgress: nextProgress } }, true, 'workflow');
      }
      return;
    }
    if (entry.lifecycle.currentStage !== stage) return;
    const lifecycle = completeLifecycleStage(entry.lifecycle ?? newLifecycleState(), stage, evidence);
    const nextEntry = { ...entry, lifecycle, revision: entry.revision + 1, ...(lifecycle.currentStage === 'document_upload' ? { currentRequirementKey: nextRequirementKey } : {}) };
    const nextProgress = { ...(state.intentProgress!), entries: { ...(state.intentProgress?.entries ?? {}), [intentKey!]: nextEntry }, journeys: { ...(state.intentProgress?.journeys ?? {}), [entry.journeyId]: nextEntry }, journeyRevision: Math.max(state.intentProgress?.journeyRevision ?? 0, lifecycle.revision) };
    await updateSessionSafely({ ...current, conversationState: { ...state, intentProgress: nextProgress } }, true, 'workflow');
    const document = await store.getUserIntentDocument(session.tenantId, session.id);
    const documentStage = document?.currentStageKey === 'payment_invoice' ? 'billing_invoice' : document?.currentStageKey;
    if (document?.catalogSource === 'v2' && document.opportunityId === entry.journeyId && documentStage === stage) {
      const nextDocumentStage = lifecycle.currentStage === 'billing_invoice' ? 'payment_invoice' : lifecycle.currentStage;
      const updated = await store.updateUserIntentDocument({
        document: { ...document, currentStageKey: nextDocumentStage, stageRevision: lifecycle.stages[lifecycle.currentStage].revision, revision: document.revision + 1, updatedAt: new Date().toISOString() },
        expectedRevision: document.revision,
      });
      if (!updated) throw new HttpError(409, 'V2_STAGE_DOCUMENT_CONFLICT', 'The lifecycle stage changed before its pinned journey revision could be updated.');
    }
  };
  const verifyMockSf02Attachment = async (session: Session, document: SupportingDocument): Promise<boolean> => {
    if (!mockDocumentProvider || !document.opportunityId || !document.leadId) return false;
    const existing = (await store.listAudit(document.tenantId)).find((event) => event.eventName === 'document.sf02_attachment_verified'
      && event.metadata.documentId === document.id && event.metadata.attachmentStatus === 'verified');
    if (existing) return true;
    const account = await store.getCrmAccountByOpportunity(document.opportunityId, document.tenantId);
    if (!account) return false;
    const idempotencyKey = `sf02:${document.id}`;
    try {
      // V2 sessions pin the catalog row UUID while provider evidence carries the canonical ref.
      const providerSession: Session = session.conversationState && session.conversationState.catalogVersionId !== document.catalogVersionId
        ? { ...session, conversationState: { ...session.conversationState, catalogVersionId: document.catalogVersionId ?? null } }
        : session;
      const request = buildV2DocumentProviderRequest({ session: providerSession, document, account, idempotencyKey, providerType: 'deterministic_mock' });
      const result = mockDocumentProvider.execute(request);
      const readback = { tenantId: request.tenantId, sessionId: request.sessionId, opportunityId: request.opportunityId, providerType: request.providerType, idempotencyKey: request.idempotencyKey, recordRef: result.attachmentId, verificationStatus: 'verified' as const, evidenceTier: 'mock_verified' as const };
      const validation = validateV2DocumentProviderResult(request, result, readback);
      await store.addAudit({ id: randomUUID(), tenantId: document.tenantId, actorId: null, eventName: validation.accepted ? 'document.sf02_attachment_verified' : 'document.sf02_attachment_rejected', metadata: { documentId: document.id, sessionId: document.sessionId, opportunityId: document.opportunityId, leadId: document.leadId, attachmentId: result.attachmentId, idempotencyKey, attachmentStatus: result.attachmentStatus, evidenceTier: result.evidenceTier, validationStatus: validation.status }, createdAt: new Date().toISOString() });
      return validation.accepted;
    } catch (error) {
      await store.addAudit({ id: randomUUID(), tenantId: document.tenantId, actorId: null, eventName: 'document.sf02_attachment_rejected', metadata: { documentId: document.id, sessionId: document.sessionId, opportunityId: document.opportunityId, leadId: document.leadId, idempotencyKey, attachmentStatus: 'reconciliation_required', reason: error instanceof Error ? error.message.slice(0, 120) : 'provider_validation_failed' }, createdAt: new Date().toISOString() });
      return false;
    }
  };
  const syncSalesforceLeadDocument = async (session: Session, document: SupportingDocument, summary: string): Promise<boolean> => {
    if (!salesforceLeadMutationProvider || !document.leadId || !summary.trim()) return false;
    const verifiedAudit = (await store.listAudit(document.tenantId)).find((event) => event.eventName === 'document.salesforce_lead_sync_verified'
      && event.metadata.documentId === document.id && event.metadata.leadId === document.leadId);
    if (verifiedAudit) return true;
    const lead = await store.getCrmLead(document.leadId, document.tenantId);
    const content = await documentStorage.read(document.storageKey);
    if (!lead?.leadId || lead.remoteCrm !== 'salesforce_sandbox' || !content) return false;
    const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault, 'admin_crm');
    const documentSummary = rehydrate(summary).trim();
    const description = [lead.summary ? rehydrate(lead.summary) : '', `Supporting document: ${documentSummary}`]
      .filter(Boolean).join('\n').slice(0, 32_000);
    try {
      const attachmentAudit = (await store.listAudit(document.tenantId)).find((event) => event.eventName === 'document.salesforce_lead_attachment_verified'
        && event.metadata.documentId === document.id && event.metadata.leadId === document.leadId && typeof event.metadata.attachmentId === 'string');
      const attachment = attachmentAudit
        ? { attachmentRef: String(attachmentAudit.metadata.attachmentId), parentRef: lead.leadId, fileName: document.fileName, sizeBytes: content.length }
        : await salesforceLeadMutationProvider.createLeadAttachment({ providerRecordId: lead.leadId, fileName: document.fileName, contentBase64: content.toString('base64') });
      if (!attachmentAudit) await store.addAudit({ id: randomUUID(), tenantId: document.tenantId, actorId: null, eventName: 'document.salesforce_lead_attachment_verified', metadata: { documentId: document.id, leadId: document.leadId, attachmentId: attachment.attachmentRef, attachmentStatus: 'verified' }, createdAt: new Date().toISOString() });
      const updated = await salesforceLeadMutationProvider.updateLeadDescription({ providerRecordId: lead.leadId, description });
      await store.addAudit({ id: randomUUID(), tenantId: document.tenantId, actorId: null, eventName: 'document.salesforce_lead_sync_verified', metadata: { documentId: document.id, leadId: document.leadId, attachmentId: attachment.attachmentRef, descriptionRecordRef: updated.recordRef, attachmentStatus: 'verified' }, createdAt: new Date().toISOString() });
      return true;
    } catch (error) {
      await store.addAudit({ id: randomUUID(), tenantId: document.tenantId, actorId: null, eventName: 'document.salesforce_lead_sync_failed', metadata: { documentId: document.id, leadId: document.leadId, reason: error instanceof Error ? error.message.slice(0, 120) : 'provider_sync_failed' }, createdAt: new Date().toISOString() });
      return false;
    }
  };
  const syncWorkflowState = async (action: Pick<ActionRequest, 'id' | 'tenantId' | 'sessionId' | 'intentKey' | 'actionKey' | 'catalogVersionId' | 'workflowKey' | 'opportunityId'>, status: ActionState, trustedProviderEvidence = false): Promise<void> => {
    const session = await store.getSession(action.sessionId);
    if (!session || session.tenantId !== action.tenantId) return;
    const currentState = session.conversationState;
    const v2Document = await store.getUserIntentDocument(action.tenantId, action.sessionId);
    if (v2Document?.catalogSource === 'v2') {
      if (v2Document.opportunityId !== action.opportunityId
        || v2Document.catalogVersionRef !== action.catalogVersionId) {
        // Never apply a legacy callback to a separately pinned V2 journey.
        return;
      }
      // Authenticated transport completion is NOT trusted stage completion:
      // provider record read-back and evaluateV2StageTransition must first
      // validate the authoritative evidence before advancing the lifecycle.
      const requiresReconciliation = status === 'completed' && !trustedProviderEvidence;
      const workflowStatus = status === 'completed' ? (trustedProviderEvidence ? 'succeeded' : 'reconcile_required')
        : status === 'failed' ? 'failed'
          : status === 'human_review' ? 'human_review'
            : status === 'reconcile_required' ? 'reconcile_required'
              : status === 'awaiting_customer' ? 'awaiting_customer' : 'processing';
      const phase = status === 'completed' ? (trustedProviderEvidence ? 'SUCCEEDED' : 'RECONCILE_REQUIRED')
        : status === 'reconcile_required' ? 'RECONCILE_REQUIRED' : status === 'failed' ? 'FAILED'
          : status === 'human_review' ? 'HUMAN_REVIEW'
            : status === 'awaiting_customer' ? 'SLOT_COLLECTION' : 'QUEUED';
      await updateSessionSafely({ ...session, conversationState: {
        ...(currentState ?? newConversationState()), workflowStatus, phase,
      } }, true, 'workflow');
      if (requiresReconciliation) {
        await store.addAudit({ id: randomUUID(), tenantId: action.tenantId,
          actorId: null, eventName: 'v2.provider.completion_awaiting_readback',
          metadata: { actionId: action.id, opportunityId: action.opportunityId,
            catalogVersionRef: v2Document.catalogVersionRef,
            stageKey: v2Document.currentStageKey, actionStatus: status },
          createdAt: new Date().toISOString() });
      }
      // Invoice issuance is a provider sub-operation inside payment_invoice;
      // only verified payment completion may advance that stage.
      if (status === 'completed' && trustedProviderEvidence && v2Document.currentStageKey && action.actionKey !== 'invoice.issue') {
        const stage = v2Document.currentStageKey === 'payment_invoice' ? 'billing_invoice' : v2Document.currentStageKey;
        const lifecycleStages: LifecycleStage[] = ['lead_generation', 'lead_qualification', 'account_creation', 'package_selection', 'document_upload', 'billing_invoice', 'contract'];
        if (lifecycleStages.includes(stage as LifecycleStage)) {
          const refreshed = await store.getSession(action.sessionId);
          if (refreshed) {
            if (stage === 'billing_invoice') {
              if (action.actionKey !== 'payment.authorize') throw new HttpError(409, 'PAYMENT_ACTION_REQUIRED', 'Only verified payment settlement can finish the billing stage.');
              const invoiceId = action.payload.slotValues?.invoiceId;
              const paidInvoice = typeof invoiceId === 'string' ? await store.getInvoice(invoiceId, action.tenantId) : null;
              const proof = (await store.listAudit(action.tenantId)).find((event) => event.eventName === 'payment.live_settlement_verified'
                && event.metadata.actionId === action.id && event.metadata.invoiceId === invoiceId
                && event.metadata.opportunityId === action.opportunityId && event.metadata.evidenceTier === 'provider_record_verified');
              if (!paidInvoice || paidInvoice.status !== 'paid' || paidInvoice.provider !== 'billing_live' || !proof)
                throw new HttpError(409, 'PAYMENT_PROOF_REQUIRED', 'Verified real payment evidence is required to advance to contract.');
              const progress = refreshed.conversationState?.intentProgress;
              const activeIntentKey = refreshed.conversationState?.activeFollowUpIntentKey ?? progress?.activeIntentKey ?? refreshed.conversationState?.selectedIntentKey;
              const journey = activeIntentKey ? progress?.entries[activeIntentKey] : null;
              if (!journey?.lifecycle || journey.journeyId !== action.opportunityId || journey.lifecycle.currentStage !== 'billing_invoice')
                throw new HttpError(409, 'PAYMENT_LIFECYCLE_SCOPE_MISMATCH', 'The verified payment does not match the active billing lifecycle.');
              const stageRevision = journey.lifecycle.stages.billing_invoice.revision + 1;
              await advanceLifecycleStage(refreshed, stage, {
                tenantId: action.tenantId, sessionId: action.sessionId, opportunityId: action.opportunityId!,
                catalogVersionRef: v2Document.catalogVersionRef!, stageKey: 'payment_invoice', stageRevision,
                evidenceRef: String(proof.metadata.paymentId), evidenceTier: 'provider_record_verified',
                operationStatus: 'completed', actionId: action.id, invoiceId: paidInvoice.id,
                paymentId: String(proof.metadata.paymentId), invoiceIssued: true, paymentCompleted: true, providerVerified: true,
              });
            } else {
              await advanceLifecycleStage(refreshed, stage as LifecycleStage, { actionId: action.id, providerVerified: true });
            }
            const advanced = await store.getSession(action.sessionId);
            const state = advanced?.conversationState;
            const intentKey = state?.activeFollowUpIntentKey ?? state?.intentProgress?.activeIntentKey ?? state?.selectedIntentKey;
            const entry = intentKey ? state?.intentProgress?.entries[intentKey] : null;
            const nextStage = entry?.lifecycle?.currentStage;
            const currentDocument = await store.getUserIntentDocument(action.tenantId, action.sessionId);
            if (nextStage && currentDocument?.currentStageKey === v2Document.currentStageKey) {
              const nextDocument = await store.updateUserIntentDocument({
                document: { ...currentDocument, currentStageKey: nextStage === 'billing_invoice' ? 'payment_invoice' : nextStage, stageRevision: entry.lifecycle!.stages[nextStage].revision, revision: currentDocument.revision + 1, updatedAt: new Date().toISOString() },
                expectedRevision: currentDocument.revision,
              });
              if (!nextDocument) throw new HttpError(409, 'V2_STAGE_DOCUMENT_CONFLICT', 'The verified provider result could not advance the pinned journey revision.');
            }
          }
        }
      }
      return;
    }
    const lifecycleIntentTransition = action.workflowKey === 'crm.account.convert' && action.intentKey === 'account.registration';
    if (currentState && action.intentKey && currentState.selectedIntentKey && currentState.selectedIntentKey !== action.intentKey && !lifecycleIntentTransition) return;
    if (currentState && action.catalogVersionId && currentState.catalogVersionId && currentState.catalogVersionId !== action.catalogVersionId) return;
    const workflowStatus = status === 'completed' ? 'succeeded' : status === 'reconcile_required' ? 'reconcile_required' : status === 'human_review' ? 'human_review' : status === 'failed' ? 'failed' : status === 'awaiting_customer' ? 'awaiting_customer' : 'processing';
    const phase = status === 'completed' ? 'SUCCEEDED' : status === 'reconcile_required' ? 'RECONCILE_REQUIRED' : status === 'human_review' ? 'HUMAN_REVIEW' : status === 'failed' ? 'FAILED' : status === 'awaiting_customer' ? 'SLOT_COLLECTION' : 'QUEUED';
    await updateSessionSafely({ ...session, conversationState: { ...(currentState ?? newConversationState()), workflowStatus, phase, pendingPrompt: null } }, true, 'workflow');
    if (status === 'completed' && action.opportunityId) {
      const refreshed = await store.getSession(action.sessionId);
      if (refreshed) {
        if (action.workflowKey === 'crm.lead.create') {
          await advanceLifecycleStage(refreshed, 'lead_generation', { actionId: action.id, providerVerified: true });
          const lead = await store.getCrmLeadByActionId(action.id, action.tenantId);
          if (lead?.qualificationStatus === 'qualified') {
            await advanceLifecycleStage(refreshed, 'lead_qualification', { actionId: action.id, qualificationVerified: true });
          }
        } else if (action.workflowKey === 'crm.account.convert') {
          await advanceLifecycleStage(refreshed, 'account_creation', { actionId: action.id, providerVerified: true });
        }
      }
    }
  };
  const assertWorkflowExecution = async (action: ActionRequest, executionReference: string | undefined, eventId: string | undefined, correlationId: string | undefined, attempt: number | undefined, requireReference: boolean): Promise<void> => {
    if (!eventId || !correlationId || attempt === undefined || (requireReference && !executionReference)) throw new HttpError(409, 'WORKFLOW_CORRELATION_REQUIRED', 'A verified workflow event, correlation, attempt and execution reference are required.');
    const execution = await store.getActionExecution(action.id, action.tenantId);
    if (!execution || execution.eventId !== eventId || execution.correlationId !== correlationId || execution.attempt !== attempt || (execution.n8nExecutionRef && executionReference && execution.n8nExecutionRef !== executionReference)) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'The workflow completion does not match the current execution claim.');
  };
  const assertV2ProviderCorrelation = async (action: ActionRequest, input: unknown): Promise<void> => {
    const doc = await store.getUserIntentDocument(action.tenantId, action.sessionId);
    const versions = await store.listIntentCatalogV2Versions(action.tenantId);
    const knownV2 = versions.some(version => version.catalogVersionRef === action.catalogVersionId);
    if (doc?.catalogSource !== 'v2' && !knownV2) return;
    // A revoked V2 catalog or a missing intent document must never bypass
    // mandatory callback identity checks through a legacy fallback.
    const publishedV2 = versions.find(version => version.status === 'published'
      && version.catalogVersionRef === action.catalogVersionId);
    if (!publishedV2 || doc?.catalogSource !== 'v2'
      || doc.catalogVersionRef !== action.catalogVersionId
      || doc.opportunityId !== action.opportunityId) {
      throw new HttpError(409, 'V2_PROVIDER_CATALOG_STALE', 'Provider callback has no current V2 catalog and opportunity pin.');
    }
    const parsed = v2CallbackCorrelationSchema.safeParse(input);
    if (!parsed.success) throw new HttpError(409, 'V2_PROVIDER_CORRELATION_REQUIRED', 'A v2 provider callback must include its trusted session, opportunity, catalog and action revision.');
    const reason = validateV2ProviderCorrelation(action, parsed.data);
    if (reason) throw new HttpError(409, 'V2_PROVIDER_CORRELATION_MISMATCH', `The v2 provider callback correlation is invalid (${reason}).`);
  };
  const transitionWorkflowAction = async (action: ActionRequest, status: ActionState, externalReference: string | undefined, actorId: string | null, executionReference?: string, eventId?: string, correlationId?: string, attempt?: number, providerCorrelation?: V2ProviderCorrelation, trustedProviderEvidence = false, outcome?: ActionExecution['outcome']): Promise<ActionRequest> => {
    const resolvingReconciliation = action.state === 'reconcile_required' && status === 'completed';
    const providerTerminal = actorId === null && ['completed', 'failed'].includes(status);
    if (providerCorrelation || providerTerminal) await assertV2ProviderCorrelation(action, providerCorrelation);
    if (providerTerminal) await assertWorkflowExecution(action, executionReference, eventId, correlationId, attempt, true);
    else if (eventId || correlationId || executionReference) await assertWorkflowExecution(action, executionReference, eventId, correlationId, attempt, false);
    const resolvesReconciliation = resolvingReconciliation;
    const allowed = action.state === status
      || (['approved', 'processing'].includes(action.state) && ['processing', 'completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review'].includes(status))
      || (action.state === 'human_review' && ['completed', 'failed', 'reconcile_required'].includes(status))
      || (action.state === 'awaiting_customer' && ['processing', 'completed', 'failed', 'reconcile_required'].includes(status))
      || resolvesReconciliation;
    if (!allowed) throw new HttpError(409, 'WORKFLOW_TRANSITION_FORBIDDEN', `Workflow action cannot transition from ${action.state} to ${status}.`);
    const scopeDocument = await store.getUserIntentDocument(action.tenantId, action.sessionId);
    const isCanonicalV2 = action.catalogVersionId
      ? (await store.listIntentCatalogV2Versions(action.tenantId))
        .some(version => version.catalogVersionRef === action.catalogVersionId)
      : false;
    const completion = evaluateV2CallbackStageCompletion(action, status, scopeDocument, isCanonicalV2, trustedProviderEvidence);
    if (!completion.accepted) {
      throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_REQUIRED',
        'The provider callback cannot finalize a V2 action without a trusted provider-record verification.');
    }
    if (providerTerminal) {
      const committed = await store.transitionActionWithExecution({ actionId: action.id, tenantId: action.tenantId, fromState: action.state, toState: status, result: externalReference ? { externalReference } : action.result, providerStatus: status, n8nExecutionRef: executionReference!, eventId: eventId!, correlationId: correlationId!, expectedAttempt: attempt!, resolveReconciliation: resolvesReconciliation, outcome: outcome ?? (externalReference ? { externalReference } : null) });
      if (!committed) throw new HttpError(409, 'WORKFLOW_TRANSITION_CONFLICT', 'The workflow action and execution changed before this transition was committed.');
      await syncWorkflowState(committed.action, status, trustedProviderEvidence);
      await store.addAudit({ id: randomUUID(), tenantId: committed.action.tenantId, actorId, eventName: `workflow.transition.${action.state}.${status}`, metadata: { actionId: committed.action.id, fromState: action.state, toState: status }, createdAt: new Date().toISOString() });
      await invalidateTenantCache(committed.action.tenantId);
      return committed.action;
    }
    const executionContext = { ...(eventId ? { eventId } : {}), ...(correlationId ? { correlationId } : {}), ...(attempt !== undefined ? { expectedAttempt: attempt } : {}) };
    if (action.state === status) { await syncWorkflowState(action, status, trustedProviderEvidence); await store.updateActionExecution({ actionId: action.id, tenantId: action.tenantId, providerStatus: status, n8nExecutionRef: executionReference ?? null, outcome: outcome ?? (externalReference ? { externalReference } : null), resolveReconciliation: resolvesReconciliation, ...executionContext }); return action; }
    const updated = await store.transitionAction(action.id, action.tenantId, action.state, status, externalReference ? { externalReference } : action.result);
    if (!updated) {
      const current = await store.getAction(action.id);
      if (current?.state === status) { await syncWorkflowState(current, status, trustedProviderEvidence); return current; }
      throw new HttpError(409, 'WORKFLOW_TRANSITION_CONFLICT', 'The workflow action changed before this transition was committed.');
    }
    await syncWorkflowState(updated, status, trustedProviderEvidence);
    await store.updateActionExecution({ actionId: updated.id, tenantId: updated.tenantId, providerStatus: status, n8nExecutionRef: executionReference ?? null, outcome: outcome ?? (externalReference ? { externalReference } : null), resolveReconciliation: resolvesReconciliation, ...executionContext });
    await store.addAudit({ id: randomUUID(), tenantId: updated.tenantId, actorId, eventName: `workflow.transition.${action.state}.${status}`, metadata: { actionId: updated.id, fromState: action.state, toState: status }, createdAt: new Date().toISOString() });
    await invalidateTenantCache(updated.tenantId);
    return updated;
  };
  const chatActionContext = async (req: Request, actionId: string): Promise<{ action: ActionRequest; session: Session; tenant: NonNullable<Awaited<ReturnType<typeof store.getTenant>>> }> => {
    const channel = getChannel(req);
    const action = await store.getAction(actionId);
    if (!action) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
    const sessionId = req.query.sessionId;
    if (typeof sessionId !== 'string' || sessionId !== action.sessionId) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.');
    const session = await store.getSession(action.sessionId);
    const tenant = await store.getTenant(action.tenantId);
    if (!session || session.tenantId !== action.tenantId || !tenant || (channel && channel.tenantId !== action.tenantId)) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
    if (!tenant) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
    ensureLiveSession(session.lastActivityAt, session.closedAt);
    await authorizeSessionAccessToken(req, session);
    if (!getAuth(req) && !channel) {
      if (!tenant.publicChatEnabled) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      enforcePublicOrigin(req, tenant, nodeEnv);
    } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== action.tenantId && getAuth(req)?.role !== 'platform_admin') {
      throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.');
    }
    return { action, session, tenant };
  };
  const createReconciliationFollowUp = async (action: ActionRequest, session: Session, tenant: NonNullable<Awaited<ReturnType<typeof store.getTenant>>>): Promise<Message> => {
    const clientMessageId = `action-follow-up:${action.id}`;
    const existing = await store.getMessageByClientId(session.id, clientMessageId);
    if (existing?.role === 'assistant' && existing.response?.actionFollowUpActionId === action.id) return existing;
    const persona = session.personaVersionId
      ? await store.getPersonaVersion(session.tenantId, session.personaVersionId)
      : await store.getPersona(session.tenantId);
    const contextWindow = Math.min(Math.max(persona?.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, 2), 8);
    const conversation = (await store.listMessages(session.id, session.tenantId, contextWindow)).map((message) => ({ role: message.role, content: message.maskedContent }));
    const draft = await model.draft({
      maskedMessage: 'Continue the current conversation after the external confirmation entered review.',
      evidence: [],
      personaName: persona?.name ?? tenant.name,
      ownerName: tenant.name,
      ...(persona ? { persona } : {}),
      conversation,
      followUpContext: {
        leadCaptured: true,
        primaryIntentKey: action.intentKey ?? null,
        workflowStatus: 'reconcile_required',
        phase: 'RECONCILE_REQUIRED',
        ...(action.payload.slotValues ? { capturedSlots: action.payload.slotValues } : {}),
        ...(session.conversationState?.rollingSummary ? { conversationSummary: session.conversationState.rollingSummary } : {}),
        responseMode: 'reconcile_follow_up',
      },
    });
    const answer = draft.answer.trim();
    if (!isSafeContinuityAnswer(answer, []) || !/[?؟]/u.test(answer)) throw new HttpError(503, 'FOLLOW_UP_UNAVAILABLE', 'The assistant could not prepare the next conversation step.');
    const message: Message = { id: randomUUID(), sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: answer, citations: [], clientMessageId, response: { conversational: true, actionFollowUpActionId: action.id }, createdAt: new Date().toISOString() };
    try { return await store.addMessage(message); } catch (error) {
      const raced = await store.getMessageByClientId(session.id, clientMessageId);
      if (raced?.role === 'assistant' && raced.response?.actionFollowUpActionId === action.id) return raced;
      throw error;
    }
  };
  const normalizerHealth = new Map<string, { failures: number; blockedUntil: number }>();
  const normalizeCatalogQuery = async (tenantId: string, catalogVersionId: string, input: QueryNormalizationInput, fallback: string): Promise<{ value: string; usedFallback: boolean; failed: boolean }> => {
    const health = normalizerHealth.get(tenantId) ?? { failures: 0, blockedUntil: 0 };
    normalizerHealth.set(tenantId, health);
    const normalizeQuery = model.normalizeQuery?.bind(model);
    if (!normalizeQuery || !catalogQueryNormalizationEnabled || Date.now() < health.blockedUntil) return { value: fallback, usedFallback: true, failed: Date.now() < health.blockedUntil };
    const contextDigest = contentHash(JSON.stringify((input.conversation ?? []).slice(-8).map((turn) => ({ role: turn.role, content: turn.content.slice(-1_000) }))));
    const key = cacheKey('tenant', tenantId, 'catalog-normalized-query-v3', catalogVersionId, input.selectedIntentKey ?? '', contextDigest, input.maskedMessage);
    return cacheFlights.run(key, async () => {
      const cached = await cache.get<string>(key);
      if (cached) return { value: cached, usedFallback: false, failed: false };
      try {
        const normalized = await normalizeQuery(input);
        if (!normalized) throw new Error('normalization unavailable');
        const safe = normalizeConversationQuery(normalized);
        if (!preservesNormalizationFacts(input.maskedMessage, safe)) throw new Error('normalization changed protected facts');
        health.failures = 0;
        health.blockedUntil = 0;
        await cache.set(key, safe, Math.min(300, Math.max(1, chatResponseCacheTtlSeconds)));
        return { value: safe, usedFallback: false, failed: false };
      } catch {
        health.failures += 1;
        if (health.failures >= 3) health.blockedUntil = Date.now() + 30_000;
        return { value: fallback, usedFallback: true, failed: true };
      }
    });
  };
  const rateLimitMax = readRateLimit(dependencies.rateLimitMax, 'API_RATE_LIMIT_MAX', nodeEnv === 'development' || nodeEnv === 'test' ? 600 : 120, 100_000);
  const rateLimitWindowMs = readRateLimit(dependencies.rateLimitWindowMs, 'API_RATE_LIMIT_WINDOW_MS', 60_000, 3_600_000);
  if (nodeEnv === 'production' && ((!dependencies.model && !v2Coordinator) || !dependencies.embedding || !n8nCallbackSecret || !ingestionWorkerSecret)) throw new Error('Production Azure, embedding, n8n polling and ingestion adapters are required.');
  if (nodeEnv === 'production' && (!configuredChannelCredentialKey || /^(?:replace-with|local-development|change-me)/i.test(configuredChannelCredentialKey))) throw new Error('Production CHANNEL_CREDENTIAL_KEY is required.');
  if (nodeEnv === 'production' && !dependencies.cache && !process.env.REDIS_URL) throw new Error('Production requires REDIS_URL.');
  if (!Number.isFinite(chatSessionTtlMs) || chatSessionTtlMs <= 0) throw new Error('CHAT_SESSION_TTL_MS must be a positive number.');
  const ensureLiveSession = (lastActivityAt: string, closedAt: string | null): void => { if (closedAt) throw new HttpError(410, 'SESSION_CLOSED', 'This chat session has ended.'); if (sessionExpired(lastActivityAt, closedAt, chatSessionTtlMs)) throw new HttpError(410, 'SESSION_EXPIRED', 'This chat session has expired.'); };
  const rehydrateStoredResponse = (session: Session, stored: Record<string, unknown>): Record<string, unknown> => {
    const answer = stored.answer;
    return typeof answer === 'string' ? { ...stored, answer: rehydrateForSession(session, answer, tokenVault) } : stored;
  };
  const workerApi = (req: Request, _res: Response, next: NextFunction): void => {
    if (!ingestionWorkerSecret) { next(new HttpError(503, 'WORKER_UNAVAILABLE', 'Ingestion worker authentication is not configured.')); return; }
    const provided = req.header('x-ingestion-worker-secret') ?? '';
    const expectedBuffer = Buffer.from(ingestionWorkerSecret);
    const providedBuffer = Buffer.from(provided);
    if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) { next(new HttpError(401, 'WORKER_UNAUTHORIZED', 'Ingestion worker authentication failed.')); return; }
    next();
  };
  const n8nInternalApi = (req: Request, _res: Response, next: NextFunction): void => {
    const expected = Buffer.from(n8nCallbackSecret);
    const provided = Buffer.from(req.header('x-agentic-internal-secret') ?? '');
    if (expected.length === 0 || expected.length !== provided.length || !timingSafeEqual(expected, provided)) { next(new HttpError(401, 'N8N_UNAUTHORIZED', 'n8n internal authentication failed.')); return; }
    next();
  };
  const auth = new AuthService(store, jwtSecret);
  const gateway = new ActionGateway(store, workflow);
  const app = express();
  const rateLimits = new Map<string, RateLimitEntry>();
  const newTelemetry = (): Telemetry => ({ requests: 0, serverErrors: 0, totalLatencyMs: 0, lastRequestAt: null, chatResponses: 0, groundedResponses: 0, abstentions: 0, actionProposals: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: inputCostUsdPerMillion !== null && outputCostUsdPerMillion !== null ? 0 : null, normalizationAttempts: 0, normalizationFallbacks: 0, normalizationFailures: 0, normalizationLatencyMs: 0 });
  const telemetry = newTelemetry();
  const tenantTelemetry = new Map<string, Telemetry>();
  const recordChatOutcome = (tenantId: string, grounded: boolean, proposedAction: boolean, inputTokens: number, outputTokens: number): void => {
    const scoped = tenantTelemetry.get(tenantId) ?? newTelemetry();
    for (const value of [telemetry, scoped]) {
      value.chatResponses += 1;
      if (grounded) value.groundedResponses += 1;
      else value.abstentions += 1;
      if (proposedAction) value.actionProposals += 1;
      value.estimatedInputTokens += inputTokens;
      value.estimatedOutputTokens += outputTokens;
      if (value.estimatedCostUsd !== null) value.estimatedCostUsd += (inputTokens / 1_000_000) * (inputCostUsdPerMillion ?? 0) + (outputTokens / 1_000_000) * (outputCostUsdPerMillion ?? 0);
    }
    tenantTelemetry.set(tenantId, scoped);
  };
  const recordNormalization = (tenantId: string, usedFallback: boolean, failed: boolean, elapsedMs: number): void => {
    const scoped = tenantTelemetry.get(tenantId) ?? newTelemetry();
    for (const value of [telemetry, scoped]) { value.normalizationAttempts += 1; value.normalizationLatencyMs += elapsedMs; if (usedFallback) value.normalizationFallbacks += 1; if (failed) value.normalizationFailures += 1; }
    tenantTelemetry.set(tenantId, scoped);
  };
  const observedTelemetry = (value: Telemetry) => ({ requests: value.requests, serverErrors: value.serverErrors, averageLatencyMs: value.requests ? Math.round(value.totalLatencyMs / value.requests) : 0, lastRequestAt: value.lastRequestAt, chatResponses: value.chatResponses, groundedResponses: value.groundedResponses, abstentions: value.abstentions, actionProposals: value.actionProposals, groundingRate: value.chatResponses ? value.groundedResponses / value.chatResponses : 0, abstentionRate: value.chatResponses ? value.abstentions / value.chatResponses : 0, estimatedInputTokens: value.estimatedInputTokens, estimatedOutputTokens: value.estimatedOutputTokens, estimatedCostUsd: value.estimatedCostUsd, normalizationAttempts: value.normalizationAttempts, normalizationFallbacks: value.normalizationFallbacks, normalizationFailures: value.normalizationFailures, normalizationAverageLatencyMs: value.normalizationAttempts ? Math.round(value.normalizationLatencyMs / value.normalizationAttempts) : 0 });

  app.disable('x-powered-by');
  app.use((req: AuthedRequest, res: Response, next: NextFunction) => { req.requestId = req.header('x-request-id') ?? randomUUID(); res.setHeader('x-request-id', req.requestId); next(); });
  app.use('/api', (_req, res, next) => { res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer'); next(); });
  app.use(async (req, res, next) => {
    const origin = req.header('origin');
    const allowed = new Set([process.env.WEB_ORIGIN ?? 'http://localhost:3000', process.env.ADMIN_ORIGIN ?? 'http://localhost:4200']);
    if (nodeEnv !== 'production') for (const localOrigin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:4200', 'http://127.0.0.1:4200']) allowed.add(localOrigin);
    if (origin && !allowed.has(origin)) {
      try { if ((await store.listTenants()).some((tenant) => tenant.status === 'active' && tenant.publicChatEnabled && tenant.publicOrigin === origin)) allowed.add(origin); } catch { /* readiness endpoint reports store failures */ }
    }
    if (origin && allowed.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-headers', 'content-type,authorization,x-request-id,x-tenant-id,x-agentic-key-id,x-agentic-timestamp,x-agentic-nonce,x-agentic-signature,x-agentic-session-token'); res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.status(origin && allowed.has(origin) ? 204 : 403).end(); return; }
    next();
  });
  // shortcut: one bounded JSON parser supports local 20 MiB base64 uploads; replace with streaming/object storage before production.
  app.use(express.json({ limit: '30mb' }));
  registerV2ToolGateway(app, { store, embedding, serviceKey: process.env.MODEL_GATEWAY_SERVICE_KEY ?? '' });
  app.use((req, res, next) => { const started = Date.now(); res.once('finish', () => { const elapsed = Date.now() - started; const failed = res.statusCode >= 500 ? 1 : 0; const timestamp = new Date().toISOString(); telemetry.requests += 1; telemetry.serverErrors += failed; telemetry.totalLatencyMs += elapsed; telemetry.lastRequestAt = timestamp; const tenantId = (req as AuthedRequest).auth?.tenantId; if (tenantId) { const scoped = tenantTelemetry.get(tenantId) ?? newTelemetry(); scoped.requests += 1; scoped.serverErrors += failed; scoped.totalLatencyMs += elapsed; scoped.lastRequestAt = timestamp; tenantTelemetry.set(tenantId, scoped); } }); next(); });
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) { next(); return; }
    const now = Date.now();
    pruneExpiredRateLimits(rateLimits, now);
    const key = req.ip ?? 'unknown';
    const current = rateLimits.get(key);
    const limit = rateLimitMax;
    const windowMs = rateLimitWindowMs;
    const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + windowMs } : { count: current.count + 1, resetAt: current.resetAt };
    rateLimits.set(key, entry);
    if (entry.count > limit) { res.setHeader('retry-after', Math.max(1, Math.ceil((entry.resetAt - now) / 1000))); res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }); return; }
    next();
  });

  const crmLeadForAdmin = async (lead: CrmLead): Promise<CrmLead & { quality: ReturnType<typeof leadQuality>; documents: Array<SupportingDocument & { extractedText: string | null; summary: string | null }> }> => {
    const qualityRule = await crmLeadQualityRule(store, lead);
    const quality = catalogQuality(lead.score, qualityRule);
    const session = await store.getSession(lead.sessionId);
    const documents = await store.listSupportingDocuments(lead.tenantId, undefined, lead.id);
    if (!session) return { ...lead, quality, documents };
    const rehydrate = (value: string): string => rehydrateForSession(session, redactUnknownTokens(session, value, tokenVault), tokenVault, 'admin_crm');
    const summary = lead.summary ? (() => { try { return formatCrmSummarySpec(lead.summary); } catch { return lead.summary; } })() : null;
    const adminDocumentDetails = composeAdminDocumentDetails(documents, (value) => redactUnknownTokens(session, value, tokenVault));
    const adminSummary = [summary, adminDocumentDetails].filter(Boolean).join('\n');
    return { ...lead, quality, leadData: { ...(lead.leadData.name ? { name: rehydrate(lead.leadData.name) } : {}), ...(lead.leadData.email ? { email: rehydrate(lead.leadData.email) } : {}), ...(lead.leadData.phone ? { phone: rehydrate(lead.leadData.phone) } : {}), ...(lead.leadData.interest ? { interest: lead.leadData.interest } : {}), ...(lead.leadData.slotValues ? { slotValues: Object.fromEntries(Object.entries(lead.leadData.slotValues).map(([key, value]) => [key, rehydrate(value)])) } : {}) }, conversation: lead.conversation.map((message) => ({ ...message, content: rehydrate(message.content) })), summary: adminSummary ? rehydrate(formatCrmSummarySpec(adminSummary)) : null, documents: documents.map((document) => ({ ...document, extractedText: document.extractedText ? rehydrate(document.extractedText) : null, summary: document.summary ? rehydrate(document.summary) : null })) };
  };

  const publicDocument = (document: SupportingDocument) => ({ id: document.id, sessionId: document.sessionId, leadId: document.leadId, requirementKey: document.requirementKey ?? null, expectedDocumentType: document.expectedDocumentType ?? null, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, status: document.status, summary: null, errorCode: document.errorCode, createdAt: document.createdAt, updatedAt: document.updatedAt });
  const documentConfig = async (tenantId: string) => {
    const v2Version = (await store.listIntentCatalogV2Versions(tenantId)).find((candidate) => candidate.status === 'published');
    if (v2Version) {
      const policies = v2Version.catalog.sheets.DocumentPolicies;
      const binding = v2Version.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === 'anc.document.ocr.extract' && candidate.enabled);
      const enabledTools = new Set(v2Version.catalog.sheets.ToolBindings.filter((candidate) => ['document.ocr.extract', 'document.sf02_upload'].includes(candidate.toolKey) && candidate.enabled).map((candidate) => candidate.goalKey));
      const allowedMimeTypes = [...new Set(policies.flatMap((policy) => policy.mimeTypes))];
      const requirements = policies.filter((policy) => policy.required && policy.enabled && enabledTools.has(policy.goalKey)).map((policy) => ({ intentKey: policy.goalKey, requirementKey: policy.policyKey, documentType: policy.docType, allowedDocumentTypes: [policy.docType] }));
      return { enabled: Boolean(binding && enabledTools.size), requireUploadConsent: true, maxFileBytes: MAX_DOCUMENT_BYTES, maxFilesPerRequest: 1, maxPdfPages: 20, allowedMimeTypes, policies: policies.filter((policy) => policy.enabled && enabledTools.has(policy.goalKey)).map((policy) => ({ intentKey: policy.goalKey, requestMode: 'explicit_upload' as const, allowedDocumentTypes: [policy.docType], consentRequired: true })), requirements, workflowKey: binding?.workflowKey ?? null, binding: binding ? { webhookPath: binding.webhookPath ?? '', payloadContract: binding.payloadContract ?? null } : null };
    }
    const version = await store.getPublishedIntentCatalog(tenantId);
    const settings = version?.catalog.documentSettings;
    const policies = version?.catalog.documentPolicies ?? [];
    const binding = settings ? version?.catalog.workflowBindings.find((candidate) => candidate.workflowKey === settings.workflowKey && candidate.active) : undefined;
    const requirements = (version?.catalog.journeyRequirements ?? []).flatMap((requirement) => {
      if (!requirement.required || requirement.requirementType !== 'document' || !requirement.documentType) return [];
      const policy = policies.find((candidate) => candidate.intentKey === requirement.intentKey);
      if (!policy?.enabled || !policy.allowUserInitiated || !policy.allowedDocumentTypes.includes(requirement.documentType)) return [];
      return [{ intentKey: requirement.intentKey, requirementKey: requirement.requirementKey, documentType: requirement.documentType, allowedDocumentTypes: policy.allowedDocumentTypes }];
    });
    return { enabled: Boolean(settings?.enabled && binding), requireUploadConsent: settings?.requireUploadConsent ?? true, maxFileBytes: Math.min(settings?.maxFileBytes ?? MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES), maxFilesPerRequest: settings?.maxFilesPerRequest ?? 1, maxPdfPages: settings?.maxPdfPages ?? 20, allowedMimeTypes: settings?.allowedMimeTypes ?? [], policies: policies.filter((policy) => policy.enabled && policy.allowUserInitiated).map((policy) => ({ intentKey: policy.intentKey, requestMode: policy.requestMode, allowedDocumentTypes: policy.allowedDocumentTypes, consentRequired: policy.consentRequired })), requirements, workflowKey: settings?.workflowKey ?? null, binding: binding ? { webhookPath: binding.webhookPath, payloadContract: binding.payloadContract } : null };
  };
  const protectedApi = authMiddleware(auth);
  const optionalApi = authMiddleware(auth, false);
  const staticChannelAuth: StaticChannelAuth | undefined = staticChannelApiKey
    ? { apiKey: staticChannelApiKey, channel: staticChannelName, ...(staticChannelTenantId ? { tenantId: staticChannelTenantId } : { tenantSlug: staticChannelTenantSlug! }) }
    : undefined;
  const channelApi = channelAuthMiddleware(store, channelVault, staticChannelAuth);
  const internalChatRequest = (req: Request): boolean => Boolean(chatStreamInternalSecret && req.header('x-agentic-internal-secret') === chatStreamInternalSecret && req.header('x-agentic-session-token-hash'));
  const chatApi = (req: Request, res: Response, next: NextFunction): void => {
    optionalApi(req, res, () => {
      if (getAuth(req) || internalChatRequest(req)) { next(); return; }
      void channelApi(req, res, next).catch(next);
    });
  };
  const authorizeSessionAccessToken = async (req: Request, session: Session): Promise<void> => {
    if (getAuth(req)) return;
    if (internalChatRequest(req) && await store.verifySessionAccessToken(session.id, req.header('x-agentic-session-token-hash')!)) return;
    const token = req.header('x-agentic-session-token');
    if (!sessionAccessTokenRequired && !token) return;
    if (!token || !(await store.verifySessionAccessToken(session.id, createHash('sha256').update(token).digest('hex')))) {
      throw new HttpError(401, token ? 'SESSION_TOKEN_INVALID' : 'SESSION_TOKEN_REQUIRED', 'A valid session access token is required.');
    }
  };
  const authorizeChatSession = async (req: Request, session: Session): Promise<void> => {
    ensureLiveSession(session.lastActivityAt, session.closedAt);
    await authorizeSessionAccessToken(req, session);
    const tenant = await activeTenant(store, session.tenantId);
    const channel = getChannel(req);
    if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
    else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
  };

  registerHealthRoutes(app, { store, cache });
  registerAuthRoutes(app, { store, auth, nodeEnv, protectedApi, publicUser });

  registerAdminRoutes(app, {
    store,
    auth,
    model,
    embedding,
    protectedApi,
    documentStorage,
    channelVault,
    ingestionWorkerSecret,
    tokenVault,
    getAuth,
    routeParam,
    tenantForRequest,
    activeTenant,
    publicUser,
    publicChannelCredential,
    observedTelemetry,
    newTelemetry,
    telemetry,
    tenantTelemetry,
    cachePing: () => cache.ping(),
    invalidateTenantCache,
    modelConfigured: Boolean(dependencies.model || dependencies.summaryModel),
    embeddingConfigured: Boolean(dependencies.embedding),
  });
  registerLifecycleRoutes(app, { store, gateway, chatApi, routeParam, authorizeSession: authorizeChatSession, advanceLifecycleStage });
  app.post('/api/v1/admin/ingestion-jobs', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(ingestionRequestSchema, req.body);
      await validateSourceUrl(store, tenantId, input.sourceUrl);
      const job = await store.createIngestionJob({ id: randomUUID(), tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public' });
      await publishIngestionProgress(store, job, 'queued', 0, 0, 'queued');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'ingestion.queued', metadata: { jobId: job.id }, createdAt: new Date().toISOString() });
      res.status(202).json({ job });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/sources', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(sourceSchema, req.body);
      if (['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(input.mimeType)) throw new HttpError(422, 'PYTHON_INGESTION_REQUIRED', 'Binary sources must use the file upload and Python ingestion worker.');
      await validateSourceUrl(store, tenantId, input.sourceUrl);
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const jobId = randomUUID();
      const createdJob = await store.createIngestionJob({ id: jobId, tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public' });
      const job = await store.claimIngestionJob(createdJob.id, INGESTION_LEASE_MS);
      if (!job) throw new HttpError(409, 'INGESTION_BUSY', 'The ingestion job could not be claimed.');
      await publishIngestionProgress(store, job, 'processing', 0, 0, 'processing');
      const sourceBase = { id: sourceId, tenantId, versionId };
      const safeContent = sanitizeKnowledgeText(input.content);
      const safeContentHash = contentHash(safeContent);
      const existing = await store.findSourceByHash(tenantId, safeContentHash);
      if (existing) {
        await store.updateIngestionJob({ ...job, sourceId: existing.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        res.status(200).json({ source: existing, ingestion: { jobId, status: 'completed', sourceStatus: existing.status, chunks: 0 }, idempotent: true });
        return;
      }
      try {
        const chunks = await buildChunksWithEmbeddings(sourceBase, safeContent, embedding);
        const source = await store.createSource({ id: sourceId, tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public', status: 'awaiting_review', embeddingReady: true, versionId, contentHash: safeContentHash, chunks });
        const completed = await store.updateIngestionJob({ ...job, sourceId: source.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await publishIngestionProgress(store, completed, 'completed', chunks.length, chunks.length, 'completed');
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.staged', metadata: { sourceId, chunks: chunks.length, jobId }, createdAt: new Date().toISOString() });
        res.status(201).json({ source, ingestion: { jobId, status: 'completed', sourceStatus: 'awaiting_review', chunks: chunks.length } });
      } catch (error) {
        const errorCode = error instanceof HttpError ? error.code : 'INGESTION_FAILED';
        const failed = await store.updateIngestionJob({ ...job, status: 'failed', errorCode, errorDetail: ingestionErrorDetail(error), leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await publishIngestionProgress(store, failed, 'failed', 0, 0, 'failed', errorCode);
        throw error;
      }
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/sources/upload', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(uploadSchema, req.body);
      const extension = ingestionStaging.extensionFor(input.mimeType);
      if (!extension || !input.fileName.toLowerCase().endsWith(extension)) throw new HttpError(422, 'FILE_TYPE_MISMATCH', 'The file extension does not match the selected type.');
      if (!isValidBase64(input.contentBase64)) throw new HttpError(422, 'INVALID_FILE_ENCODING', 'The file content must be valid base64.');
      const content = Buffer.from(input.contentBase64, 'base64');
      if (content.length === 0 || content.length > MAX_INGESTION_FILE_BYTES || content.toString('base64').replace(/=+$/, '') !== input.contentBase64.replace(/=+$/, '')) throw new HttpError(422, 'INVALID_FILE_CONTENT', 'The file is empty, malformed or exceeds the 20 MiB limit.');
      if (!hasValidFileSignature(input.mimeType, content)) throw new HttpError(422, 'INVALID_FILE_SIGNATURE', 'The file signature does not match its declared type.');
      const jobId = randomUUID();
      try {
        await ingestionStaging.write(jobId, input.mimeType, content);
        const job = await store.createIngestionJob({ id: jobId, tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: null, audience: input.audience ?? 'public' });
        await publishIngestionProgress(store, job, 'queued', 0, 0, 'queued');
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'ingestion.file_queued', metadata: { jobId, mimeType: input.mimeType, bytes: content.length }, createdAt: new Date().toISOString() });
        res.status(202).json({ job });
      } catch (error) {
        await ingestionStaging.purge(jobId, input.mimeType);
        throw error;
      }
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/intent-catalog/upload', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(intentCatalogUploadSchema, req.body);
      if (!isValidBase64(input.contentBase64)) throw new HttpError(422, 'INVALID_FILE_ENCODING', 'The workbook content must be valid base64.');
      const content = Buffer.from(input.contentBase64, 'base64');
      if (content.length === 0 || content.length > MAX_INGESTION_FILE_BYTES || content.toString('base64').replace(/=+$/, '') !== input.contentBase64.replace(/=+$/, '')) throw new HttpError(422, 'INVALID_FILE_CONTENT', 'The workbook is empty, malformed or exceeds the 20 MiB limit.');
      if (!hasValidFileSignature('application/vnd.agentic.intent-catalog+excel', content)) throw new HttpError(422, 'INVALID_FILE_SIGNATURE', 'The workbook signature is invalid.');
      const jobId = randomUUID();
      try {
        await ingestionStaging.write(jobId, 'application/vnd.agentic.intent-catalog+excel', content);
        const job = await store.createIngestionJob({ id: jobId, tenantId, title: input.fileName, mimeType: 'application/vnd.agentic.intent-catalog+excel', sourceUrl: null, audience: 'internal' });
        await publishIngestionProgress(store, job, 'queued', 0, 0, 'queued');
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog.queued', metadata: { jobId, bytes: content.length }, createdAt: new Date().toISOString() });
        res.status(202).json({ job });
      } catch (error) {
        await ingestionStaging.purge(jobId, 'application/vnd.agentic.intent-catalog+excel');
        throw error;
      }
    } catch (error) { next(error); }
  });
  app.post('/api/v2/admin/intent-catalog/preview', protectedApi, requireRoles('platform_admin', 'tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenant = await activeTenant(store, await tenantForRequest(store, req));
      const input = parse(intentCatalogV2Schema, req.body);
      const validation = validateCatalogV2(input.catalog);
      if (!validation.document) throw new HttpError(422, 'CATALOG_V2_VALIDATION_FAILED', validation.errors.join(' '));
      if (validation.document.manifest.tenantScope !== tenant.slug) throw new HttpError(422, 'CATALOG_TENANT_MISMATCH', 'The catalog tenant scope does not match the selected tenant.');
      res.json({ valid: true, catalogVersionRef: catalogV2VersionRef(validation.document), sourceHash: input.sourceHash ?? catalogV2Sha256(validation.document), catalog: validation.document });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/admin/intent-catalog/versions', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenant = await activeTenant(store, await tenantForRequest(store, req));
      const input = parse(intentCatalogV2Schema, req.body);
      const validation = validateCatalogV2(input.catalog);
      if (!validation.document) throw new HttpError(422, 'CATALOG_V2_VALIDATION_FAILED', validation.errors.join(' '));
      if (validation.document.manifest.tenantScope !== tenant.slug) throw new HttpError(422, 'CATALOG_TENANT_MISMATCH', 'The catalog tenant scope does not match the selected tenant.');
      const version = await store.createIntentCatalogV2Version({ tenantId: tenant.id, status: 'draft', sourceFileName: input.sourceFileName, sourceHash: input.sourceHash ?? catalogV2Sha256(validation.document), parserVersion: 'intent-catalog-v2-admin-1.0.0', catalog: validation.document, catalogVersionRef: catalogV2VersionRef(validation.document) });
      await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog_v2.draft_created', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() });
      res.status(201).json({ version });
    } catch (error) { next(error); }
  });
  app.get('/api/v2/admin/intent-catalog/versions', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listIntentCatalogV2Versions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v2/admin/intent-catalog/legacy/versions', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      res.json({ items: (await store.listIntentCatalogVersions(tenantId)).map(auditLegacyCatalogVersion) });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/admin/intent-catalog/legacy/versions/:id/migration-candidate', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const tenant = await activeTenant(store, tenantId);
      const legacyVersion = await store.getIntentCatalogVersion(tenantId, routeParam(req, 'id'));
      if (!legacyVersion) throw new HttpError(404, 'INTENT_CATALOG_VERSION_NOT_FOUND', 'Legacy intent catalog version not found.');
      const input = parse(intentCatalogV2MigrationSchema, req.body);
      let candidate: ReturnType<typeof createLegacyCatalogV2Candidate>;
      try {
        candidate = createLegacyCatalogV2Candidate({ legacyVersion, tenantScope: tenant.slug, proposedCatalog: input.catalog });
      } catch (error) {
        throw new HttpError(422, 'CATALOG_V2_MIGRATION_FAILED', error instanceof Error ? error.message : 'The v1 catalog mapping is not a valid v2 candidate.');
      }
      const version = await store.createIntentCatalogV2Version({ tenantId, status: 'draft', sourceFileName: input.sourceFileName ?? `migration-${legacyVersion.sourceFileName}`, sourceHash: catalogV2Sha256(candidate.catalog), parserVersion: 'intent-catalog-v1-migration-review-1.0.0', catalog: candidate.catalog, catalogVersionRef: candidate.catalogVersionRef });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog_v2.legacy_migration_candidate_created', metadata: { sourceVersionId: legacyVersion.id, sourceHash: legacyVersion.sourceHash, candidateId: candidate.candidateId, versionId: version.id, autoPublished: false }, createdAt: new Date().toISOString() });
      res.status(201).json({ audit: auditLegacyCatalogVersion(legacyVersion), candidate: { ...candidate, catalog: undefined }, version });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/admin/intent-catalog/versions/:id/publish', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const version = await store.getIntentCatalogV2Version(tenantId, routeParam(req, 'id'));
      if (!version) throw new HttpError(404, 'INTENT_CATALOG_V2_VERSION_NOT_FOUND', 'Intent catalog v2 version not found.');
      const validation = validatePublishedCatalogV2(version.catalog, { published: true, tenantScope: (await activeTenant(store, tenantId)).slug, pinnedVersionRef: version.catalogVersionRef });
      if (!validation.ok) throw new HttpError(422, 'CATALOG_V2_PUBLICATION_FAILED', validation.errors.join(' '));
      const published = await store.publishIntentCatalogV2Version(tenantId, version.id);
      if (!published) throw new HttpError(404, 'INTENT_CATALOG_V2_VERSION_NOT_FOUND', 'Intent catalog v2 version not found.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog_v2.published', metadata: { versionId: published.id, version: published.version }, createdAt: new Date().toISOString() });
      res.json({ version: published });
    } catch (error) { next(error); }
  });
  app.get('/api/v2/admin/intent-catalog/published/export', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const version = (await store.listIntentCatalogV2Versions(tenantId)).find((candidate) => candidate.status === 'published');
      if (!version) throw new HttpError(404, 'PUBLISHED_INTENT_CATALOG_V2_NOT_FOUND', 'No published v2 intent catalog is available for this tenant.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog_v2.exported', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() });
      const workbook = exportCatalogV2Workbook(version.catalog);
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition', `attachment; filename="${(await activeTenant(store, tenantId)).slug}-intent-catalog-v2-${version.version}.xlsx"`);
      res.send(workbook);
    } catch (error) { next(error); }
  });
  app.get('/api/v2/admin/intent-catalog/published/export.json', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const version = (await store.listIntentCatalogV2Versions(tenantId)).find((candidate) => candidate.status === 'published');
      if (!version) throw new HttpError(404, 'PUBLISHED_INTENT_CATALOG_V2_NOT_FOUND', 'No published v2 intent catalog is available for this tenant.');
      res.json(version.catalog);
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/intent-catalog/versions', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listIntentCatalogVersions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/intent-catalog/published/export', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const tenant = await activeTenant(store, tenantId);
      const version = await store.getPublishedIntentCatalog(tenantId);
      if (!version) throw new HttpError(404, 'PUBLISHED_INTENT_CATALOG_NOT_FOUND', 'No published intent catalog is available for this tenant.');
      const workbook = exportIntentCatalogWorkbook(version, tenant.slug);
      const fileName = `${tenant.slug}-intent-catalog-v${version.version}.xlsx`.replace(/[^a-z0-9._-]/giu, '_');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog.exported', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() });
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('content-disposition', `attachment; filename="${fileName}"`);
      res.setHeader('content-length', String(workbook.length));
      res.send(workbook);
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/intent-catalog/versions/:id/drafts', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const tenant = await activeTenant(store, tenantId);
      const version = await store.getIntentCatalogVersion(tenantId, routeParam(req, 'id'));
      if (!version) throw new HttpError(404, 'INTENT_CATALOG_VERSION_NOT_FOUND', 'Intent catalog version not found.');
      const input = parse(intentCatalogEditSchema, req.body);
      const validation = validateIntentCatalog(input.catalog);
      if (!validation.catalog) throw new HttpError(422, 'CATALOG_VALIDATION_FAILED', validation.errors.join(' '));
      if (validation.catalog.tenantScope && validation.catalog.tenantScope !== tenant.slug) throw new HttpError(422, 'CATALOG_TENANT_MISMATCH', 'The catalog tenant scope does not match the selected tenant.');
      const catalogJson = JSON.stringify(validation.catalog);
      const draft = await store.createIntentCatalogVersion({ tenantId, status: 'draft', sourceFileName: `${version.sourceFileName} (manual edit)`, sourceHash: contentHash(catalogJson), parserVersion: 'intent-catalog-manual-1.0.0', catalog: validation.catalog });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog.edited', metadata: { baseVersionId: version.id, versionId: draft.id, version: draft.version }, createdAt: new Date().toISOString() });
      res.status(201).json({ version: draft });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/intent-catalog/versions/:id/publish', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const version = await store.publishIntentCatalogVersion(tenantId, routeParam(req, 'id'));
      if (!version) throw new HttpError(404, 'INTENT_CATALOG_VERSION_NOT_FOUND', 'Intent catalog version not found.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog.published', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() });
      await invalidateTenantCache(tenantId);
      res.json({ version });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/sources', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listSources(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/sources/:id/versions', protectedApi, async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const source = await store.getSource(routeParam(req, 'id'));
      if (!source || source.tenantId !== tenantId) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
      res.json({ items: await store.listSourceVersions(source.id, tenantId) });
    } catch (error) { next(error); }
  });
  const setSourceStatus = (status: SourceStatus) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const sourceId = routeParam(req, 'id');
      const current = await store.getSource(sourceId);
      if (!current || current.tenantId !== tenantId) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
      if (status === 'active' && current.embeddingReady === false) throw new HttpError(409, 'SOURCE_REINDEX_REQUIRED', 'Reindex this source before publishing it.');
      const source = await store.setSourceStatus(sourceId, tenantId, status);
      if (!source) throw new HttpError(409, status === 'active' ? 'SOURCE_REINDEX_REQUIRED' : 'SOURCE_STATUS_CONFLICT', 'The source status could not be changed.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: `source.${status}`, metadata: { sourceId: source.id }, createdAt: new Date().toISOString() });
      await invalidateTenantCache(tenantId);
      res.json({ source });
    } catch (error) { next(error); }
  };
  app.post('/api/v1/admin/sources/:id/publish', protectedApi, requireRoles('tenant_admin'), setSourceStatus('active'));
  app.post('/api/v1/admin/sources/:id/revoke', protectedApi, requireRoles('tenant_admin'), setSourceStatus('revoked'));
  app.delete('/api/v1/admin/sources/:id', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const source = await store.getSource(routeParam(req, 'id'));
      if (!source || source.tenantId !== tenantId) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
      if (source.status !== 'revoked') throw new HttpError(409, 'SOURCE_NOT_REVOKED', 'Revoke the source before purging it.');
      if (!(await store.purgeSource(source.id, tenantId))) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.purged', metadata: { sourceId: source.id }, createdAt: new Date().toISOString() });
      await invalidateTenantCache(tenantId);
      res.status(204).send();
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/sources/:id/reindex', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const source = await store.getSource(routeParam(req, 'id'));
      if (!source || source.tenantId !== tenantId) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
      const currentChunks = await store.listSourceChunks(source.id, tenantId);
      if (currentChunks.length === 0) throw new HttpError(422, 'SOURCE_EMPTY', 'The source has no current chunks to reindex.');
      const createdJob = await store.createIngestionJob({ id: randomUUID(), tenantId, title: source.title, mimeType: source.mimeType, sourceUrl: source.sourceUrl, audience: source.audience });
      const job = await store.claimIngestionJob(createdJob.id, INGESTION_LEASE_MS);
      if (!job) throw new HttpError(409, 'INGESTION_BUSY', 'The reindex job could not be claimed.');
      await publishIngestionProgress(store, job, 'processing', 0, currentChunks.length, 'processing');
      try {
        const versionId = randomUUID();
        const chunks = await buildIngestionChunksWithEmbeddings({ id: source.id, tenantId, versionId }, currentChunks.map((chunk) => ({ ordinal: chunk.ordinal, locator: chunk.locator, content: chunk.content, contentHash: chunk.contentHash })), embedding, async (processed, total) => publishIngestionProgress(store, job, 'embedding', processed, total, 'processing'));
        const updated = await store.replaceSourceVersion({ sourceId: source.id, tenantId, versionId, contentHash: source.contentHash, chunks });
        if (!updated) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
        const completed = await store.updateIngestionJob({ ...job, sourceId: updated.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await publishIngestionProgress(store, completed, 'completed', chunks.length, chunks.length, 'completed');
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.reindexed', metadata: { sourceId: source.id, jobId: job.id, versionId }, createdAt: new Date().toISOString() });
        await invalidateTenantCache(tenantId);
        res.json({ job: completed, source: updated, ingestion: { status: 'awaiting_review', chunks: chunks.length } });
      } catch (error) {
        const errorCode = error instanceof HttpError ? error.code : 'INGESTION_FAILED';
        const failed = await store.updateIngestionJob({ ...job, status: 'failed', errorCode, errorDetail: ingestionErrorDetail(error), leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await publishIngestionProgress(store, failed, 'failed', 0, currentChunks.length, 'failed', errorCode);
        throw error;
      }
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/ingestion-jobs', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listIngestionJobs(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/ingestion-jobs/:id', protectedApi, async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const job = await store.getIngestionJob(routeParam(req, 'id')); if (!job || job.tenantId !== tenantId) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.'); const source = job.sourceId ? await store.getSource(job.sourceId) : null; res.json({ job, source: source ? { id: source.id, versionId: source.versionId, status: source.status } : null }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/ingestion-jobs/:id/retry', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const job = await store.getIngestionJob(routeParam(req, 'id'));
      if (!job || job.tenantId !== tenantId) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
      if (job.status !== 'failed') throw new HttpError(409, 'JOB_NOT_FAILED', 'Only failed ingestion jobs can be retried.');
      if (!job.sourceUrl && !(await ingestionStaging.read(job.id, job.mimeType))) throw new HttpError(409, 'INGESTION_INPUT_NOT_FOUND', 'The original upload is no longer available. Upload the file again to retry.');
      const queued = await store.updateIngestionJob({ ...job, status: 'queued', errorCode: null, errorDetail: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'ingestion.retried', metadata: { jobId: job.id }, createdAt: new Date().toISOString() });
      res.json({ job: queued });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/:id/claim', workerApi, async (req, res, next) => {
    try {
      const job = await store.getIngestionJob(routeParam(req, 'id'));
      if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
      const claimed = await store.claimIngestionJob(job.id, INGESTION_LEASE_MS);
      if (!claimed) throw new HttpError(409, 'INGESTION_BUSY', 'The ingestion job is already claimed or complete.');
      await publishIngestionProgress(store, claimed, 'processing', 0, 0, 'processing');
      res.json({ job: claimed });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/claim-next', workerApi, async (_req, res, next) => {
    try {
      const job = await store.claimNextIngestionJob(INGESTION_LEASE_MS);
      if (job) await publishIngestionProgress(store, job, 'processing', 0, 0, 'processing');
      res.json({ job });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/:id/renew', workerApi, async (req, res, next) => {
    try {
      const jobId = routeParam(req, 'id');
      const input = parse(ingestionRenewSchema, { ...req.body, jobId });
      const renewed = await store.renewIngestionJob(jobId, input.leaseMs ?? 120_000);
      if (!renewed) throw new HttpError(409, 'INGESTION_NOT_CLAIMED', 'The ingestion job is not actively leased.');
      res.json({ job: renewed });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/internal/ingestion-jobs/:id/input', workerApi, async (req, res, next) => {
    try {
      const job = await store.getIngestionJob(routeParam(req, 'id'));
      if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
      if (job.status !== 'processing' || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new HttpError(409, 'INGESTION_NOT_CLAIMED', 'The ingestion job is not actively leased.');
      const content = await ingestionStaging.read(job.id, job.mimeType);
      if (!content) throw new HttpError(404, 'INGESTION_INPUT_NOT_FOUND', 'No private file input is attached to this job.');
      const extension = ingestionStaging.extensionFor(job.mimeType);
      res.json({ fileName: `${job.id}${extension ?? ''}`, mimeType: job.mimeType, contentBase64: content.toString('base64') });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/:id/failure', workerApi, async (req, res, next) => {
    try {
      const job = await store.getIngestionJob(routeParam(req, 'id'));
      if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
      if (job.status !== 'processing' || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new HttpError(409, 'INGESTION_NOT_CLAIMED', 'The ingestion job is not actively leased.');
      const input = parse(ingestionFailureSchema, req.body);
      const errorCode = input.errorCode ?? 'INGESTION_FAILED';
      const failed = await store.updateIngestionJob({ ...job, status: 'failed', errorCode, errorDetail: input.errorDetail ? ingestionErrorDetail(input.errorDetail) : null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      await ingestionStaging.purge(job.id, job.mimeType);
      await publishIngestionProgress(store, failed, 'failed', 0, 0, 'failed', errorCode);
      await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'ingestion.failed', metadata: { jobId: job.id, errorCode }, createdAt: new Date().toISOString() });
      res.json({ job: failed });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/:id/result', workerApi, async (req, res, next) => {
    try {
      const job = await store.getIngestionJob(routeParam(req, 'id'));
      if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
      if (job.status !== 'processing' || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new HttpError(409, 'INGESTION_NOT_CLAIMED', 'The ingestion job is not actively leased.');
      if (job.mimeType === 'application/vnd.agentic.intent-catalog+excel') {
        try {
          const input = parse(intentCatalogResultSchema, req.body);
          if (input.catalog && typeof input.catalog === 'object' && !Array.isArray(input.catalog) && (input.catalog as { schemaVersion?: unknown }).schemaVersion === 2) {
            const validation = validateCatalogV2(input.catalog);
            if (!validation.document) throw new HttpError(422, 'CATALOG_V2_VALIDATION_FAILED', validation.errors.join(' '));
            const tenant = await store.getTenant(job.tenantId);
            if (validation.document.manifest.tenantScope !== tenant?.slug) throw new HttpError(422, 'CATALOG_TENANT_MISMATCH', 'The workbook tenant scope does not match the target tenant.');
            const existing = (await store.listIntentCatalogV2Versions(job.tenantId)).find((version) => version.sourceHash === input.sourceHash);
            if (existing) {
              const completed = await store.updateIngestionJob({ ...job, status: 'completed', errorDetail: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
              await ingestionStaging.purge(job.id, job.mimeType);
              await publishIngestionProgress(store, completed, 'completed', 1, 1, 'completed');
              res.status(200).json({ job: completed, version: existing, idempotent: true });
              return;
            }
            const version = await store.createIntentCatalogV2Version({ tenantId: job.tenantId, status: 'draft', sourceFileName: job.title, sourceHash: input.sourceHash, parserVersion: input.parserVersion, catalog: validation.document, catalogVersionRef: catalogV2VersionRef(validation.document) });
            const completed = await store.updateIngestionJob({ ...job, status: 'completed', errorDetail: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
            await ingestionStaging.purge(job.id, job.mimeType);
            await publishIngestionProgress(store, completed, 'completed', 1, 1, 'completed');
            await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'intent_catalog_v2.imported', metadata: { versionId: version.id, version: version.version, jobId: job.id }, createdAt: new Date().toISOString() });
            res.status(201).json({ job: completed, version });
            return;
          }
          const validation = validateIntentCatalog(input.catalog);
          if (!validation.catalog) throw new HttpError(422, 'CATALOG_VALIDATION_FAILED', validation.errors.join(' '));
          const tenant = await store.getTenant(job.tenantId);
          if (validation.catalog.tenantScope && tenant && validation.catalog.tenantScope !== tenant.slug) throw new HttpError(422, 'CATALOG_TENANT_MISMATCH', 'The workbook tenant scope does not match the target tenant.');
          const existing = (await store.listIntentCatalogVersions(job.tenantId)).find((version) => version.sourceHash === input.sourceHash);
          if (existing) {
            const completed = await store.updateIngestionJob({ ...job, status: 'completed', errorDetail: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
            await ingestionStaging.purge(job.id, job.mimeType);
            await publishIngestionProgress(store, completed, 'completed', 1, 1, 'completed');
            res.status(200).json({ job: completed, version: existing, idempotent: true });
            return;
          }
          const version = await store.createIntentCatalogVersion({ tenantId: job.tenantId, status: 'draft', sourceFileName: job.title, sourceHash: input.sourceHash, parserVersion: input.parserVersion, catalog: validation.catalog });
          const completed = await store.updateIngestionJob({ ...job, status: 'completed', errorDetail: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
          await ingestionStaging.purge(job.id, job.mimeType);
          await publishIngestionProgress(store, completed, 'completed', 1, 1, 'completed');
          await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'intent_catalog.imported', metadata: { versionId: version.id, version: version.version, jobId: job.id }, createdAt: new Date().toISOString() });
          res.status(201).json({ job: completed, version });
          return;
        } catch (error) {
          const current = await store.getIngestionJob(job.id);
          if (current?.status === 'processing') {
            const errorCode = error instanceof HttpError ? error.code : 'CATALOG_IMPORT_FAILED';
            const failed = await store.updateIngestionJob({ ...current, status: 'failed', errorCode, errorDetail: ingestionErrorDetail(error), leaseExpiresAt: null, updatedAt: new Date().toISOString() });
            await publishIngestionProgress(store, failed, 'failed', 0, 0, 'failed', errorCode);
          }
          await ingestionStaging.purge(job.id, job.mimeType);
          throw error;
        }
      }
      if (job.mimeType === 'application/zip' && (req.body as { kind?: unknown } | null)?.kind === 'archive_members') {
        const input = parse(ingestionArchiveResultSchema, req.body);
        // Validate the complete worker result before creating any source.
        const members = input.members.map((member) => {
          const normalizedContent = canonicalKnowledgeText(member.normalizedContent);
          if (contentHash(normalizedContent) !== member.contentHash) throw new HttpError(422, 'CONTENT_HASH_MISMATCH', 'Archive member content hash is invalid.');
          const ordered = [...member.chunks].sort((left, right) => left.ordinal - right.ordinal);
          if (ordered.some((chunk, index) => chunk.ordinal !== index)) throw new HttpError(422, 'INVALID_CHUNK_ORDER', 'Archive member chunks must have contiguous ordinals.');
          const chunks = ordered.map((chunk) => ({ ...chunk, content: sanitizeKnowledgeText(chunk.content) }));
          if (chunks.some((chunk) => contentHash(chunk.content) !== chunk.contentHash)) throw new HttpError(422, 'CHUNK_HASH_MISMATCH', 'Archive member chunk hash is invalid.');
          return { ...member, normalizedContent, chunks };
        });
        const totalBytes = members.reduce((count, member) => count + Buffer.byteLength(member.normalizedContent, 'utf8'), 0);
        const totalChunks = members.reduce((count, member) => count + member.chunks.length, 0);
        if (totalBytes > 25 * 1024 * 1024 || totalChunks > 100_000) throw new HttpError(422, 'ARCHIVE_RESULT_OVERSIZED', 'Archive contents exceed the configured ingestion budget.');
        const names = new Set<string>();
        for (const member of members) {
          const name = member.fileName.toLowerCase();
          if (names.has(name)) throw new HttpError(422, 'ARCHIVE_DUPLICATE_MEMBER', 'The ZIP contains duplicate member paths.');
          names.add(name);
        }
        const summaries: Array<{ id: string; title: string; status: string; reused: boolean }> = [];
        let processedChunks = 0;
        try {
          await publishIngestionProgress(store, job, 'embedding', 0, totalChunks, 'processing');
          for (const [index, member] of members.entries()) {
            const title = `${job.title} / ${sanitizeKnowledgeText(member.fileName).replace(/\\|\//gu, ' · ')}`.slice(0, 200);
            let source = await store.findSourceByHash(job.tenantId, member.contentHash);
            const reused = Boolean(source);
            if (!source) {
              const sourceId = randomUUID();
              const versionId = randomUUID();
              const embeddedChunks = await buildIngestionChunksWithEmbeddings(
                { id: sourceId, tenantId: job.tenantId, versionId },
                member.chunks,
                embedding,
                async (done) => publishIngestionProgress(store, job, 'embedding', processedChunks + done, totalChunks, 'processing'),
              );
              source = await store.createSource({
                id: sourceId, tenantId: job.tenantId, title, mimeType: member.mimeType,
                sourceUrl: null, audience: job.audience, status: 'awaiting_review',
                embeddingReady: true, versionId, contentHash: member.contentHash, chunks: embeddedChunks,
              });
              await store.addAudit({
                id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'source.archive_member_ingested',
                metadata: { archiveJobId: job.id, memberIndex: index, sourceId: source.id, chunks: embeddedChunks.length },
                createdAt: new Date().toISOString(),
              });
            }
            processedChunks += member.chunks.length;
            summaries.push({ id: source.id, title: source.title, status: source.status, reused });
            await publishIngestionProgress(store, job, 'embedding', processedChunks, totalChunks, 'processing');
          }
          const completed = await store.updateIngestionJob({
            ...job, sourceId: summaries[0]?.id ?? null, status: 'completed',
            errorDetail: input.warnings.length ? ingestionErrorDetail(input.warnings.join(' | ')) : null,
            leaseExpiresAt: null, updatedAt: new Date().toISOString(),
          });
          await ingestionStaging.purge(job.id, job.mimeType);
          await publishIngestionProgress(store, completed, 'completed', totalChunks, totalChunks, 'completed');
          await store.addAudit({
            id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'ingestion.archive_completed',
            metadata: { archiveJobId: job.id, sourceCount: summaries.length, reusedCount: summaries.filter(item => item.reused).length },
            createdAt: new Date().toISOString(),
          });
          res.status(201).json({ job: completed, sources: summaries, ingestion: { status: 'awaiting_review', sourceCount: summaries.length, chunks: totalChunks }, warnings: input.warnings });
          return;
        } catch (error) {
          const errorCode = error instanceof HttpError ? error.code : 'ARCHIVE_INGESTION_FAILED';
          const current = await store.getIngestionJob(job.id);
          if (current?.status === 'processing') {
            const failed = await store.updateIngestionJob({
              ...current, status: 'failed', errorCode, errorDetail: ingestionErrorDetail(error),
              leaseExpiresAt: null, updatedAt: new Date().toISOString(),
            });
            await publishIngestionProgress(store, failed, 'failed', processedChunks, totalChunks, 'failed', errorCode);
          }
          // Already inserted members are retained and deduplicated on retry.
          throw error;
        }
      }
      const input = parse(ingestionResultSchema, req.body);
      const warnings = input.warnings ?? [];
      const normalizedContent = canonicalKnowledgeText(input.normalizedContent);
      if (contentHash(normalizedContent) !== input.contentHash) throw new HttpError(422, 'CONTENT_HASH_MISMATCH', 'The normalized content hash does not match the worker result.');
      const chunks = [...input.chunks].sort((left, right) => left.ordinal - right.ordinal);
      if (chunks.some((chunk, index) => chunk.ordinal !== index)) throw new HttpError(422, 'INVALID_CHUNK_ORDER', 'Worker chunks must use contiguous ordinals.');
      const safeChunks = chunks.map((chunk) => ({ ...chunk, content: sanitizeKnowledgeText(chunk.content) }));
      if (safeChunks.some((chunk) => contentHash(chunk.content) !== chunk.contentHash)) throw new HttpError(422, 'CHUNK_HASH_MISMATCH', 'A worker chunk hash does not match sanitized content.');
      const existing = await store.findSourceByHash(job.tenantId, input.contentHash);
      if (existing) {
        const completed = await store.updateIngestionJob({ ...job, sourceId: existing.id, status: 'completed', errorDetail: warnings.length ? ingestionErrorDetail(warnings.join(' | ')) : null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await ingestionStaging.purge(job.id, job.mimeType);
        await publishIngestionProgress(store, completed, 'completed', chunks.length, chunks.length, 'completed');
        res.status(200).json({ job: completed, source: existing, idempotent: true });
        return;
      }
      try {
        const sourceId = randomUUID();
        const versionId = randomUUID();
        await publishIngestionProgress(store, job, 'embedding', 0, safeChunks.length, 'processing');
        const embeddedChunks = await buildIngestionChunksWithEmbeddings({ id: sourceId, tenantId: job.tenantId, versionId }, safeChunks, embedding, async (processed, total) => publishIngestionProgress(store, job, 'embedding', processed, total, 'processing'));
        const source = await store.createSource({ id: sourceId, tenantId: job.tenantId, title: job.title, mimeType: job.mimeType, sourceUrl: job.sourceUrl, audience: job.audience, status: 'awaiting_review', embeddingReady: true, versionId, contentHash: input.contentHash, chunks: embeddedChunks });
        const completed = await store.updateIngestionJob({ ...job, sourceId: source.id, status: 'completed', errorDetail: warnings.length ? ingestionErrorDetail(warnings.join(' | ')) : null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await ingestionStaging.purge(job.id, job.mimeType);
        await publishIngestionProgress(store, completed, 'completed', embeddedChunks.length, embeddedChunks.length, 'completed');
        await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'source.ingested', metadata: { sourceId, jobId: job.id, parserVersion: input.parserVersion, chunks: embeddedChunks.length }, createdAt: new Date().toISOString() });
        res.status(201).json({ job: completed, source, ingestion: { status: 'awaiting_review', chunks: embeddedChunks.length } });
      } catch (error) {
        const errorCode = error instanceof HttpError ? error.code : 'INGESTION_FAILED';
        const failed = await store.updateIngestionJob({ ...job, status: 'failed', errorCode, errorDetail: ingestionErrorDetail(error), leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await publishIngestionProgress(store, failed, 'failed', 0, safeChunks.length, 'failed', errorCode);
        throw error;
      }
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/documents/:id/process', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(z.object({ tenantId: z.string().guid(), jobId: z.string().guid() }), req.body);
      const document = await store.getSupportingDocument(routeParam(req, 'id'), input.tenantId);
      const job = await store.getDocumentProcessingJob(input.jobId, input.tenantId);
      const config = await documentConfig(input.tenantId);
      if (!document || !job || job.documentId !== document.id || !config.enabled || job.workflowKey !== config.workflowKey) throw new HttpError(409, 'DOCUMENT_WORKFLOW_NOT_AUTHORIZED', 'The document workflow is not enabled for this tenant.');
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'document.workflow_accepted', metadata: { documentId: document.id, jobId: job.id, workflowKey: job.workflowKey }, createdAt: new Date().toISOString() });
      res.status(202).json({ accepted: true, documentId: document.id, jobId: job.id });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/document-jobs/claim-next', workerApi, async (_req, res, next) => {
    try {
      const job = await store.claimNextDocumentProcessingJob(60_000);
      if (!job) { res.json({ job: null }); return; }
      const document = await store.getSupportingDocument(job.documentId, job.tenantId);
      if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'The document for this job no longer exists.');
      await store.updateSupportingDocument({ ...document, status: 'processing', updatedAt: new Date().toISOString() });
      res.json({ job, document: { id: document.id, tenantId: document.tenantId, sessionId: document.sessionId, fileName: document.fileName, mimeType: document.mimeType } });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/document-jobs/:id/renew', workerApi, async (req, res, next) => {
    try {
      const input = parse(documentRenewSchema, req.body);
      if (input.jobId !== routeParam(req, 'id')) throw new HttpError(400, 'DOCUMENT_JOB_MISMATCH', 'The job ID does not match the route.');
      const job = await store.renewDocumentProcessingJob(input.jobId, input.tenantId, input.leaseMs ?? 120_000);
      if (!job) throw new HttpError(409, 'DOCUMENT_JOB_NOT_CLAIMED', 'The document job is not actively leased.');
      res.json({ job });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/internal/document-jobs/:id/input', workerApi, async (req, res, next) => {
    try {
      const jobId = routeParam(req, 'id');
      const tenantId = req.header('x-tenant-id') ?? '';
      const actualJob = await store.getDocumentProcessingJob(jobId, tenantId);
      if (!actualJob || actualJob.status !== 'processing' || !actualJob.leaseExpiresAt || Date.parse(actualJob.leaseExpiresAt) <= Date.now()) throw new HttpError(409, 'DOCUMENT_JOB_NOT_CLAIMED', 'The document job is not actively leased.');
      const document = await store.getSupportingDocument(actualJob.documentId, actualJob.tenantId);
      if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      const content = await documentStorage.read(document.storageKey);
      if (!content) throw new HttpError(404, 'DOCUMENT_INPUT_NOT_FOUND', 'Private document input not found.');
      res.json({ jobId: actualJob.id, documentId: document.id, fileName: document.fileName, mimeType: document.mimeType, contentBase64: content.toString('base64') });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/document-jobs/:id/result', workerApi, async (req, res, next) => {
    try {
      const input = parse(documentResultSchema, req.body);
      const job = await store.getDocumentProcessingJob(input.jobId, input.tenantId);
      if (!job || job.id !== routeParam(req, 'id') || job.status !== 'processing' || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new HttpError(409, 'DOCUMENT_JOB_NOT_CLAIMED', 'The document job is not actively leased.');
      const document = await store.getSupportingDocument(job.documentId, input.tenantId);
      if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      const session = await store.getSession(document.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Document session not found.');
      const tokenCountBeforeMasking = session.tokenMap.size;
      const extractedText = document.storeExtractedText && input.extractedText ? maskPiiForSession(session, input.extractedText, tokenVault) : null;
      const summary = input.summary ? maskPiiForSession(session, input.summary, tokenVault) : null;
      if (session.tokenMap.size > tokenCountBeforeMasking) await updateSessionSafely(session, false, 'workflow');
      const completedDocument = await store.updateSupportingDocument({ ...document, status: 'completed', extractedText, summary, errorCode: null, updatedAt: new Date().toISOString() });
      let salesforceLeadSyncVerified = false;
      const completedJob = await store.updateDocumentProcessingJob({ ...job, status: 'completed', leaseExpiresAt: null, executionReference: input.executionReference ?? job.executionReference, updatedAt: new Date().toISOString() });
      if (document.leadId) { const lead = await store.getCrmLead(document.leadId, input.tenantId); if (lead) { const documents = await store.listSupportingDocuments(lead.tenantId, undefined, lead.id); const composed = [lead.summary, composeDocumentSummary(lead, documents)].filter(Boolean).join('\n').slice(0, 20_000); await store.updateCrmLeadSummary(lead.id, lead.tenantId, composed, 'completed'); } }
      if (summary) salesforceLeadSyncVerified = await syncSalesforceLeadDocument(session, completedDocument, composeDocumentMetadata(completedDocument));
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'document.completed', metadata: { documentId: document.id, jobId: job.id, status: 'completed' }, createdAt: new Date().toISOString() });
      if (document.opportunityId && document.intentKey) {
        // Completing one OCR job does not prove every required document is present.
        // Local OCR evidence must never be represented as an external SF-02 attachment.
        const currentState = (await store.getSession(session.id))?.conversationState;
        const journey = currentState?.intentProgress?.entries[document.intentKey];
        if (journey?.journeyId === document.opportunityId && journey.lifecycle?.currentStage === 'document_upload') {
          const selections = await store.listPackageSelections(document.tenantId, document.opportunityId);
          const selected = selections.find((item) => item.status === 'confirmed' && item.sessionId === session.id && item.quoteId);
          const offering = selected ? await store.getPackageOffering(selected.packageOfferingId, document.tenantId) : null;
          const quote = selected?.quoteId ? await store.getQuote(selected.quoteId, document.tenantId) : null;
          const pinnedV2 = document.catalogVersionId
            ? (await store.listIntentCatalogV2Versions(document.tenantId)).find((candidate) => candidate.status === 'published' && (candidate.id === document.catalogVersionId || candidate.catalogVersionRef === document.catalogVersionId))
            : null;
          if (selected && offering && quote && quote.status === 'approved'
            && Date.parse(quote.validUntil) > Date.now() && quote.opportunityId === document.opportunityId
            && quote.packageOfferingId === offering.id && offering.approvalStatus === 'approved'
            && (pinnedV2 ? offering.catalogVersionRef === pinnedV2.catalogVersionRef : offering.catalogVersionId === document.catalogVersionId)) {
            const documents = await store.listSupportingDocuments(document.tenantId, session.id);
            const allProcessed = requiredDocumentSetComplete(offering.requiredDocuments, documents, {
              tenantId: document.tenantId, sessionId: session.id,
              opportunityId: document.opportunityId, intentKey: document.intentKey,
              catalogVersionId: document.catalogVersionId ?? '',
            });
            if (allProcessed) {
              const sf02AttachmentVerified = await verifyMockSf02Attachment(session, completedDocument);
              await advanceLifecycleStage(session, 'document_upload', {
                documentId: document.id, documentSetComplete: true, ocrStatus: 'completed',
                localProcessingVerified: true, sf02AttachmentVerified,
              });
            }
          }
        }
      }
      res.json({ document: publicDocument(completedDocument), job: completedJob, salesforceLeadSyncVerified });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/document-jobs/:id/failure', workerApi, async (req, res, next) => {
    try {
      const input = parse(documentFailureSchema, req.body);
      const job = await store.getDocumentProcessingJob(input.jobId, input.tenantId);
      if (!job || job.id !== routeParam(req, 'id') || job.status !== 'processing') throw new HttpError(409, 'DOCUMENT_JOB_NOT_CLAIMED', 'The document job is not actively leased.');
      const document = await store.getSupportingDocument(job.documentId, input.tenantId);
      if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      const errorCodeValue = input.errorCode ?? 'DOCUMENT_OCR_FAILED';
      const failedDocument = await store.updateSupportingDocument({ ...document, status: 'failed', errorCode: errorCodeValue, updatedAt: new Date().toISOString() });
      const failedJob = await store.updateDocumentProcessingJob({ ...job, status: 'failed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'document.failed', metadata: { documentId: document.id, jobId: job.id, errorCode: errorCodeValue }, createdAt: new Date().toISOString() });
      res.json({ document: publicDocument(failedDocument), job: failedJob });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/sessions', chatApi, async (req, res, next) => {
    try {
      const channel = getChannel(req);
      const input = parse(sessionSchema, req.body);
      if (channel && (input.tenantId || input.tenantSlug)) throw new HttpError(400, 'CHANNEL_TENANT_INPUT_FORBIDDEN', 'Signed channel sessions resolve the tenant from the channel credential.');
      if (!channel && !input.tenantId && !input.tenantSlug) throw new HttpError(422, 'TENANT_REQUIRED', 'tenantId or tenantSlug is required.');
      if (input.tenantId && !getAuth(req)) throw new HttpError(403, 'TENANT_REQUIRED', 'Public sessions must use an approved tenant slug.');
      const tenant = channel ? await store.getTenant(channel.tenantId) : input.tenantId ? await store.getTenant(input.tenantId) : await store.getTenantBySlug(input.tenantSlug ?? '');
      if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
      if (channel && channel.tenantId !== tenant.id) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.');
      if (!ensureTenant(req, tenant.id) && getAuth(req)?.role !== undefined) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.');
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      if (tenant.status !== 'active') throw new HttpError(423, 'TENANT_UNAVAILABLE', 'This tenant is not accepting public chat.');
      enforcePublicChatEnabled(req, tenant);
      const publishedPersona = (await store.listPersonaVersions(tenant.id)).find((version) => version.status === 'published');
      const session = await store.createSession(tenant.id, publishedPersona?.id ?? null);
      const sessionToken = randomBytes(32).toString('base64url');
      await store.createSessionAccessToken({ sessionId: session.id, tokenHash: createHash('sha256').update(sessionToken).digest('hex'), expiresAt: new Date(Date.now() + chatSessionTtlMs).toISOString() });
      res.status(201).json({ sessionId: session.id, sessionToken, tenantId: tenant.id, createdAt: session.createdAt });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/messages', chatApi, async (req, res, next) => {
    let pendingMessage: Message | null = null;
    try {
      const input = parse(messageSchema, req.body);
      // The visible postback label is the conversation text; the opaque value
      // is only an authorization signal consumed by the owning flow.
      const inputText = (input.type === 'postback' ? input.message || input.postbackValue : input.message) ?? '';
      const channel = getChannel(req);
      const session = await store.getSession(input.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      await authorizeSessionAccessToken(req, session);
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      enforcePublicChatEnabled(req, tenant);
      if ((channel && channel.tenantId !== session.tenantId) || (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin')) throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
      const gptFirstEligible = Boolean(v2Coordinator && conversationEngineV2EnabledForTenant(session.tenantId));
      const permittedV2Tenants = (process.env.CONVERSATION_ENGINE_V2_TENANTS ?? '').split(',').map(item => item.trim()).filter(Boolean);
      if (!gptFirstEligible && process.env.CONVERSATION_ENGINE_V2_ENABLED === 'true'
        && (permittedV2Tenants.length === 0 || permittedV2Tenants.includes(session.tenantId))) {
        throw new HttpError(503, 'GPT_FIRST_ENGINE_UNAVAILABLE', 'GPT-first is required but unavailable. Check the API runtime configuration.');
      }
      res.setHeader('X-Chat-Engine', gptFirstEligible ? 'gpt-first' : 'legacy');

      // Allocate input tokens against the session so assistant persona names cannot collide with visitor PII.
      const masked = { masked: maskPiiForSession(session, inputText, tokenVault) };
      const messageHash = contentHash(masked.masked);
      const responseCacheKey = cacheKey('tenant', session.tenantId, 'chat-response', session.id, contentHash(input.clientMessageId));
      const cachedEntry = await cache.get<{ messageHash?: unknown; response?: Record<string, unknown> }>(responseCacheKey);
      if (cachedEntry?.response && typeof cachedEntry.response.answer === 'string') {
        if (cachedEntry.messageHash !== messageHash) throw new HttpError(409, 'MESSAGE_ID_REUSED', 'clientMessageId is already bound to different message content. Generate a new clientMessageId for each new turn.');
        await auditCacheEvent(session.tenantId, 'chat.cache_hit', responseCacheKey);
        res.setHeader('X-Chat-Engine', 'cached');
        res.json(rehydrateStoredResponse(session, cachedEntry.response)); return;
      }
      const durableDuplicate = await store.getMessageByClientId(session.id, input.clientMessageId);
      const retryableDuplicate = durableDuplicate?.response?.retryable === true;
      if (durableDuplicate && durableDuplicate.maskedContent !== masked.masked) throw new HttpError(409, 'MESSAGE_ID_REUSED', 'clientMessageId is already bound to different message content. Generate a new clientMessageId for each new turn.');
      if (durableDuplicate?.response && !retryableDuplicate) { await auditCacheEvent(session.tenantId, 'chat.replay', responseCacheKey); res.setHeader('X-Chat-Engine', 'cached'); res.json(rehydrateStoredResponse(session, durableDuplicate.response)); return; }
      if (durableDuplicate && !retryableDuplicate) throw new HttpError(409, 'MESSAGE_IN_PROGRESS', 'A request with this client message ID is already being processed.');
      const candidateMessage: Message = { id: randomUUID(), sessionId: session.id, tenantId: session.tenantId, role: 'user', maskedContent: masked.masked, citations: [], clientMessageId: input.clientMessageId, response: null, createdAt: new Date().toISOString() };
      let userMessage = durableDuplicate ?? await store.addMessage(candidateMessage);
      const racedDuplicate = userMessage.id !== candidateMessage.id;
      if (racedDuplicate && userMessage.maskedContent !== masked.masked) throw new HttpError(409, 'MESSAGE_ID_REUSED', 'clientMessageId is already bound to different message content. Generate a new clientMessageId for each new turn.');
      if (racedDuplicate && userMessage.response && userMessage.response.retryable !== true) { res.setHeader('X-Chat-Engine', 'cached'); res.json(rehydrateStoredResponse(session, userMessage.response)); return; }
      if (racedDuplicate && !userMessage.response) throw new HttpError(409, 'MESSAGE_IN_PROGRESS', 'A request with this client message ID is already being processed.');
      session.lastActivityAt = new Date().toISOString();
      // V2 commits the session atomically with the intent turn; reserving an
      // extra cursor here would make a valid pending goal prompt look stale.
      if (!gptFirstEligible) await updateSessionSafely(session, false);
      pendingMessage = userMessage;
      // GPT-first mode has a single response owner: authenticate/dedupe above, then
      // delegate the entire model/tool/evidence/persistence turn. Never run the
      // deterministic legacy conversation planner after this returns.
      if (gptFirstEligible && v2Coordinator) {
        const response = await runGPTFirstChatTurn({
          store, embedding, cache, tokenVault, session, tenant, userMessage, coordinator: v2Coordinator,
          actionGateway: gateway,
          leadProviderReady: salesforceLeadProviderReady,
          clientMessageId: input.clientMessageId, messageHash, maskedMessage: masked.masked,
          postbackValue: input.type === 'postback' ? input.postbackValue ?? null : null,
          requestId: (req as AuthedRequest).requestId ?? randomUUID(),
          responseCacheTtlSeconds: chatResponseCacheTtlSeconds,
          scopeSecret: process.env.MODEL_GATEWAY_SERVICE_KEY ?? '',
          updateSession: async (candidate) => updateSessionSafely(candidate, false),
        });
        recordChatOutcome(session.tenantId, response.grounded, false,
          estimateTokens(masked.masked), estimateTokens(response.answer));
        res.json(response);
        return;
      }
      const internal = ensureTenant(req, session.tenantId) && getAuth(req)?.role !== undefined;
      const persona = session.personaVersionId
        ? await store.getPersonaVersion(session.tenantId, session.personaVersionId)
        : await store.getPersona(session.tenantId);
      const language = detectedLanguage(masked.masked);
      const languageAllowed = !persona || isPermittedLanguage(masked.masked, persona.permittedLanguages);
      const intent = conversationalIntent(masked.masked);
      const conversational = intent !== null && (languageAllowed || language === 'ar');
      const leadRequestedNow = hasLeadIntent(masked.masked);
      const directKnowledgeQuestion = isKnowledgeQuestion(masked.masked);
      const setupConsultationTurn = /^(?:i|we)\s+(?:would like|want|need|plan|intend)\s+to\s+(?:start|set up|setup|open|form|register|establish)\s+(?:an?|the)\s+\S+(?:\s+\S+){0,3}\s+(?:company|business|firm)\b/iu.test(normalizeConversationQuery(masked.masked));
      const contextWindowMessages = persona?.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES;
      const modelContextWindow = Math.min(Math.max(contextWindowMessages, 2), 8);
      let evidence: ModelEvidence[] = [];
      let draft: ModelDraft;
      let knowledgeConflict = false;
      const state = session.conversationState ?? newConversationState();
      const pinnedCatalog = state.catalogVersionId ? await store.getIntentCatalogVersion(session.tenantId, state.catalogVersionId) : null;
      if (state.catalogVersionId && !pinnedCatalog) throw new HttpError(409, 'CATALOG_VERSION_UNAVAILABLE', 'This conversation uses an unavailable catalog version. Please start a new request.');
      const publishedCatalog = pinnedCatalog ?? await store.getPublishedIntentCatalog(session.tenantId);
      const journeyCatalogEnabled = Boolean(publishedCatalog && (publishedCatalog.catalog.journeyRequirements?.length || publishedCatalog.catalog.slots.length));
      const catalogHistory = publishedCatalog ? await store.listMessages(session.id, session.tenantId, modelContextWindow + 1) : [];
      let activeFollowUpOffer: PendingFollowUpOffer | null = null;
      if (state.pendingFollowUpOffer && Date.parse(state.pendingFollowUpOffer.expiresAt) > Date.now()) {
        const offerIntentScope = new Set([state.selectedIntentKey, state.activeFollowUpIntentKey, state.intentProgress?.activeIntentKey].filter((value): value is string => Boolean(value)));
        const offerIntentChanged = Boolean(state.pendingFollowUpOffer.intentKey && !offerIntentScope.has(state.pendingFollowUpOffer.intentKey));
        try {
          if (offerIntentChanged) throw new Error('Pending offer intent is no longer active.');
          assertKnownTokens(session, state.pendingFollowUpOffer.sourceQuery, tokenVault);
          activeFollowUpOffer = state.pendingFollowUpOffer;
        } catch { state.pendingFollowUpOffer = null; }
      } else if (state.pendingFollowUpOffer) state.pendingFollowUpOffer = null;
      if (input.replyToPromptId && input.replyToPromptId !== state.pendingPrompt?.id) throw new HttpError(409, 'PROMPT_MISMATCH', 'The reply no longer matches the active conversation prompt.');
      const promptScopedReply = Boolean(input.replyToPromptId && input.replyToPromptId === state.pendingPrompt?.id);
      const offerReply = activeFollowUpOffer
        && !directKnowledgeQuestion && !promptScopedReply
        ? await classifyOfferReply(model, { maskedMessage: masked.masked, offer: activeFollowUpOffer, conversation: catalogHistory.filter((message) => message.id !== userMessage.id).slice(-modelContextWindow).map((message) => ({ role: message.role, content: message.maskedContent })), conversationSummary: state.rollingSummary, activeIntentKey: state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey })
        : null;
      const acceptedOfferOption = activeFollowUpOffer && (offerReply?.action === 'accept' || offerReply?.action === 'select_option') && offerReply.optionKey
        ? activeFollowUpOffer.options.find((option) => option.key === offerReply.optionKey) ?? null
        : null;
      const knowledgeQuestion = directKnowledgeQuestion || Boolean(acceptedOfferOption);
      const lastCatalogAssistant = [...catalogHistory].reverse().find((message) => message.role === 'assistant');
      const activeCatalogIntent = state.activeFollowUpIntentKey ?? state.selectedIntentKey;
      const pendingCatalogIntent = state.pendingPrompt && activeCatalogIntent && state.catalogVersionId === publishedCatalog?.id
        ? activeCatalogIntent
        : state.workflowStatus !== 'queued' && state.contactConsent !== 'granted' && typeof lastCatalogAssistant?.response?.catalogIntentKey === 'string' && typeof lastCatalogAssistant.response.catalogVersionId === 'string' && typeof lastCatalogAssistant.response.catalogSlotKey === 'string' && lastCatalogAssistant.response.catalogSlotKey && lastCatalogAssistant.response.catalogVersionId === publishedCatalog?.id ? lastCatalogAssistant.response.catalogIntentKey : null;
      const sessionActions = await store.listActionsBySession(session.id, session.tenantId);
      const activeIntentForTurn = state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey;
      const provisionalResolution = publishedCatalog ? resolveIntent(publishedCatalog, normalizeConversationQuery(masked.masked), state.slotValues) : null;
      const explicitNewOpportunityRequest = /^(?:i|we)\s+(?:want|need|would\s+like|am\s+looking|need\s+help)\b/iu.test(masked.masked);
      const reopeningIntentKey = explicitNewOpportunityRequest && provisionalResolution && ['matched', 'missing_slots'].includes(provisionalResolution.reason) && !provisionalResolution.ambiguous && provisionalResolution.intentKey && state.intentProgress?.entries[provisionalResolution.intentKey]?.status === 'fulfilled'
        ? provisionalResolution.intentKey
        : null;
      const reopeningOpportunity = Boolean(reopeningIntentKey);
      const currentOpportunityId = state.intentProgress?.entries[activeIntentForTurn ?? '']?.journeyId ?? null;
      let agentToolResults: AgentToolResult[] = await runAgentTools(model, { store, session, catalog: publishedCatalog, opportunityId: currentOpportunityId, maskedQuery: masked.masked });
      const actionMatchesOpportunity = (action: ActionRequest): boolean => currentOpportunityId
        ? action.opportunityId === currentOpportunityId
        : action.opportunityId == null;
      const actionMatchesTargetOpportunity = (action: ActionRequest, opportunityId: string | null): boolean => opportunityId
        ? action.opportunityId === opportunityId
        : action.opportunityId == null;
      const hasRegisteredAction = sessionActions.some((action) => ['approved', 'processing', 'completed', 'human_review', 'reconcile_required'].includes(action.state) && actionMatchesOpportunity(action));
      const legacyWorkflowActive = !currentOpportunityId && ['queued', 'processing', 'succeeded', 'human_review', 'reconcile_required'].includes(state.workflowStatus);
      let postCaptureFollowUp = !reopeningOpportunity && (legacyWorkflowActive || hasRegisteredAction);
      const activeConversationJourney = Boolean(postCaptureFollowUp || state.pendingPrompt || state.activeFollowUpIntentKey || state.selectedIntentKey);
      const knowledgeOnlyTurn = knowledgeQuestion && !activeConversationJourney;
      const mixedKnowledgeTurn = knowledgeQuestion && activeConversationJourney;
      const scopedIntentKey = state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey;
      const scopedJourneyValues = scopedIntentKey ? state.intentProgress?.entries[scopedIntentKey]?.slotValues ?? {} : {};
      const scopedOpportunityId = scopedIntentKey ? state.intentProgress?.entries[scopedIntentKey]?.journeyId ?? null : null;
      const journeyDocuments = publishedCatalog?.catalog.journeyRequirements?.some((requirement) => requirement.requirementType === 'document') || postCaptureFollowUp
        ? (await store.listSupportingDocuments(session.tenantId, session.id)).filter((document) => !reopeningOpportunity && (!scopedOpportunityId || document.opportunityId === scopedOpportunityId))
        : [];
      const pendingConsentAction = !reopeningOpportunity && publishedCatalog && pendingCatalogIntent ? sessionActions.find((action) => action.catalogVersionId === publishedCatalog.id && action.intentKey === pendingCatalogIntent && (!scopedIntentKey ? true : Boolean(scopedOpportunityId && action.opportunityId === scopedOpportunityId)) && action.payload.contactConsent === true) : null;
      const assistantJourneyValues = lastCatalogAssistant?.response?.catalogOpportunityId === (state.intentProgress?.entries[scopedIntentKey ?? '']?.journeyId ?? null) && lastCatalogAssistant.response.catalogSlotValues && typeof lastCatalogAssistant.response.catalogSlotValues === 'object' && !Array.isArray(lastCatalogAssistant.response.catalogSlotValues) ? Object.fromEntries(Object.entries(lastCatalogAssistant.response.catalogSlotValues).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {};
      const pendingCatalogValues: Record<string, string> = { ...(reopeningOpportunity ? {} : (Object.keys(scopedJourneyValues).length ? scopedJourneyValues : state.slotValues)), ...(reopeningOpportunity ? {} : assistantJourneyValues), ...(!reopeningOpportunity && (pendingConsentAction?.state === 'approved' || pendingConsentAction?.state === 'processing' || pendingConsentAction?.state === 'completed' || state.contactConsent === 'granted') ? { contact_consent: 'true' } : !reopeningOpportunity && state.contactConsent === 'denied' ? { contact_consent: 'false' } : {}) };
      const postCaptureSlotRequirement = postCaptureFollowUp && publishedCatalog && activeCatalogIntent
        ? catalogNextFollowUpRequirement(publishedCatalog, activeCatalogIntent, pendingCatalogValues, state.intentProgress?.entries[activeCatalogIntent]?.completedRequirementKeys ?? [], journeyDocuments.map((document) => ({ intentKey: document.intentKey ?? null, catalogVersionId: document.catalogVersionId ?? null, requirementKey: document.requirementKey ?? null, expectedDocumentType: document.expectedDocumentType ?? null, status: document.status })))
        : null;
      const pendingPromptRequirement = state.pendingPrompt?.requirementKey && publishedCatalog
        ? (publishedCatalog.catalog.journeyRequirements ?? []).find((candidate) => candidate.intentKey === (pendingCatalogIntent ?? state.pendingPrompt?.intentKey) && candidate.requirementKey === state.pendingPrompt?.requirementKey) ?? null
        : null;
      const pendingSlotKey = pendingPromptRequirement?.requirementType === 'consent'
        ? pendingPromptRequirement.slotKey ?? 'contact_consent'
        : state.pendingPrompt?.slotKey
        ?? (postCaptureSlotRequirement?.requirementType === 'slot' ? postCaptureSlotRequirement.slotKey : null)
        ?? lastCatalogAssistant?.response?.catalogSlotKey;
      const pendingSlotIntent = pendingCatalogIntent ?? (postCaptureFollowUp ? activeCatalogIntent : null);
      const pendingSlot = publishedCatalog && pendingSlotIntent && typeof pendingSlotKey === 'string' ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === pendingSlotIntent && slot.slotKey === pendingSlotKey) : null;
      const pendingConsentSlot = pendingSlot?.validationRule === 'boolean:explicit_opt_in' || pendingSlot?.slotKey === 'contact_consent';
      const pendingNameIsIntentPhrase = pendingSlot?.slotKey === 'name' && publishedCatalog
        ? publishedCatalog.catalog.signals.some((signal) => signal.intentKey === pendingSlotIntent && signal.signalType === 'phrase' && signal.value && masked.masked.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').includes(signal.value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()))
        : false;
      const pendingContactKind = pendingSlot?.alternativeGroup === 'contact' ? masked.masked.match(/\[(EMAIL|PHONE)_\d+\]/u)?.[1] ?? null : null;
      const continuationReply = /\b(?:continue|resume|proceed|go ahead|help me proceed)\b/iu.test(masked.masked);
      const pendingTextIsStructuralAnswer = Boolean(pendingSlot && /activity|business/iu.test(pendingSlot.slotKey) && /\b(?:llc|fze|fzc|free\s+zone|company\s+structure|entity\s+type|legal\s+structure)\b/iu.test(inputText) && !/\b(?:business\s+activity|activity)\b/iu.test(inputText));
      const pendingTextRedirected = Boolean(pendingSlot && publishedCatalog && /^text:/u.test(pendingSlot.validationRule) && publishedCatalog.catalog.slots.some((slot) => slot.intentKey === pendingSlotIntent && slot.slotKey !== pendingSlot.slotKey && messageMentionsCatalogSlot(slot, inputText)));
      const activitySignalMentioned = Boolean(publishedCatalog && pendingSlot && /activity|business/iu.test(pendingSlot.slotKey) && publishedCatalog.catalog.signals.some((signal) => {
        if (signal.signalType === 'exclusion' || signal.relationGroup !== 'activity') return false;
        const terms = normalizeConversationQuery(signal.value).toLocaleLowerCase('en-US').split(/\s+/u).filter((term) => term.length >= 4);
        const message = normalizeConversationQuery(masked.masked).toLocaleLowerCase('en-US');
        return terms.filter((term) => message.includes(term)).length >= Math.min(2, terms.length);
      }));
      const pendingValue = pendingSlot && !pendingConsentSlot && !knowledgeQuestion && !pendingNameIsIntentPhrase && !pendingTextIsStructuralAnswer && (!pendingTextRedirected || activitySignalMentioned) && !(continuationReply && pendingSlot.validationRule.startsWith('text:'))
        ? pendingContactKind
          ? pendingCatalogSlotValue(`token:${pendingContactKind}`, inputText, masked.masked, session, tokenVault)
          : explicitCatalogSlotValue(pendingSlot, inputText, masked.masked, session, tokenVault) ?? catalogSlotValueForSlot(pendingSlot, inputText, masked.masked, session, tokenVault)
        : null;
      const pendingConsentValue = (state.pendingPrompt?.type === 'consent' || pendingPromptRequirement?.requirementType === 'consent') && (!pendingSlot || pendingConsentSlot) && !knowledgeQuestion && (!activeFollowUpOffer || promptScopedReply)
        ? pendingCatalogSlotValue('boolean:explicit_opt_in', inputText, masked.masked, session, tokenVault)
        : null;
      const offerReplyOwnsTurn = Boolean(activeFollowUpOffer && !promptScopedReply && !pendingValue && !pendingConsentValue && ['accept', 'select_option', 'reject', 'clarify'].includes(offerReply?.action ?? ''));
      const offerNeedsClarification = Boolean(activeFollowUpOffer && !promptScopedReply && !pendingValue && !pendingConsentValue && (offerReply?.action === 'clarify' || offerReply?.action === 'unknown'));
      const offerOwnsConversationState = Boolean(activeFollowUpOffer && (offerReplyOwnsTurn || offerNeedsClarification));
      const awaitingConsentAction = !reopeningOpportunity && pendingCatalogIntent && publishedCatalog
        ? sessionActions.find((action) => action.state === 'awaiting_confirmation' && action.catalogVersionId === publishedCatalog.id && action.intentKey === pendingCatalogIntent && (!scopedIntentKey ? true : Boolean(scopedOpportunityId && action.opportunityId === scopedOpportunityId)) && action.payload.contactConsent === false) ?? null
        : null;
      // A typed yes is only an acknowledgement; the scoped consent button still approves the action.
      const textConsentApproval = Boolean(awaitingConsentAction && pendingConsentValue === 'true');
      const maskedMessage = pendingSlot?.slotKey === 'name' && pendingValue && masked.masked.trim() === inputText.trim() ? pendingValue : masked.masked;
      if (maskedMessage !== userMessage.maskedContent) {
        userMessage = await store.updateMessage({ ...userMessage, maskedContent: maskedMessage });
      }
      const pendingValueData = pendingSlot?.slotKey === 'name' && pendingValue ? { name: pendingValue } : pendingContactKind === 'EMAIL' && pendingValue ? { email: pendingValue } : pendingContactKind === 'PHONE' && pendingValue ? { phone: pendingValue } : pendingSlot?.slotKey === 'email' && pendingValue ? { email: pendingValue } : pendingSlot?.slotKey === 'phone' && pendingValue ? { phone: pendingValue } : {};
      const pendingCatalogValueData = pendingConsentValue && !textConsentApproval
        ? { contact_consent: pendingConsentValue }
        : pendingSlot && pendingValue ? { [pendingContactKind?.toLocaleLowerCase('en-US') ?? pendingSlot.slotKey]: pendingValue } : {};
      const baseCatalogSlotValues: Record<string, string> = { ...pendingCatalogValues, ...(extractLeadData(maskedMessage) as Record<string, string>), ...pendingCatalogValueData };
      const deterministicMessage = normalizeConversationQuery(maskedMessage);
      const currentCatalogResolution = publishedCatalog ? resolveIntent(publishedCatalog, deterministicMessage, baseCatalogSlotValues) : null;
      const extractionIntentSwitch = /\b(?:also|another|instead|switch|change)\b/iu.test(maskedMessage);
      const inferredCatalogIntentKey = activeConversationJourney && !extractionIntentSwitch ? activeCatalogIntent : currentCatalogResolution?.intentKey ?? activeCatalogIntent;
      const slotCorrectionPrefix = /^(?:actually|my|our|the|now|still|please keep|update|change|i have|we have|correction)\b/iu;
      const inferredCatalogValueData = (Boolean(state.selectedIntentKey) || Boolean(inferredCatalogIntentKey) || !publishedCatalog?.catalog.journeyRequirements?.length) && (!knowledgeQuestion || setupConsultationTurn) && !conversational && inferredCatalogIntentKey
        ? (() => {
          const inferred: Record<string, string> = {};
          const intentSignal = publishedCatalog?.catalog.signals.find((signal) => {
            if (signal.intentKey !== inferredCatalogIntentKey || signal.signalType !== 'phrase' || !signal.value) return false;
            const phrase = normalizeConversationQuery(signal.value).toLocaleLowerCase('en-US');
            const message = deterministicMessage.toLocaleLowerCase('en-US');
            return message.includes(phrase);
          });
          const isIntentPhrase = Boolean(intentSignal?.value && deterministicMessage.length <= normalizeConversationQuery(intentSignal.value).length + 16);
          const summarySlot = publishedCatalog?.catalog.slots.find((slot) => slot.intentKey === inferredCatalogIntentKey && /interest|summary|description/iu.test(slot.slotKey) && !pendingCatalogValues[slot.slotKey]);
          if (summarySlot && intentSignal?.value) {
            const phraseIndex = inputText.toLocaleLowerCase('en-US').indexOf(intentSignal.value.toLocaleLowerCase('en-US'));
            const summary = phraseIndex >= 0 ? inputText.slice(0, phraseIndex + intentSignal.value.length).split(/[.!?]/u).at(-1)?.trim() : null;
            if (summary) inferred[summarySlot.slotKey] = summary;
          }
          const continuationPhrase = /\b(?:continue|resume|proceed|go ahead|help me proceed)\b/iu.test(maskedMessage);
          for (const slot of publishedCatalog?.catalog.slots.filter((candidate) => candidate.intentKey === inferredCatalogIntentKey && candidate.slotKey !== pendingSlot?.slotKey && !candidate.validationRule.startsWith('token:') && candidate.validationRule !== 'boolean:explicit_opt_in') ?? []) {
            if (continuationPhrase || conversational) continue;
            if (isIntentPhrase && slot.validationRule.startsWith('text:')) continue;
            const explicitValue = explicitCatalogSlotValue(slot, inputText, maskedMessage, session, tokenVault);
            if (!messageMentionsCatalogSlot(slot, inputText) && !explicitValue) continue;
            const value = explicitValue ?? (/activity|business/iu.test(slot.slotKey) ? null : inferredCatalogSlotValue(slot, inputText, maskedMessage, session, tokenVault));
            if (value) inferred[slot.slotKey] = value;
          }
          const timelineSlot = publishedCatalog?.catalog.slots.find((slot) => slot.intentKey === inferredCatalogIntentKey && /timeline|start/iu.test(slot.slotKey) && !pendingCatalogValues[slot.slotKey]);
          const timelineValue = deterministicMessage.match(/\b(?:next|this|within)\s+(?:month|months|week|weeks)|\b(?:asap|immediately|urgent)\b/iu)?.[0];
          if (timelineSlot && timelineValue) inferred[timelineSlot.slotKey] = timelineValue;
          return inferred;
        })()
        : {};
      const currentLeadData = mergeLeadData(pendingCatalogValues as LeadData, extractLeadData(maskedMessage), pendingValueData);
      const currentCatalogSlotValues: Record<string, string> = { ...baseCatalogSlotValues, ...inferredCatalogValueData };
      const relatedActivitySlot = publishedCatalog && currentCatalogResolution?.intentKey && inferredCatalogIntentKey && currentCatalogResolution.intentKey !== inferredCatalogIntentKey
        && publishedCatalog.catalog.relations.some((relation) => (relation.sourceIntent === inferredCatalogIntentKey && relation.relatedIntent === currentCatalogResolution?.intentKey) || (relation.relatedIntent === inferredCatalogIntentKey && relation.sourceIntent === currentCatalogResolution?.intentKey))
        ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === inferredCatalogIntentKey && !currentCatalogSlotValues[slot.slotKey] && /activity|business/iu.test(slot.slotKey) && slot.validationRule.startsWith('text:'))
        : null;
      const relatedActivityValue = relatedActivitySlot ? explicitCatalogSlotValue(relatedActivitySlot, inputText, maskedMessage, session, tokenVault) : null;
      if (relatedActivitySlot && relatedActivityValue) currentCatalogSlotValues[relatedActivitySlot.slotKey] = relatedActivityValue;
      const activeActivitySlot = publishedCatalog && state.selectedIntentKey
        ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === state.selectedIntentKey && !currentCatalogSlotValues[slot.slotKey] && /activity|business/iu.test(slot.slotKey) && slot.validationRule.startsWith('text:'))
        : null;
      const activityMentioned = publishedCatalog?.catalog.signals.some((signal) => {
        if (signal.signalType !== 'phrase' || signal.relationGroup !== 'activity') return false;
        const messageTerms = new Set(normalizeConversationQuery(maskedMessage).toLocaleLowerCase('en-US').split(/\s+/u));
        const signalTerms = normalizeConversationQuery(signal.value).toLocaleLowerCase('en-US').split(/\s+/u).filter((term) => term.length >= 4 && !['open', 'start', 'company', 'business', 'agency'].includes(term));
        return signalTerms.length > 0 && signalTerms.filter((term) => messageTerms.has(term)).length >= Math.min(2, signalTerms.length);
      }) ?? false;
      const activeActivityValue = activeActivitySlot ? explicitCatalogSlotValue(activeActivitySlot, inputText, maskedMessage, session, tokenVault) : null;
      if (activeActivitySlot && publishedCatalog && !conversational && !continuationReply && (activeActivityValue || activityMentioned && !slotCorrectionPrefix.test(maskedMessage))) currentCatalogSlotValues[activeActivitySlot.slotKey] = activeActivityValue ?? maskedMessage.trim();
      const history = publishedCatalog ? catalogHistory : await store.listMessages(session.id, session.tenantId, modelContextWindow + 1);
      const recentMessages = intent === null || Boolean(activeFollowUpOffer) ? history.filter((message) => message.id !== userMessage.id).slice(-modelContextWindow) : [];
      const conversation = recentMessages.map((message) => ({ role: message.role, content: message.maskedContent }));
      let normalizedMessage = deterministicMessage;
      const normalizationNeeded = !knowledgeQuestion && (Boolean(pendingSlot && !pendingValue) || ['no_signal', 'below_threshold'].includes(currentCatalogResolution?.reason ?? 'no_signal') || Boolean(currentCatalogResolution?.ambiguous));
      if (publishedCatalog && model.normalizeQuery && catalogQueryNormalizationEnabled && tenant.catalogQueryNormalizationEnabled && normalizationNeeded) {
        try {
          const normalizationStartedAt = Date.now();
          const result = await normalizeCatalogQuery(session.tenantId, publishedCatalog.id, { maskedMessage, catalog: publishedCatalog.catalog, conversation, selectedIntentKey: state.activeFollowUpIntentKey ?? state.selectedIntentKey }, deterministicMessage);
          recordNormalization(session.tenantId, result.usedFallback, result.failed, Date.now() - normalizationStartedAt);
          const candidate = result.value;
          assertKnownTokens(session, candidate, tokenVault);
          normalizedMessage = candidate;
        } catch { normalizedMessage = deterministicMessage; }
      }
      const intentContext = recentMessages.filter((message) => message.role === 'user' && conversationalIntent(message.maskedContent) === null).map((message) => normalizeConversationQuery(message.maskedContent));
       const retrievalContext = !postCaptureFollowUp && needsConversationContext(maskedMessage)
         ? recentMessages.filter((message) => message.role === 'user' && conversationalIntent(message.maskedContent) === null).slice(-2).map((message) => normalizeConversationQuery(message.maskedContent))
        : [];
      const useStructuredRetrievalContext = postCaptureFollowUp || Boolean(state.selectedIntentKey) || needsConversationContext(maskedMessage);
      const knowledgeQueryHints = knowledgeQuestion ? [
        /\b(?:documents?|requirements?)\b/i.test(maskedMessage) ? 'documents requirements application process' : '',
        /\b(?:steps?|process|procedure|how)\b/i.test(maskedMessage) ? 'setup procedure steps company registration application documents' : '',
        setupConsultationTurn ? 'setup procedure steps company registration application documents' : '',
        /\b(?:package|packages|price|prices|cost|costs|fee|fees)\b/i.test(maskedMessage) ? 'package pricing fees' : '',
        ...(acceptedOfferOption?.retrievalHints ?? []),
      ].filter(Boolean).slice(0, 8) : [];
      const retrievalIntentKey = activeCatalogIntent ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey;
      const retrievalJourneyValues = retrievalIntentKey ? state.intentProgress?.entries[retrievalIntentKey]?.slotValues ?? {} : {};
      const knowledgeSlotContext = knowledgeQuestion && publishedCatalog && retrievalIntentKey
        ? publishedCatalog.catalog.slots
          .filter((slot) => slot.intentKey === retrievalIntentKey && !/(?:pii|contact|consent)/iu.test(slot.retentionClass) && !/(?:^|[._-])(?:name|email|phone|mobile|contact)(?:$|[._-])/iu.test(slot.slotKey))
          .map((slot) => (retrievalJourneyValues[slot.slotKey] ?? currentCatalogSlotValues[slot.slotKey]) ? `${slot.slotKey}=${retrievalJourneyValues[slot.slotKey] ?? currentCatalogSlotValues[slot.slotKey]}` : '')
          .filter(Boolean)
          .slice(0, 8)
        : [];
      const structuredRetrievalContext = useStructuredRetrievalContext ? [
         state.rollingSummary.slice(-2_000),
        state.selectedIntentKey ? `Primary intent: ${state.selectedIntentKey}` : '',
        currentCatalogResolution?.intentKey ? `Current catalog intent: ${currentCatalogResolution.intentKey}` : '',
        Object.entries(currentCatalogSlotValues).filter(([key]) => key !== 'contact_consent').map(([key, value]) => `${key}=${value}`).join(', '),
      ].filter(Boolean) : [];
      const retrievalQuery = [normalizedMessage, ...knowledgeQueryHints, ...structuredRetrievalContext, ...retrievalContext].join('\n').slice(0, 6_000);
      const knowledgeIntentLabel = publishedCatalog && state.selectedIntentKey ? publishedCatalog.catalog.intents.find((candidate) => candidate.intentKey === state.selectedIntentKey)?.displayName ?? '' : '';
      const knowledgeRetrievalQuery = knowledgeQuestion
        ? [normalizedMessage, acceptedOfferOption && activeFollowUpOffer ? activeFollowUpOffer.sourceQuery : '', acceptedOfferOption?.label ?? '', ...knowledgeQueryHints, knowledgeIntentLabel, retrievalIntentKey ? `Active opportunity intent: ${retrievalIntentKey}` : '', ...knowledgeSlotContext].filter(Boolean).join('\n').slice(0, 2_000)
        : retrievalQuery;
      const retrievalTextQuery = normalizeFullTextQuery([knowledgeRetrievalQuery, ...knowledgeQueryHints].join(' '));
      const intentContextQuery = [normalizedMessage, ...intentContext].join('\n');
      const leadData = mergeLeadData(pendingCatalogValues as LeadData, currentLeadData);
      const catalogSlotValues: Record<string, string> = { ...pendingCatalogValues, ...(extractLeadData(maskedMessage) as Record<string, string>), ...inferredCatalogValueData, ...pendingCatalogValueData, ...currentCatalogSlotValues };
      if (publishedCatalog && inferredCatalogIntentKey) {
        for (const slot of publishedCatalog.catalog.slots.filter((candidate) => candidate.intentKey === inferredCatalogIntentKey && /structure|legal|entity|company_type/iu.test(candidate.slotKey))) {
          const value = catalogSlotValues[slot.slotKey];
          if (value && !catalogSlotValueForSlot(slot, value, value, session, tokenVault)) delete catalogSlotValues[slot.slotKey];
        }
      }
      const pendingTransitionPrompt = state.pendingPrompt?.type === 'confirmation' && state.pendingPrompt.requirementKey?.startsWith('transition:') ? state.pendingPrompt : null;
      const transitionApproval = Boolean(pendingTransitionPrompt?.intentKey && !knowledgeQuestion && !offerReplyOwnsTurn && /^(?:yes|yeah|yep|sure|okay|ok|confirm|confirmed|approve|approved|proceed|go ahead)\b/iu.test(maskedMessage));
      const transitionDenied = Boolean(pendingTransitionPrompt && !knowledgeQuestion && /^(?:no|nope|not now|later|decline|reject|stop)\b/iu.test(maskedMessage));
      const intentContinuity = publishedCatalog && !offerOwnsConversationState ? resolveIntentContinuity(publishedCatalog, { currentText: normalizedMessage, contextText: intentContextQuery, slotValues: catalogSlotValues, selectedIntentKey: transitionDenied ? state.selectedIntentKey : state.activeFollowUpIntentKey ?? state.selectedIntentKey, pendingPromptType: state.pendingPrompt?.type ?? null }) : null;
      let catalogResolution = intentContinuity?.primary ?? null;
      if (catalogResolution?.intentKey && ['matched', 'missing_slots'].includes(catalogResolution.reason) && !knowledgeQuestion && !knowledgeOnlyTurn) {
        void vocabulary.observe({
          tenantId: session.tenantId,
          intentKey: catalogResolution.intentKey,
          phrase: masked.masked,
          sessionId: session.id,
          messageId: userMessage.id,
          containsPii: masked.masked !== inputText,
          isNegated: /\b(?:not|never|don't|do not|no longer)\b/iu.test(inputText),
          isQuotedOrHypothetical: /(?:^|\s)["“].*["”](?:\s|$)|\b(?:hypothetical|for example|example of|if someone)\b/iu.test(inputText),
        }).catch(() => undefined);
      }
      const pendingJourneyConfirmation = state.pendingPrompt?.type === 'confirmation' && !pendingTransitionPrompt && state.pendingPrompt.requirementKey && state.pendingPrompt.intentKey
        ? publishedCatalog?.catalog.journeyRequirements?.some((requirement) => requirement.intentKey === state.pendingPrompt?.intentKey && requirement.requirementKey === state.pendingPrompt?.requirementKey && requirement.requirementType === 'confirmation') ?? false
        : false;
      const pendingConfirmationIntentMatches = Boolean(pendingJourneyConfirmation && !offerReplyOwnsTurn && state.pendingPrompt?.intentKey === (catalogResolution?.intentKey ?? state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey));
      // Consent is purpose-bound. A strong, newly requested intent must not inherit
      // the opt-in or pending question from a different customer journey. Intents
      // mapped to the same workflow remain one opportunity; a different workflow
      // is an explicit new opportunity and may collect its own consent.
      const distinctIntentKey = catalogResolution?.intentKey && state.selectedIntentKey && catalogResolution.intentKey !== state.selectedIntentKey ? catalogResolution.intentKey : null;
      const explicitIntentSwitch = /^(?:i|we)\s+(?:want|need|would\s+like|am\s+looking|need\s+help)|^(?:please|can\s+you|could\s+you)\b/iu.test(maskedMessage);
      const distinctIntent = Boolean(distinctIntentKey && (explicitIntentSwitch || !activeConversationJourney));
      if (distinctIntent && catalogResolution?.intentKey && !sessionActions.some((action) => action.opportunityId === currentOpportunityId && action.intentKey === catalogResolution.intentKey)) postCaptureFollowUp = false;
      if (distinctIntent && publishedCatalog) {
        // A distinct intent is a new opportunity, even when it reuses the same workflow.
        const transitionOffer = publishedCatalog.catalog.journeyTransitions?.some((transition) => transition.sourceIntentKey === state.selectedIntentKey && transition.targetIntentKey === catalogResolution?.intentKey && transition.activationMode === 'offer');
        postCaptureFollowUp = transitionOffer ? true : false;
      }
      if (transitionDenied) postCaptureFollowUp = false;
      const sourceIntentKey = state.selectedIntentKey ?? state.intentProgress?.activeIntentKey ?? null;
      const transitionTargetIntentKey = transitionApproval ? pendingTransitionPrompt?.intentKey ?? null : distinctIntentKey;
      const transitionCandidate = sourceIntentKey && transitionTargetIntentKey && publishedCatalog
        ? publishedCatalog.catalog.journeyTransitions?.find((transition) => transition.sourceIntentKey === sourceIntentKey && transition.targetIntentKey === transitionTargetIntentKey) ?? null
        : null;
      const transitionIsOnlyBeingOffered = transitionCandidate?.activationMode === 'offer' && !transitionApproval;
      if (transitionTargetIntentKey && sourceIntentKey && transitionTargetIntentKey !== sourceIntentKey && !transitionIsOnlyBeingOffered) {
        delete catalogSlotValues.contact_consent;
        state.contactConsent = 'unknown';
        state.consentCapturedAt = null;
        state.consentVersion = null;
      }
      if (reopeningOpportunity) {
        state.contactConsent = 'unknown';
        state.consentCapturedAt = null;
        state.consentVersion = null;
      }
      if (catalogResolution?.intentKey && state.selectedIntentKey === catalogResolution.intentKey && state.activeFollowUpIntentKey && state.activeFollowUpIntentKey !== catalogResolution.intentKey) state.activeFollowUpIntentKey = null;
      const journeyCurrentIntentKey = intentContinuity && ['matched', 'missing_slots'].includes(intentContinuity.current.reason) ? intentContinuity.current.intentKey : null;
      const journeyResolvedIntentKey = catalogResolution && ['matched', 'missing_slots'].includes(catalogResolution.reason)
        ? catalogResolution.intentKey
        : null;
      const journeyResult = journeyCatalogEnabled && publishedCatalog && !offerOwnsConversationState
        ? reduceIntentJourney(publishedCatalog, state.intentProgress, {
          currentIntentKey: knowledgeQuestion && activeConversationJourney ? activeIntentForTurn : transitionApproval ? pendingTransitionPrompt?.intentKey ?? journeyCurrentIntentKey : journeyCurrentIntentKey,
          selectedIntentKey: knowledgeQuestion && activeConversationJourney ? activeIntentForTurn : transitionApproval ? pendingTransitionPrompt?.intentKey ?? journeyResolvedIntentKey ?? null : transitionDenied ? state.selectedIntentKey ?? state.intentProgress?.activeIntentKey ?? null : reopeningIntentKey ?? journeyResolvedIntentKey ?? state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey ?? null,
          transitionApproval,
          newOpportunity: reopeningOpportunity,
          ...(transitionDenied && pendingTransitionPrompt?.intentKey && (state.selectedIntentKey ?? state.intentProgress?.activeIntentKey) ? { declinedTransition: { sourceIntentKey: state.selectedIntentKey ?? state.intentProgress!.activeIntentKey!, targetIntentKey: pendingTransitionPrompt.intentKey } } : {}),
          slotValues: catalogSlotValues,
          documents: journeyDocuments.map((document) => ({ intentKey: document.intentKey ?? null, catalogVersionId: document.catalogVersionId ?? null, requirementKey: document.requirementKey ?? null, expectedDocumentType: document.expectedDocumentType ?? null, status: document.status })),
          knowledgeQuestion: knowledgeOnlyTurn,
          followUp: postCaptureFollowUp,
          farewell: intent === 'farewell',
          completedRequirementKeys: pendingConfirmationIntentMatches && state.pendingPrompt?.requirementKey && !knowledgeQuestion && !offerReplyOwnsTurn && /^(?:yes|yeah|yep|sure|okay|ok|confirm|confirmed|approve|approved|proceed|go ahead)\b/iu.test(maskedMessage)
            ? [state.pendingPrompt.requirementKey]
            : [],
        })
        : null;
      const journeyRequirement = journeyResult?.nextRequirement ?? null;
      const journeyOfferPending = journeyResult?.decision === 'offer_next_intent' && Boolean(journeyResult.offeredIntentKey);
      const journeyOfferLabel = journeyOfferPending && publishedCatalog ? catalogIntentLabel(publishedCatalog, journeyResult?.offeredIntentKey) : null;
      const declinedTransitionHold = Boolean(state.intentProgress?.lastDeclinedTransition && catalogResolution?.intentKey === state.intentProgress.lastDeclinedTransition.sourceIntentKey && catalogResolution.intentKey !== state.intentProgress.lastDeclinedTransition.targetIntentKey);
      const journeyConfirmationLabel = journeyRequirement?.requirementType === 'confirmation' ? catalogRequirementLabel(journeyRequirement) : journeyOfferLabel;
      const journeyTransitionRequirementKey = journeyOfferPending ? `transition:${journeyResult?.activeIntentKey}:${journeyResult?.offeredIntentKey}` : null;
      const journeyDocumentAwaiting = Boolean(journeyRequirement?.required && journeyRequirement.requirementType === 'document' && journeyDocuments.some((document) => ['uploaded', 'queued', 'processing', 'reconciliation'].includes(document.status) && journeyDocumentMatchesRequirement(journeyRequirement, { intentKey: document.intentKey ?? null, catalogVersionId: document.catalogVersionId ?? null, requirementKey: document.requirementKey ?? null, expectedDocumentType: document.expectedDocumentType ?? null, status: document.status }, publishedCatalog?.id)));
      const journeyDocumentPending = Boolean(journeyRequirement?.required && journeyRequirement.requirementType === 'document' && !journeyDocumentAwaiting);
      const journeyConfirmationPending = Boolean(journeyRequirement?.required && journeyRequirement.requirementType === 'confirmation');
      const journeySlotKey = journeyRequirement && ['slot', 'consent'].includes(journeyRequirement.requirementType)
        ? journeyRequirement.slotKey ?? (journeyRequirement.requirementType === 'consent' ? 'contact_consent' : null)
        : null;
      const currentIntentKey = intentContinuity && ['matched', 'missing_slots'].includes(intentContinuity.current.reason) ? intentContinuity.current.intentKey : null;
      const detectedSecondaryIntentKey = currentIntentKey && currentIntentKey !== state.selectedIntentKey ? currentIntentKey : null;
      const previousSlotValues = state.slotValues ?? {};
      const structuredSlotCorrection = Boolean(publishedCatalog?.catalog.slots.some((slot) => {
        const terms = slot.slotKey.split(/[._-]+/u).filter((term) => term.length >= 4);
        return terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'iu').test(maskedMessage)) && slotCorrectionPrefix.test(maskedMessage);
      }));
      const correctedSlotKeys = Object.entries(catalogSlotValues).filter(([key, value]) => previousSlotValues[key] !== undefined && previousSlotValues[key] !== value).map(([key]) => key);
      const correctionChanged = correctedSlotKeys.length > 0 && slotCorrectionPrefix.test(maskedMessage);
      const currentOpportunityCompleted = sessionActions.some((action) => actionMatchesOpportunity(action) && action.state === 'completed');
      if (!postCaptureFollowUp && structuredSlotCorrection && currentOpportunityCompleted) postCaptureFollowUp = true;
      const catalogSlotNonAnswer = Boolean(pendingSlot && isCatalogSlotNonAnswer(maskedMessage));
      const continuityTurn = postCaptureFollowUp && !knowledgeOnlyTurn && !knowledgeQuestion && (catalogSlotNonAnswer || structuredSlotCorrection || (isContextualReply(maskedMessage) && !detectedSecondaryIntentKey));
      const workflowBinding = publishedCatalog && catalogResolution?.workflowKey ? publishedCatalog.catalog.workflowBindings.find((binding) => binding.workflowKey === catalogResolution?.workflowKey) : null;
      const isContactWorkflow = isCrmWriteBinding(workflowBinding);
      const consentSlot = publishedCatalog && catalogResolution?.intentKey && catalogResolution.missingSlots.length === 1
        ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === catalogResolution.intentKey && slot.slotKey === catalogResolution.missingSlots[0])
        : null;
      const consentDenied = catalogSlotValues.contact_consent === 'false';
      const rehydrateLeadValue = (value: string | undefined): string => value ? rehydrateForSession(session, value, tokenVault, 'admin_crm') : '';
      const validLeadName = Boolean(leadData.name && isValidLeadName(rehydrateLeadValue(leadData.name)));
      const validLeadEmail = Boolean(leadData.email && isValidLeadEmail(rehydrateLeadValue(leadData.email)));
      const validLeadPhone = Boolean(leadData.phone && isValidLeadPhone(rehydrateLeadValue(leadData.phone)));
      const invalidLeadField: 'name' | 'email' | 'phone' | null = !validLeadName ? 'name' : !validLeadEmail ? 'email' : !validLeadPhone ? 'phone' : null;
      const validatedLeadReady = validLeadName && validLeadEmail && validLeadPhone;
      const journeyOwnsNonContactRequirement = Boolean(journeyRequirement?.requirementType === 'slot' && journeySlotKey && !['name', 'email', 'phone', 'contact_consent'].includes(journeySlotKey));
      const crmContactMissing = !postCaptureFollowUp && !knowledgeOnlyTurn && !knowledgeQuestion && catalogResolution?.intentKey && isContactWorkflow && !validatedLeadReady && !journeyOwnsNonContactRequirement
        ? invalidLeadField : null;
      const consentRequirementPending = consentSlot?.validationRule === 'boolean:explicit_opt_in' || journeyRequirement?.required === true && journeyRequirement.requirementType === 'consent';
      const consentActionReady = !postCaptureFollowUp && !knowledgeOnlyTurn && !knowledgeQuestion && consentRequirementPending && catalogSlotValues.contact_consent !== 'true' && !consentDenied && !crmContactMissing && (catalogResolution?.reason === 'missing_slots' || catalogResolution?.actionAllowed === true) && (!journeyRequirement?.required || journeyRequirement.requirementType === 'consent');
      const legacyLeadIntent = leadRequestedNow || recentMessages.some((message) => message.role === 'user' && hasLeadIntent(message.maskedContent));
      const activeLeadFlow = leadRequestedNow || Boolean(catalogResolution?.intentKey && !['no_signal', 'below_threshold', 'ambiguous', 'intent_inactive', 'workflow_inactive'].includes(catalogResolution.reason)) || Boolean(pendingCatalogIntent && state.workflowStatus !== 'queued');
      const leadIntent = !postCaptureFollowUp && !knowledgeOnlyTurn && !knowledgeQuestion && languageAllowed && (publishedCatalog ? activeLeadFlow && Boolean(catalogResolution?.intentKey) : legacyLeadIntent);
      // Consent still needs an awaiting-confirmation action so the visitor can
      // explicitly approve it; every other required journey step must be complete first.
      const journeyBlocksAction = Boolean(journeyRequirement?.required && journeyRequirement.requirementType !== 'consent' && !postCaptureFollowUp);
      const catalogSlotsReady = catalogResolution ? (catalogResolution.missingSlots.length === 0 || consentActionReady) && (isContactWorkflow ? validatedLeadReady : true) && !journeyBlocksAction : validatedLeadReady;
      const leadCollection = leadIntent && !catalogSlotsReady;
      const catalogClarification = !postCaptureFollowUp && !knowledgeQuestion && Boolean(catalogResolution?.intentKey && (catalogResolution.ambiguous || catalogResolution.reason === 'below_threshold'));
       const composeGuidedDraft = async (fallback: ModelDraft, responseMode: 'slot_collection' | 'intent_clarification' | 'consent' | 'confirmation' | 'document_collection' | 'document_processing' | 'queued' | 'follow_up' | 'offer_clarification', slotKey: string | null = null): Promise<ModelDraft> => {
        if (!model.compose) return fallback;
        try {
          const intentKey = catalogResolution?.intentKey ?? pendingCatalogIntent ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey;
          const expectedSlotLabel = publishedCatalog && intentKey && slotKey ? catalogSlotLabel(publishedCatalog, intentKey, slotKey, catalogSlotValues).toLocaleLowerCase('en-US').trim() : null;
          const composed = await model.compose({
            maskedMessage,
            evidence,
            personaName: persona?.name ?? 'Sales assistant',
            ownerName: tenant.name,
            ...(persona ? { persona } : {}),
            conversation,
            followUpContext: {
              leadCaptured: hasRegisteredAction || postCaptureFollowUp,
              primaryIntentKey: state.selectedIntentKey,
              workflowStatus: state.workflowStatus,
              phase: state.phase,
              capturedSlots: { ...catalogSlotValues },
              conversationSummary: state.rollingSummary.slice(-2_000),
              detectedSecondaryIntentKey,
              pendingOffer: activeFollowUpOffer,
              resolvedOfferOption: acceptedOfferOption,
                responseMode,
                nextSlotLabel: publishedCatalog && intentKey && slotKey ? catalogSlotLabel(publishedCatalog, intentKey, slotKey, catalogSlotValues) : null,
                nextRequirement: journeyRequirement ? { requirementKey: journeyRequirement.requirementKey, requirementType: journeyRequirement.requirementType, promptKey: journeyRequirement.promptKey, documentType: journeyRequirement.documentType, label: journeyConfirmationLabel } : journeyOfferPending ? { requirementKey: journeyTransitionRequirementKey ?? 'transition', requirementType: 'confirmation', promptKey: journeyResult?.transitionPromptKey ?? '', documentType: null, label: journeyOfferLabel } : null,
              },
          });
          const genericContinuation = responseMode === 'slot_collection' && /what would you like to (?:explore|look at|discuss) next/iu.test(composed.answer);
          const safeFollowUp = responseMode !== 'follow_up' || isSafeContinuityAnswer(composed.answer, []);
          const repeatsPendingSlot = responseMode === 'follow_up' && Boolean(expectedSlotLabel && composed.answer.toLocaleLowerCase('en-US').includes(expectedSlotLabel));
          const validationMode = responseMode === 'offer_clarification' ? 'intent_clarification' : responseMode;
          return isGuidedResponse(composed.answer, validationMode, slotKey, responseMode === 'confirmation' ? journeyConfirmationLabel : null) && safeFollowUp && !repeatsPendingSlot && !genericContinuation ? composed : fallback;
        } catch {
          return fallback;
        }
      };
      const composeLeadCollectionDraft = async (invalidField: 'name' | 'email' | 'phone' | null, responseMode: 'slot_collection' | 'consent', proposedIntent: string | null = null): Promise<ModelDraft> => {
        const fallbackAnswer = leadCollectionReply(leadData, invalidField);
        const previousAssistantReply = [...history].reverse().find((turn) => turn.role === 'assistant')?.maskedContent;
        if (previousAssistantReply === fallbackAnswer) {
          const nextQuestion = invalidField === 'email' ? 'What email address should I use?' : invalidField === 'phone' ? 'What phone number, including country code, should I use?' : invalidField === 'name' ? 'What name should I use?' : 'Please explicitly consent before I register the request.';
          return { answer: `I’ve kept your company-formation details in view. ${nextQuestion}`, citationIds: [], proposedIntent };
        }
        return composeGuidedDraft({ answer: fallbackAnswer, citationIds: [], proposedIntent }, responseMode, invalidField);
      };
       let v2Draft: ModelDraft | null = null;
       let v2AllowedUncitedDialogue = false;
       const activeLifecycleStage = state.selectedIntentKey ? state.intentProgress?.entries?.[state.selectedIntentKey]?.lifecycle?.currentStage ?? null : null;
       if (v2Coordinator && conversationEngineV2EnabledForTenant(session.tenantId) && publishedCatalog && persona && session.personaVersionId
         && !consentActionReady && !journeyConfirmationPending && !journeyOfferPending && !journeyDocumentPending) {
         try {
           const v2Scope = issueV2Scope({ tenantId: session.tenantId, sessionId: session.id, opportunityId: currentOpportunityId, catalogVersionId: publishedCatalog.id, personaVersionId: session.personaVersionId, stateRevision: session.stateVersion ?? 0, toolAllowlist: [...V2_TOOL_NAMES] }, process.env.MODEL_GATEWAY_SERVICE_KEY ?? '');
           const validatedFact = (key: string, maxLength: number): string | undefined => {
             const value = catalogSlotValues[key] ?? pendingCatalogValues[key];
             return typeof value === 'string' && value.trim().length > 0
               && value.length <= maxLength && !/[\r\n<>@]/u.test(value) && !/https?:\/\//iu.test(value)
               && !/\+?\d[\d()\s-]{7,}/u.test(value) ? value.trim() : undefined;
           };
           // Only Node-validated current or persisted, normalized non-PII business
           // slots may be supplied as customer facts. No provider status, prices,
           // or unvalidated turn text.
           const confirmedCustomerFacts = {
             ...(validatedFact('business_activity', 180) ? { business_activity: validatedFact('business_activity', 180)! } : {}),
             ...(validatedFact('entity_type', 80) ? { entity_type: validatedFact('entity_type', 80)! } : {}),
             ...(validatedFact('visa_count', 12) ? { visa_count: validatedFact('visa_count', 12)! } : {}),
             ...(validatedFact('timeline', 100) ? { timeline: validatedFact('timeline', 100)! } : {}),
           };
           const trustedCustomerFacts = [
             confirmedCustomerFacts.business_activity ? { factId: 'customer-fact-business_activity', text: `The customer described their business activity as ${confirmedCustomerFacts.business_activity}.`, sourceVersion: publishedCatalog.id, verified: true } : null,
             confirmedCustomerFacts.entity_type ? { factId: 'customer-fact-entity_type', text: `The customer stated their company structure is ${confirmedCustomerFacts.entity_type}.`, sourceVersion: publishedCatalog.id, verified: true } : null,
             confirmedCustomerFacts.visa_count ? { factId: 'customer-fact-visa_count', text: `The customer requested ${confirmedCustomerFacts.visa_count} visas.`, sourceVersion: publishedCatalog.id, verified: true } : null,
             confirmedCustomerFacts.timeline ? { factId: 'customer-fact-timeline', text: `The customer's requested start timeline is ${confirmedCustomerFacts.timeline}.`, sourceVersion: publishedCatalog.id, verified: true } : null,
           ].filter((value): value is { factId: string; text: string; sourceVersion: string; verified: true } => value !== null);
           const v2 = await executeV2Turn(v2Coordinator, {
             envelope: {
               schemaVersion: 2,
               requestId: (req as AuthedRequest).requestId ?? randomUUID(),
               clientMessageId: input.clientMessageId,
               scopeRef: v2Scope,
               sessionRevision: session.stateVersion ?? 0,
               intentRevision: state.intentProgress?.journeyRevision ?? 0,
               catalogVersionId: publishedCatalog.id,
               personaVersionId: session.personaVersionId,
               customerMessageMasked: maskedMessage,
               latestTurns: conversation.slice(-8).map((turn) => ({ role: turn.role === 'user' ? 'customer' as const : 'assistant' as const, content: turn.content })),
               persona: { personaVersionId: session.personaVersionId, assistantName: persona.name, assistantRole: 'AI assistant', permittedLanguages: persona.permittedLanguages, tone: persona.tone.split(/[,;]+/u).map((value) => value.trim()).filter(Boolean), speakingStyle: persona.speakingStyle, fallbackTemplateVersion: `fallback-${session.personaVersionId}` },
               catalogDigest: contentHash(JSON.stringify(publishedCatalog.catalog)),
               intentProjection: { primaryGoalKey: state.selectedIntentKey ?? state.activeFollowUpIntentKey ?? null, goalConfirmed: Boolean(state.selectedIntentKey ?? state.activeFollowUpIntentKey), currentStageKey: activeLifecycleStage ?? state.phase.toLocaleLowerCase('en-US'), pendingRequirementKey: journeyRequirement?.requirementKey ?? state.pendingPrompt?.requirementKey ?? null, confirmedCustomerFacts },
               toolAllowlist: [...V2_TOOL_NAMES],
               budgets: { maxModelRequests: 4, maxToolCalls: 4, maxToolRounds: 2, deadlineAt: new Date(Date.now() + chatTurnTimeoutMs()).toISOString() },
             },
             evidence: evidence.map((item) => ({ citationId: item.citation.chunkId, text: item.content, sourceVersion: item.citation.versionId, approved: true, revoked: false, sourceRef: item.citation.sourceId })),
              verifiedFacts: trustedCustomerFacts,
              questionPolicy: journeyRequirement?.required ? 'required' : 'optional',
              lastQuestionKey: state.pendingPrompt?.requirementKey ?? (activeLifecycleStage ? `stage:${activeLifecycleStage}` : null),
              fallbackTemplates: approvedV2FallbackTemplates(session.personaVersionId, persona.permittedLanguages[0] ?? language),
          });
           v2Draft = v2.draft;
           v2AllowedUncitedDialogue = v2.guardReason === 'safe_no_evidence_dialogue' || v2.guardReason === 'accepted_model_dialogue';
           const responseReason = /^[a-z0-9_.-]{1,80}$/iu.test(v2.response.reasonNoQuestion ?? '') ? v2.response.reasonNoQuestion : null;
            const candidateResponseReason = /^[a-z0-9_.-]{1,80}$/iu.test(v2.candidateResponse.reasonNoQuestion ?? '') ? v2.candidateResponse.reasonNoQuestion : null;
            const diagnosticCandidate = v2DiagnosticCaptureMetadata(v2.candidateResponse);
            const rawCandidate = diagnosticCandidate && v2.diagnosticCandidate
              ? diagnosticText(v2.diagnosticCandidate, 2_000)
              : null;
            await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'v2.model.turn', metadata: { ...v2ModelAuditMetadata({ sessionId: session.id, clientMessageId: input.clientMessageId }), modelRequestCount: v2.modelRequestCount, toolCallCount: v2.toolCallCount, toolStatuses: v2.toolTrace.map((trace) => trace.status).join(','), guardReason: v2.guardReason, candidateGuardReason: v2.candidateGuardReason, modelResponseAccepted: v2.guardReason === 'accepted_model_dialogue' || v2.guardReason === 'accepted', repairApplied: v2.repairApplied, deliveredCitationCount: v2.response.citationIds.length, deliveredNextQuestionKey: v2.response.nextQuestionKey, ...(responseReason ? { responseReason } : {}), ...(candidateResponseReason ? { candidateResponseReason } : {}), ...(diagnosticCandidate ? { candidateResponse: JSON.stringify(diagnosticCandidate), ...(rawCandidate ? { rawCandidate } : {}), availableEvidenceRefs: JSON.stringify([...new Set(v2.toolTrace.flatMap((trace) => trace.evidenceRefs))].slice(0, 32)) } : {}), executionPath: 'langgraph' }, createdAt: new Date().toISOString() });
          } catch (error) {
            const reason = error instanceof Error && /^[A-Z0-9_.-]{1,80}$/u.test(error.message) ? error.message : 'v2_turn_failed';
            await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'v2.model.error', metadata: { ...v2ModelAuditMetadata({ sessionId: session.id, clientMessageId: input.clientMessageId }), reason, executionPath: 'langgraph' }, createdAt: new Date().toISOString() });
            // An attempted V2 turn must fail closed; never bypass its guard through legacy generation.
            v2Draft = { answer: naturalAbstention(language, maskedMessage, { capturedSlots: catalogSlotValues }), citationIds: [], proposedIntent: null };
           v2AllowedUncitedDialogue = false;
         }
       }
       if (v2Draft) {
         draft = v2Draft;
         const previousAssistantReply = [...history].reverse().find((turn) => turn.role === 'assistant')?.maskedContent;
         if (previousAssistantReply === draft.answer) {
           const repeatedRequirement = state.pendingPrompt?.requirementKey;
           const continuityQuestion = repeatedRequirement === 'email'
             ? 'What email address should I use?'
             : repeatedRequirement === 'phone'
               ? 'What phone number, including country code, should I use?'
               : activeLifecycleStage === 'account_creation'
                 ? 'What would you like to review before Account creation is confirmed?'
                 : 'What would you like to focus on next?';
           draft = { answer: `I’ve kept your company-formation request in view. ${continuityQuestion}`, citationIds: [], proposedIntent: null };
         }
       }
       else if (!languageAllowed && !conversational) draft = { answer: permittedLanguageReply(language, persona?.permittedLanguages ?? []), citationIds: [], proposedIntent: null };
       else if (offerNeedsClarification && activeFollowUpOffer) draft = await composeGuidedDraft({ answer: `Which would you like to explore: ${activeFollowUpOffer.options.map((option) => option.label).join(' or ')}?`, citationIds: [], proposedIntent: null }, 'offer_clarification');
       else if (!postCaptureFollowUp && !knowledgeQuestion && catalogResolution?.ambiguous) draft = await composeGuidedDraft({ answer: 'I can help with that. Could you tell me a little more about what you need?', citationIds: [], proposedIntent: null }, 'intent_clarification');
       else if (!postCaptureFollowUp && !knowledgeQuestion && publishedCatalog && catalogResolution?.intentKey && catalogResolution.reason === 'below_threshold') draft = await composeGuidedDraft({ answer: catalogIntentClarification(publishedCatalog, catalogResolution.intentKey), citationIds: [], proposedIntent: null }, 'intent_clarification');
       else if (!postCaptureFollowUp && !knowledgeQuestion && publishedCatalog && catalogResolution?.intentKey && catalogResolution.reason === 'intent_inactive') draft = { answer: 'I can note that request, but the matching workflow is not currently enabled.', citationIds: [], proposedIntent: null };
      else if (conversational && intent === 'farewell') draft = { answer: conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else if (!postCaptureFollowUp && conversational && intent !== 'greeting' && !pendingValue && !acceptedOfferOption) draft = { answer: conversationalReply(intent ?? 'acknowledgement', persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else if (!postCaptureFollowUp && !knowledgeQuestion && consentDenied && isContactWorkflow) draft = { answer: 'Understood. I will not register or share your contact details without consent. I can still answer your questions.', citationIds: [], proposedIntent: null };
        else if (crmContactMissing) draft = await composeLeadCollectionDraft(crmContactMissing, 'slot_collection');
        else if (textConsentApproval) draft = { answer: 'Thanks — I have your explicit contact consent. Please confirm the registration action below so I can submit it.', citationIds: [], proposedIntent: catalogResolution?.intentKey ?? null };
        else if (consentActionReady) draft = await composeGuidedDraft({ answer: 'I have the details needed. Please approve the consent action below to register your request.', citationIds: [], proposedIntent: catalogResolution?.intentKey ?? null }, 'consent');
        else if (!knowledgeQuestion && journeyDocumentAwaiting) draft = await composeGuidedDraft({ answer: 'I’ve received the requested document and it is being reviewed. While that is checked, what else would you like to clarify about your setup?', citationIds: [], proposedIntent: null }, 'document_processing');
        else if (!knowledgeQuestion && journeyOfferPending) draft = await composeGuidedDraft({ answer: `Would you like to continue with ${journeyOfferLabel ?? 'the related request'} as well?`, citationIds: [], proposedIntent: null }, 'confirmation');
        else if (!knowledgeQuestion && journeyConfirmationPending) draft = await composeGuidedDraft({ answer: `Before I continue, could you confirm ${journeyConfirmationLabel ?? 'this requirement'}?`, citationIds: [], proposedIntent: null }, 'confirmation');
        else if (!knowledgeQuestion && journeyDocumentPending) draft = await composeGuidedDraft({ answer: 'To continue, could you share the requested document?', citationIds: [], proposedIntent: null }, 'document_collection');
        else if (postCaptureFollowUp && catalogSlotNonAnswer) draft = await composeGuidedDraft({ answer: 'Thanks, I’ve noted that from earlier. If anything has changed, tell me what to update; otherwise we can continue with the remaining details?', citationIds: [], proposedIntent: null }, 'follow_up', journeySlotKey);
        else if (!knowledgeQuestion && journeyRequirement && journeySlotKey && publishedCatalog) draft = await composeGuidedDraft({ answer: catalogSlotQuestion(publishedCatalog, journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? '', journeySlotKey, catalogSlotValues), citationIds: [], proposedIntent: null }, 'slot_collection', journeySlotKey);
        else if (!postCaptureFollowUp && !knowledgeQuestion && publishedCatalog && catalogResolution?.intentKey && catalogResolution.missingSlots.length > 0) draft = await composeGuidedDraft({ answer: catalogSlotQuestion(publishedCatalog, catalogResolution.intentKey, catalogResolution.missingSlots[0] ?? '', catalogSlotValues), citationIds: [], proposedIntent: null }, 'slot_collection', catalogResolution.missingSlots[0] ?? null);
       else if (!postCaptureFollowUp && !knowledgeQuestion && leadIntent && !catalogSlotsReady) draft = await composeLeadCollectionDraft(invalidLeadField, 'slot_collection');
       else if (!postCaptureFollowUp && !knowledgeQuestion && ((leadIntent && validatedLeadReady) || (catalogResolution?.actionAllowed && (!isContactWorkflow || validatedLeadReady)))) draft = await composeLeadCollectionDraft(null, 'consent', catalogResolution?.intentKey ?? 'lead.capture');
      else if (!postCaptureFollowUp && conversational && intent === 'greeting' && (language === 'ar' || /\bgood (?:morning|afternoon|evening)\b/iu.test(maskedMessage))) draft = { answer: language === 'ar' ? conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name) : openingGreeting(persona?.greeting, persona?.name ?? 'Sales assistant'), citationIds: [], proposedIntent: null };
      else if (!postCaptureFollowUp && conversational && intent === 'identity') draft = { answer: conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else {
        try { evidence = await retrieveApprovedKnowledge(store, embedding, session.tenantId, internal ? 'internal' : 'public', knowledgeRetrievalQuery, 4, retrievalTextQuery, maskedMessage); } catch (error) {
          const category = error instanceof KnowledgeRetrievalError ? error.kind : 'unknown';
          console.error(JSON.stringify({ event: 'chat.knowledge_failure', requestId: (req as AuthedRequest).requestId ?? 'unknown', tenantHash: contentHash(session.tenantId).slice(0, 16), category }));
          throw new HttpError(503, category === 'embedding' ? 'EMBEDDING_UNAVAILABLE' : 'KNOWLEDGE_STORE_UNAVAILABLE', 'The assistant is currently unable to search approved knowledge.');
        }
        // The planner runs before retrieval so it can load scoped business state.
        // Bind the already tenant-filtered evidence to its planned read-only search result.
        if (agentToolResults.some((result) => result.name === 'search_approved_knowledge')) {
          agentToolResults = agentToolResults.map((result) => result.name === 'search_approved_knowledge'
            ? { name: result.name, ok: true, data: { evidence } }
            : result);
        }
        const commercialKnowledgeQuestion = /\b(?:price|pricing|cost|costs|fee|fees|quote|quotation|package|packages)\b/iu.test(knowledgeRetrievalQuery);
        knowledgeConflict = commercialKnowledgeQuestion && hasConflictingEvidence(evidence.map((item) => item.content));
        let fallbackModelInput: Parameters<ChatModel['draft']>[0] | null = null;
        if (knowledgeConflict) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: evidence.slice(0, 4).map((item) => item.citation.chunkId), proposedIntent: null };
        else if (!postCaptureFollowUp && conversational && evidence.length === 0) draft = { answer: intent === 'greeting' && language !== 'ar' ? openingGreeting(persona?.greeting, persona?.name ?? 'Sales assistant') : conversationalReply(intent ?? 'identity', persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
        else try {
          const documents = postCaptureFollowUp ? journeyDocuments : [];
          const followUpIntentKeys = new Set([state.selectedIntentKey, detectedSecondaryIntentKey].filter((value): value is string => Boolean(value)));
          const followUpContext = {
            leadCaptured: hasRegisteredAction || postCaptureFollowUp,
            primaryIntentKey: state.selectedIntentKey,
            workflowStatus: state.workflowStatus,
            phase: state.phase,
            capturedSlots: { ...catalogSlotValues },
            conversationSummary: state.rollingSummary.slice(-2_000),
            detectedSecondaryIntentKey,
            pendingOffer: activeFollowUpOffer,
            resolvedOfferOption: acceptedOfferOption,
            continuityTurn,
            nextRequirement: journeyRequirement ? { requirementKey: journeyRequirement.requirementKey, requirementType: journeyRequirement.requirementType, promptKey: journeyRequirement.promptKey, documentType: journeyRequirement.documentType, label: journeyConfirmationLabel } : journeyOfferPending ? { requirementKey: journeyTransitionRequirementKey ?? 'transition', requirementType: 'confirmation', promptKey: journeyResult?.transitionPromptKey ?? '', documentType: null, label: journeyOfferLabel } : null,
            responseMode: mixedKnowledgeTurn ? 'mixed' as const : knowledgeQuestion ? 'knowledge' as const : journeyDocumentPending ? 'document_collection' as const : journeyRequirement?.requirementType === 'slot' ? 'slot_collection' as const : 'follow_up' as const,
            documentPolicies: (publishedCatalog?.catalog.documentPolicies ?? []).filter((policy) => policy.enabled && (!followUpIntentKeys.size || followUpIntentKeys.has(policy.intentKey))).map((policy) => ({ intentKey: policy.intentKey, requestMode: policy.requestMode, required: policy.required, requestPromptKey: policy.requestPromptKey, allowedDocumentTypes: policy.allowedDocumentTypes })),
            documentStatus: documents.map((document) => document.status),
            agentToolResults: agentToolResults.map(({ name, ok, data }) => ({ name, ok, data })),
          };
          const modelInput = { maskedMessage, evidence, personaName: persona?.name ?? 'Sales assistant', ownerName: tenant.name, conversation, followUpContext, trustedContext: { tenantId: session.tenantId, sessionId: session.id } };
          fallbackModelInput = persona ? { ...modelInput, persona } : modelInput;
          draft = await model.draft(fallbackModelInput);
          const structuredKnowledgeAvailable = knowledgeQuestion && agentToolResults.some((result) => result.ok
            && ['get_available_packages', 'get_authoritative_pricing', 'get_setup_requirements', 'get_package_document_requirements'].includes(result.name)
            && Object.values(result.data).some((value) => Array.isArray(value) && value.length > 0));
          const packageToolHasResults = knowledgeQuestion && /\b(?:package|packages|option|options)\b/iu.test(maskedMessage)
            && agentToolResults.some((result) => result.name === 'get_available_packages' && result.ok && Array.isArray(result.data.packages) && result.data.packages.length > 0);
          if (structuredKnowledgeAvailable && (draft.citationIds.length === 0 || packageToolHasResults)) {
            // Structured tools are authoritative for this claim; do not let an uncited model abstention hide verified data.
            draft = await new DeterministicGroundedModel().draft(persona ? { ...modelInput, persona } : modelInput);
          }
          if (setupConsultationTurn && evidence.length > 0) draft = groundedKnowledgeFallback(`${maskedMessage} setup steps`, evidence) ?? draft;
        } catch {
          if (knowledgeQuestion && fallbackModelInput) draft = await new DeterministicGroundedModel().draft(fallbackModelInput);
          else if (knowledgeQuestion && evidence.length === 0) draft = { answer: naturalAbstention(language, maskedMessage, { capturedSlots: catalogSlotValues }), citationIds: [], proposedIntent: null };
          else throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The assistant is currently unable to verify an answer.');
        }
      }
      if (!v2AllowedUncitedDialogue && !knowledgeQuestion && journeyRequirement && journeySlotKey && publishedCatalog && !consentDenied && !catalogSlotNonAnswer && !isGuidedResponse(draft.answer, 'slot_collection', journeySlotKey)) draft = { answer: catalogSlotQuestion(publishedCatalog, journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? '', journeySlotKey, catalogSlotValues), citationIds: [], proposedIntent: null };
      if (knowledgeQuestion && /\b(?:step|steps|process|procedure)\b/iu.test(maskedMessage) && evidence.length > 0 && !/\b(?:step|steps|process|procedure)\b/iu.test(draft.answer)) draft = groundedKnowledgeFallback(maskedMessage, evidence) ?? draft;
      const structuredToolKnowledge = knowledgeQuestion && agentToolResults.some((result) => result.ok
        && ['get_available_packages', 'get_authoritative_pricing', 'get_setup_requirements', 'get_package_document_requirements'].includes(result.name)
        && Object.values(result.data).some((value) => Array.isArray(value) && value.length > 0));
      if (knowledgeQuestion && evidence.length > 0 && store.constructor.name !== 'MemoryStore' && draft.citationIds.length === 0 && !structuredToolKnowledge) draft = groundedKnowledgeFallback(maskedMessage, evidence) ?? draft;
      try { assertKnownTokens(session, draft.answer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      let citations = validateCitations(draft, evidence);
      const trustedToolFacts = JSON.stringify(agentToolResults.filter((result) => result.ok).map((result) => ({ name: result.name, data: result.data })));
      const casualFallback = v2AllowedUncitedDialogue || (conversational && (evidence.length === 0 || intent === 'identity'));
      const continuityAnswer = continuityTurn && isSafeContinuityAnswer(draft.answer, citations);
      const toolBackedKnowledge = knowledgeQuestion && agentToolResults.some((result) => result.ok
        && ['get_available_packages', 'get_authoritative_pricing', 'get_setup_requirements', 'get_package_document_requirements'].includes(result.name)
        && Object.values(result.data).some((value) => Array.isArray(value) && value.length > 0));
      let grounded = knowledgeConflict
        ? citations.length > 0
        : !casualFallback && !leadCollection && (toolBackedKnowledge || evidence.length > 0 && hasSufficientEvidence(draft.answer, evidence, citations, trustedToolFacts));
      if (knowledgeQuestion && evidence.length > 0 && !grounded && !knowledgeConflict) {
        const citedContent = `${evidence.filter((item) => citations.some((citation) => citation.chunkId === item.citation.chunkId)).map((item) => item.content.toLocaleLowerCase('en-US')).join(' ')} ${trustedToolFacts.toLocaleLowerCase('en-US')}`;
        const unsupportedNumber = (draft.answer.toLocaleLowerCase('en-US').match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).some((number) => !citedContent.includes(number));
        const fallbackDraft = unsupportedNumber ? null : groundedKnowledgeFallback(maskedMessage, evidence);
        if (fallbackDraft) {
          draft = fallbackDraft;
          citations = validateCitations(draft, evidence);
          // This fallback is assembled only from sentences in authorized evidence.
          grounded = citations.length > 0;
        }
      }
      const continuityFallback = continuityTurn && !continuityAnswer;
      const offerClarificationAnswer = offerNeedsClarification && Boolean(activeFollowUpOffer);
      const leadAnswer = !postCaptureFollowUp && !knowledgeQuestion && (leadCollection || (leadIntent && validatedLeadReady) || consentActionReady || catalogClarification || Boolean(catalogResolution?.actionAllowed)) || journeyDocumentPending || journeyDocumentAwaiting || journeyConfirmationPending || journeyOfferPending || Boolean(!knowledgeQuestion && journeyRequirement && journeySlotKey);
      const answer = !languageAllowed ? draft.answer : casualFallback || leadAnswer || continuityAnswer || knowledgeConflict ? draft.answer : grounded ? draft.answer : naturalAbstention(language, maskedMessage, { capturedSlots: catalogSlotValues });
      let safeAnswer = casualFallback || leadAnswer || continuityAnswer || offerClarificationAnswer ? draft.answer : continuityTurn ? conversationalReply('acknowledgement', persona?.name ?? 'Sales assistant', language, tenant.name) : answer;
      const controlledFinalAbstention = knowledgeQuestion && isControlledKnowledgeAbstention(safeAnswer);
      const safeGrounded = grounded && !continuityFallback && !(knowledgeQuestion && (isControlledKnowledgeAbstention(draft.answer) || controlledFinalAbstention)) && (store.constructor.name !== 'PostgresStore' || !knowledgeQuestion || addressesKnowledgeQuestion(maskedMessage, safeAnswer));
      if (knowledgeQuestion && store.constructor.name === 'PostgresStore' && !v2AllowedUncitedDialogue && !safeGrounded && !controlledFinalAbstention) safeAnswer = naturalAbstention(language, maskedMessage, { capturedSlots: catalogSlotValues });
      const nextMissingSlot = crmContactMissing ?? journeySlotKey ?? catalogResolution?.missingSlots[0] ?? null;
      const previousAssistantReply = [...history].reverse().find((turn) => turn.role === 'assistant')?.maskedContent;
      const repeatedSafeAnswer = Boolean(v2Coordinator && previousAssistantReply && previousAssistantReply === safeAnswer);
      if (repeatedSafeAnswer) {
        const continuityQuestion = nextMissingSlot && publishedCatalog
          ? catalogSlotQuestion(publishedCatalog, journeyResult?.activeIntentKey ?? catalogResolution?.intentKey ?? state.selectedIntentKey ?? '', nextMissingSlot, catalogSlotValues)
          : activeLifecycleStage === 'account_creation'
            ? 'What would you like to review before Account creation is confirmed?'
            : 'What would you like to focus on next?';
        safeAnswer = `I’m keeping your request in view. ${continuityQuestion}`;
      }
      const safeCitations = safeGrounded && !repeatedSafeAnswer ? citations : [];
      if (intent === 'farewell') session.closedAt = new Date().toISOString();
      const endedConversation = conversational && intent === 'farewell';
      const preserveConsentPrompt = knowledgeQuestion && state.pendingPrompt?.type === 'consent';
      const preserveTypedConsentPrompt = textConsentApproval && state.pendingPrompt?.type === 'consent';
      const preserveTransitionOfferPrompt = Boolean(pendingTransitionPrompt && !transitionApproval && !transitionDenied);
      const preservePendingPrompt = !transitionDenied && (state.pendingPrompt && (offerOwnsConversationState || knowledgeQuestion) && ['slot', 'consent', 'document', 'confirmation'].includes(state.pendingPrompt.type)) || preserveTransitionOfferPrompt || preserveTypedConsentPrompt;
      const preserveDocumentProcessingPrompt = journeyDocumentAwaiting && state.pendingPrompt?.type === 'document' && state.pendingPrompt.requirementKey === journeyRequirement?.requirementKey;
      const nextPrompt = transitionDenied ? null : preservePendingPrompt || preserveConsentPrompt ? state.pendingPrompt : endedConversation ? null : consentDenied ? null : journeyOfferPending
         ? prompt('confirmation', journeyResult?.offeredIntentKey ?? catalogResolution?.intentKey ?? state.selectedIntentKey, null, journeyTransitionRequirementKey)
        : (postCaptureFollowUp && !journeyDocumentPending && !journeyRequirement) ? null : journeyDocumentPending
         ? prompt('document', journeyResult?.activeIntentKey ?? catalogResolution?.intentKey ?? state.selectedIntentKey, null, journeyRequirement?.requirementKey ?? null)
         : preserveDocumentProcessingPrompt ? state.pendingPrompt
         : journeyConfirmationPending
         ? prompt('confirmation', journeyResult?.activeIntentKey ?? catalogResolution?.intentKey ?? state.selectedIntentKey, null, journeyRequirement?.requirementKey ?? null)
        : catalogResolution?.ambiguous || (catalogResolution?.reason === 'below_threshold')
        ? prompt('clarification', catalogResolution.intentKey, null)
        : nextMissingSlot
          ? prompt(consentActionReady || journeyRequirement?.requirementType === 'consent' ? 'consent' : 'slot', journeyResult?.activeIntentKey ?? catalogResolution?.intentKey ?? pendingCatalogIntent ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey, nextMissingSlot, journeyRequirement?.requirementKey ?? null)
          : consentActionReady ? prompt('consent', catalogResolution?.intentKey ?? journeyResult?.activeIntentKey ?? state.selectedIntentKey, null, journeyRequirement?.requirementKey ?? null)
            : catalogResolution?.actionAllowed && !consentDenied && !journeyOfferPending && !declinedTransitionHold ? prompt('confirmation', catalogResolution.intentKey, null) : null;
      state.catalogVersionId = catalogResolution?.catalogVersionId ?? state.catalogVersionId;
      if (journeyResult && !offerOwnsConversationState) state.intentProgress = journeyResult.progress;
      if (!offerOwnsConversationState) {
        state.selectedIntentKey = transitionApproval ? journeyResult?.activeIntentKey ?? pendingTransitionPrompt?.intentKey ?? state.selectedIntentKey : postCaptureFollowUp || knowledgeQuestion || journeyOfferPending ? state.selectedIntentKey : catalogResolution?.intentKey ?? state.selectedIntentKey;
        if (transitionApproval) state.activeFollowUpIntentKey = null;
        if (transitionDenied) state.activeFollowUpIntentKey = state.selectedIntentKey;
        if (!state.selectedIntentKey && journeyResult?.activeIntentKey) state.selectedIntentKey = journeyResult.activeIntentKey;
        if (journeyResult?.activeIntentKey && journeyResult.activeIntentKey !== state.selectedIntentKey) state.activeFollowUpIntentKey = journeyResult.activeIntentKey;
      }
      if (!offerOwnsConversationState && !postCaptureFollowUp && !knowledgeOnlyTurn) {
        state.intentScore = catalogResolution?.score ?? state.intentScore ?? 0;
        state.intentConfidence = catalogResolution?.confidence ?? state.intentConfidence ?? 0;
      }
      state.candidateIntentKeys = [...new Set([...state.candidateIntentKeys, catalogResolution?.intentKey, catalogResolution?.runnerUpIntentKey, ...(intentContinuity?.secondaryIntentKeys ?? [])].filter((value): value is string => Boolean(value)))];
      state.intentEvidence = [...new Set([...(postCaptureFollowUp ? state.intentEvidence ?? [] : []), catalogResolution?.intentKey, detectedSecondaryIntentKey, ...(intentContinuity?.secondaryIntentKeys ?? [])].filter((value): value is string => Boolean(value)))];
      state.slotValues = catalogSlotValues;
      state.slotProvenance = { ...(state.slotProvenance ?? {}) };
      const changedVisitorSlots = new Set([...Object.keys(extractLeadData(maskedMessage)), ...Object.keys(inferredCatalogValueData), ...Object.keys(pendingCatalogValueData)]);
      for (const slotKey of changedVisitorSlots) {
        const value = catalogSlotValues[slotKey];
        if (value) state.slotProvenance[slotKey] = { source: 'visitor', messageSequence: state.messageSequence + 1, capturedAt: new Date().toISOString(), corrected: Boolean(previousSlotValues[slotKey] && previousSlotValues[slotKey] !== value) };
      }
      if (correctionChanged) {
        const correctionOpportunityIds = new Set(Object.values(state.intentProgress?.entries ?? {}).map((entry) => entry.journeyId).filter((value): value is string => Boolean(value)));
        for (const action of sessionActions) {
          if ((action.opportunityId !== null && action.opportunityId !== undefined && !correctionOpportunityIds.has(action.opportunityId)) || !['awaiting_confirmation', 'awaiting_customer'].includes(action.state)) continue;
          const invalidated = await store.updateAction({ ...action, state: 'failed', result: null });
          Object.assign(action, invalidated);
          await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'conversation.fact_correction.invalidated_action', metadata: { actionId: action.id, opportunityDigest: action.opportunityId ? contentHash(action.opportunityId).slice(0, 12) : null, correctedSlotKeys: JSON.stringify(correctedSlotKeys), priorActionRevision: action.actionRevision ?? 1 }, createdAt: new Date().toISOString() });
        }
        await invalidateTenantCache(session.tenantId);
      }
      const persistedJourneyKey = journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey;
      if (persistedJourneyKey && state.intentProgress?.entries[persistedJourneyKey]) {
        const journeyEntry = state.intentProgress.entries[persistedJourneyKey];
        journeyEntry.slotValues = { ...(journeyEntry.slotValues ?? {}), ...catalogSlotValues };
        journeyEntry.slotProvenance = { ...(journeyEntry.slotProvenance ?? {}), ...(state.slotProvenance ?? {}) };
      }
      const responseMessageId = randomUUID();
      const seenOfferKeys = new Set<string>();
      const rawFollowUpOptions = draft.followUpOptions ?? [];
      const validatedFollowUpOptions = rawFollowUpOptions.map((option): FollowUpOfferOption | null => {
        const key = option.key.trim().toLocaleLowerCase('en-US');
        const label = option.label.trim();
        const retrievalHints = option.retrievalHints.map((hint) => hint.trim()).filter((hint) => hint.length > 0 && hint.length <= 120).slice(0, 6);
        if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/u.test(key) || seenOfferKeys.has(key) || label.length === 0 || label.length > 160 || !offerOptionIsPresented(safeAnswer, { key, label, retrievalHints }) || retrievalHints.some((hint) => !offerHintIsGrounded(evidence, hint))) return null;
        try { assertKnownTokens(session, `${label} ${retrievalHints.join(' ')}`, tokenVault); } catch { return null; }
        seenOfferKeys.add(key);
        return { key, label, retrievalHints };
      }).filter((option): option is FollowUpOfferOption => Boolean(option));
      const validFollowUpOptions = rawFollowUpOptions.length > 0 && rawFollowUpOptions.length <= 4 && validatedFollowUpOptions.length === rawFollowUpOptions.length ? validatedFollowUpOptions : [];
      const untrackedKnowledgeOffer = safeGrounded && !setupConsultationTurn && !activeFollowUpOffer && !crmContactMissing && !consentActionReady && !journeyRequirement && !journeyOfferPending && !journeyConfirmationPending && !journeyDocumentPending && !journeyDocumentAwaiting && !catalogClarification && presentsUntrackedOffer(safeAnswer) && validFollowUpOptions.length === 0;
      if (untrackedKnowledgeOffer) {
        // Do not show a yes/no or multi-choice question that has no persisted state.
        const safeFallback = 'I can help with the next step. What would you like to focus on first?';
        const composedContinuation = await composeGuidedDraft({ answer: safeFallback, citationIds: [], proposedIntent: null }, 'intent_clarification');
        safeAnswer = presentsUntrackedOffer(composedContinuation.answer) ? safeFallback : composedContinuation.answer;
      }
      if (!endedConversation && !casualFallback && !continuityAnswer && !/\b(?:unsubscribe|do not contact|stop contacting)\b/iu.test(maskedMessage)) {
        const questionCount = (safeAnswer.match(/\?/gu) ?? []).length;
        if (questionCount !== 1 || !safeAnswer.trim().endsWith('?')) {
          const followUp = setupConsultationTurn && catalogSlotValues.business_activity
            ? 'Would you like me to compare the approved package options for this setup?'
            : nextMissingSlot && publishedCatalog
            ? catalogSlotQuestion(publishedCatalog, journeyResult?.activeIntentKey ?? catalogResolution?.intentKey ?? state.selectedIntentKey ?? '', nextMissingSlot, catalogSlotValues)
            : knowledgeQuestion && catalogSlotValues.business_activity
              ? 'Would you like me to compare the approved package options for this setup?'
              : 'What would you like to focus on next?';
          safeAnswer = `${safeAnswer.replace(/\?/gu, '').trim()} ${followUp}`.trim();
        }
      }
      const maskedAnswer = maskPiiForSession(session, safeAnswer, tokenVault);
      try { assertKnownTokens(session, maskedAnswer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      state.pendingFollowUpOffer = safeGrounded && validFollowUpOptions.length > 0
        ? { offerKey: randomUUID(), intentKey: state.selectedIntentKey, sourceMessageId: responseMessageId, sourceQuery: knowledgeRetrievalQuery, options: validFollowUpOptions, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
        : offerNeedsClarification ? activeFollowUpOffer
          : pendingValue || pendingConsentValue ? null
          : offerReply?.action === 'reject' || offerReply?.action === 'new_request' || acceptedOfferOption ? null : activeFollowUpOffer;
      state.pendingPrompt = nextPrompt;
      const nextContactConsent = catalogSlotValues.contact_consent === 'true' ? 'granted' : catalogSlotValues.contact_consent === 'false' ? 'denied' : state.contactConsent;
      if (nextContactConsent !== state.contactConsent) state.consentCapturedAt = nextContactConsent === 'unknown' ? null : new Date().toISOString();
      if (nextContactConsent !== state.contactConsent) await invalidateTenantCache(session.tenantId);
      state.contactConsent = nextContactConsent;
      state.summaryRevision += 1;
      state.messageSequence += 1;
      state.lastTurnAt = userMessage.createdAt;
      if (!offerOwnsConversationState) state.phase = endedConversation || knowledgeOnlyTurn ? state.phase : journeyDocumentPending ? 'DOCUMENT_COLLECTION' : journeyRequirement?.requirementType === 'slot' ? 'SLOT_COLLECTION' : postCaptureFollowUp ? state.phase : phaseFor({ intentKey: catalogResolution?.intentKey ?? pendingCatalogIntent, missingSlot: nextMissingSlot, consentPending: consentActionReady, actionPending: Boolean(catalogResolution?.actionAllowed && !consentDenied) });
      state.rollingSummary = composeConversationSummary(state, maskedMessage).slice(-4000);
      const opportunityIntentKey = journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey ?? '';
      const opportunityIdForAction = state.intentProgress?.entries[opportunityIntentKey]?.journeyId ?? currentOpportunityId;
      const establishingOriginalJourney = !reopeningOpportunity && !currentOpportunityId && Boolean(opportunityIdForAction);
      const legacyCandidates = establishingOriginalJourney && opportunityIntentKey
        ? sessionActions.filter((candidate) => candidate.opportunityId == null && candidate.intentKey === opportunityIntentKey && (candidate.catalogVersionId == null || candidate.catalogVersionId === (catalogResolution?.catalogVersionId ?? publishedCatalog?.id ?? null)) && ['awaiting_confirmation', 'awaiting_customer'].includes(candidate.state))
        : [];
      if (legacyCandidates.length > 1) throw new HttpError(409, 'LEGACY_ACTION_ASSOCIATION_AMBIGUOUS', 'Multiple legacy requests require controlled reconciliation before this journey can continue.');
      session.conversationState = state;
      if (legacyCandidates.length === 1 && opportunityIdForAction) {
        const migration = await store.establishLegacyJourneyAndAssignAction({ session, actionId: legacyCandidates[0]!.id, intentKey: opportunityIntentKey, catalogVersionId: legacyCandidates[0]!.catalogVersionId ?? null, opportunityId: opportunityIdForAction, eligibleStates: ['awaiting_confirmation', 'awaiting_customer'] });
        if (!migration.committed || migration.assignment.status === 'conflict' || migration.assignment.status === 'not_found') throw new HttpError(409, 'LEGACY_ACTION_ASSOCIATION_CONFLICT', 'The existing request changed while its journey identity was being established. Please retry.');
        if (migration.session.stateVersion !== undefined) session.stateVersion = migration.session.stateVersion;
        session.lastActivityAt = migration.session.lastActivityAt;
        session.closedAt = migration.session.closedAt;
        session.tokenMap = migration.session.tokenMap;
        const migratedAction = migration.assignment.action;
        if (migratedAction) {
          const index = sessionActions.findIndex((candidate) => candidate.id === migratedAction.id);
          if (index >= 0) sessionActions[index] = migratedAction;
        }
      } else {
        await updateSessionSafely(session, true);
      }
      const collectedSlotValues = Object.fromEntries(Object.entries(catalogSlotValues).filter(([key]) => !['name', 'email', 'phone', 'contact_consent'].includes(key)));
      const actionLeadData = { ...leadData, ...(Object.keys(collectedSlotValues).length ? { slotValues: collectedSlotValues } : {}), ...(catalogResolution?.interest ? { interest: catalogResolution.interest } : {}), ...(consentActionReady ? { contactConsent: false } : catalogSlotValues.contact_consent === 'true' ? { contactConsent: true } : !catalogResolution ? { contactConsent: false } : {}) };
      const actionAlreadySubmitted = Boolean(pendingConsentAction && ['approved', 'processing', 'completed'].includes(pendingConsentAction.state));
      const resumableAction = !reopeningOpportunity && catalogResolution?.intentKey ? sessionActions.find((candidate) => candidate.state === 'awaiting_customer' && candidate.catalogVersionId === catalogResolution.catalogVersionId && candidate.intentKey === catalogResolution.intentKey && actionMatchesTargetOpportunity(candidate, opportunityIdForAction) && candidate.payload.contactConsent === true) : null;
      const shouldResumeAction = Boolean(resumableAction && state.contactConsent === 'granted' && !consentDenied && !crmContactMissing && !journeyRequirement?.required && catalogSlotsReady && catalogResolution?.actionAllowed);
      const resumedAction = shouldResumeAction && resumableAction ? await store.approveAction({ ...resumableAction, state: 'approved', payload: { ...resumableAction.payload, ...actionLeadData }, result: null }) : null;
      if (resumedAction) {
        state.workflowStatus = 'queued';
        state.phase = 'QUEUED';
        state.pendingPrompt = null;
        session.conversationState = state;
        await updateSessionSafely(session, true);
      }
      const actionKeyForProposal = catalogResolution?.intentKey ?? catalogResolution?.workflowKey ?? 'lead.capture';
      const priorRevisions = opportunityIdForAction ? sessionActions.filter((candidate) => candidate.opportunityId === opportunityIdForAction && (candidate.actionKey ?? candidate.intentKey ?? candidate.workflowKey) === actionKeyForProposal).map((candidate) => candidate.actionRevision ?? 1) : [];
      const actionRevisionForProposal = priorRevisions.length ? Math.max(...priorRevisions) + 1 : 1;
      const intentActionAlreadySubmitted = Boolean(catalogResolution?.intentKey && sessionActions.some((candidate) => actionMatchesTargetOpportunity(candidate, opportunityIdForAction) && (candidate.intentKey ?? candidate.workflowKey) === catalogResolution.intentKey && ['awaiting_confirmation', 'awaiting_customer', 'approved', 'processing', 'completed'].includes(candidate.state)));
      const sameWorkflowOpportunityExists = Boolean(opportunityIdForAction && catalogResolution?.workflowKey && sessionActions.some((candidate) => candidate.opportunityId === opportunityIdForAction && candidate.workflowKey === catalogResolution.workflowKey && ['awaiting_confirmation', 'awaiting_customer', 'approved', 'processing', 'completed'].includes(candidate.state)));
      const shouldProposeAction = !resumedAction && !sameWorkflowOpportunityExists && !postCaptureFollowUp && !knowledgeQuestion && !offerReplyOwnsTurn && !journeyOfferPending && !transitionDenied && !declinedTransitionHold && (catalogResolution ? catalogSlotsReady && !intentActionAlreadySubmitted && !actionAlreadySubmitted && !consentDenied && !crmContactMissing && (catalogResolution.actionAllowed || consentActionReady) : draft.proposedIntent === 'lead.capture' && leadIntent && validatedLeadReady);
      if (process.env.ANCFZ_DIAGNOSTICS === 'true') {
        const gateReasons: string[] = [];
        if (!catalogResolution) gateReasons.push('catalog_resolution_missing');
        else if (catalogResolution.missingSlots.length > 0 && !consentActionReady) gateReasons.push('missing_required_slots');
        if (journeyBlocksAction) gateReasons.push('journey_requirement_pending');
        if (!workflowBinding) gateReasons.push('workflow_binding_missing');
        else if (!workflowBinding.active) gateReasons.push('workflow_binding_inactive');
        if (crmContactMissing) gateReasons.push('validated_contact_missing');
        if (consentRequirementPending && !consentActionReady && catalogSlotValues.contact_consent !== 'true') gateReasons.push('consent_not_ready');
        if (consentDenied) gateReasons.push('consent_denied');
        if (intentActionAlreadySubmitted) gateReasons.push('intent_action_duplicate');
        if (sameWorkflowOpportunityExists) gateReasons.push('same_workflow_opportunity');
        if (actionAlreadySubmitted) gateReasons.push('action_already_submitted');
        if (postCaptureFollowUp) gateReasons.push('post_capture_follow_up');
        if (knowledgeQuestion) gateReasons.push('knowledge_turn');
        if (offerReplyOwnsTurn) gateReasons.push('offer_reply');
        if (journeyOfferPending) gateReasons.push('journey_offer_pending');
        if (transitionDenied || declinedTransitionHold) gateReasons.push('transition_denied');
        if (catalogResolution && !catalogResolution.actionAllowed && !consentActionReady) gateReasons.push('no_action_permission');
        if (shouldProposeAction) gateReasons.push('eligible');
        await store.addAudit({
          id: randomUUID(),
          tenantId: session.tenantId,
          actorId: null,
          eventName: 'ancfz.action_gate.diagnostic',
          metadata: {
            messageSequence: state.messageSequence,
            catalogVersionId: publishedCatalog?.id ?? null,
            activeIntentKey: journeyResult?.activeIntentKey ?? state.intentProgress?.activeIntentKey ?? null,
            selectedIntentKey: state.selectedIntentKey ?? null,
            selectedJourney: journeyResult?.activeIntentKey ?? state.selectedIntentKey ?? null,
            catalogResolution: JSON.stringify(catalogResolution ? { intentKey: catalogResolution.intentKey, workflowKey: catalogResolution.workflowKey, reason: catalogResolution.reason, score: catalogResolution.score, confidence: catalogResolution.confidence, actionAllowed: catalogResolution.actionAllowed, missingSlots: catalogResolution.missingSlots } : null),
            workflowKey: catalogResolution?.workflowKey ?? null,
            workflowBindingActive: workflowBinding?.active ?? null,
            workflowBindingSideEffectClass: workflowBinding?.sideEffectClass ?? null,
            pendingJourneyRequirement: JSON.stringify(journeyRequirement ? { requirementKey: journeyRequirement.requirementKey, requirementType: journeyRequirement.requirementType, required: journeyRequirement.required, slotKey: journeySlotKey } : null),
            missingRequiredSlots: JSON.stringify(catalogResolution?.missingSlots ?? []),
            validatedContactFields: JSON.stringify({ name: validLeadName, email: validLeadEmail, phone: validLeadPhone }),
            explicitConsent: state.contactConsent,
            actionAllowed: catalogResolution?.actionAllowed ?? false,
            catalogSlotsReady,
            journeyBlocksAction,
            consentActionReady,
            shouldProposeAction,
            actionAlreadySubmitted,
            intentActionAlreadySubmitted,
            sameWorkflowOpportunityExists,
            actionRevisionForProposal,
            opportunityDigest: opportunityIdForAction ? contentHash(opportunityIdForAction).slice(0, 12) : null,
            existingActionIdentities: JSON.stringify(sessionActions.map((candidate) => ({ idDigest: contentHash(candidate.id).slice(0, 12), state: candidate.state, workflowKey: candidate.workflowKey, intentKey: candidate.intentKey ?? null, catalogVersionId: candidate.catalogVersionId ?? null, opportunityDigest: candidate.opportunityId ? contentHash(candidate.opportunityId).slice(0, 12) : null, actionRevision: candidate.actionRevision ?? null }))),
            reasonCodes: JSON.stringify(gateReasons),
            finalReason: gateReasons.at(-1) ?? 'not_eligible',
          },
          createdAt: new Date().toISOString(),
        });
      }
      const action = resumedAction ?? (shouldProposeAction ? await gateway.propose(session.tenantId, session.id, input.clientMessageId, actionLeadData, catalogResolution ? { workflowKey: catalogResolution.workflowKey ?? 'lead.capture', intentKey: catalogResolution.intentKey ?? 'lead.capture', actionKey: actionKeyForProposal, actionRevision: actionRevisionForProposal, opportunityId: opportunityIdForAction, intentScore: catalogResolution.score, intentConfidence: catalogResolution.confidence, catalogVersionId: catalogResolution.catalogVersionId, webhookPath: publishedCatalog?.catalog.workflowBindings.find((binding) => binding.workflowKey === catalogResolution.workflowKey)?.webhookPath ?? 'lead-capture' } : undefined) : null);
      const awaitingConfirmationAction = sessionActions.find((candidate) => candidate.state === 'awaiting_confirmation'
        && candidate.payload.contactConsent !== true
        && !consentDenied
        && (publishedCatalog
          ? candidate.catalogVersionId === publishedCatalog.id && candidate.intentKey === (pendingCatalogIntent ?? state.pendingPrompt?.intentKey) && actionMatchesTargetOpportunity(candidate, opportunityIdForAction)
          : !candidate.catalogVersionId));
      const actionForResponse = action ?? ((!offerReplyOwnsTurn && (knowledgeQuestion || state.pendingPrompt?.type === 'consent' || pendingPromptRequirement?.requirementType === 'consent' || awaitingConfirmationAction)) ? awaitingConfirmationAction ?? null : null);
      const finalAnswer = resumedAction ? 'Thanks — I have the remaining details and your request is back in processing.' : safeAnswer;
      const finalMaskedAnswer = resumedAction ? maskPiiForSession(session, finalAnswer, tokenVault) : maskedAnswer;
      const pendingCatalogState = publishedCatalog && (catalogResolution?.intentKey || journeyResult?.activeIntentKey) && (catalogResolution?.missingSlots.length || nextPrompt || journeyDocumentPending) ? { catalogIntentKey: catalogResolution?.intentKey ?? journeyResult?.activeIntentKey ?? null, catalogVersionId: catalogResolution?.catalogVersionId ?? publishedCatalog.id, catalogOpportunityId: opportunityIdForAction, catalogSlotKey: nextPrompt && (nextPrompt.type === 'slot' || nextPrompt.type === 'consent') ? nextMissingSlot : null, catalogRequirementKey: nextPrompt?.requirementKey ?? journeyRequirement?.requirementKey ?? null, catalogSlotValues, pendingPromptId: nextPrompt?.id ?? null } : null;
      const response = { messageId: responseMessageId, sessionId: session.id, answer: rehydrateForSession(session, finalMaskedAnswer, tokenVault), grounded: safeGrounded, conversational: casualFallback || leadCollection || catalogClarification || continuityAnswer || continuityTurn || offerClarificationAnswer || endedConversation, citations: safeCitations, actionProposal: actionForResponse && !resumedAction ? { id: actionForResponse.id, intent: actionForResponse.workflowKey, consentRequired: actionForResponse.payload.contactConsent !== true, confirmation: actionForResponse.payload.contactConsent !== true ? 'I consent to the use of my contact details to register this request.' : 'Your contact request is ready to submit.', expiresAt: new Date(Date.parse(actionForResponse.createdAt) + 15 * 60_000).toISOString() } : null, pendingPromptId: nextPrompt?.id ?? null, pendingIntentKey: pendingCatalogState?.catalogIntentKey ?? null, pendingRequirementKey: nextPrompt?.requirementKey ?? null, requestId: (req as AuthedRequest).requestId ?? randomUUID() };
      const persistedResponse = { ...response, answer: finalMaskedAnswer };
      const estimatedInputTokens = estimateTokens([maskedMessage, ...evidence.map((item) => item.content), persona?.name ?? '', persona?.personality ?? '', persona?.tone ?? '', persona?.speakingStyle ?? ''].join('\n'));
      const estimatedOutputTokens = estimateTokens(finalMaskedAnswer);
      await store.addMessage({ id: response.messageId, sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: finalMaskedAnswer, citations: safeCitations, clientMessageId: null, response: { conversational, ...(pendingCatalogState ?? {}) }, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: persistedResponse });
      await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'chat.response', metadata: { messageDigest: contentHash(response.messageId).slice(0, 12), responseDigest: contentHash(finalMaskedAnswer).slice(0, 12), personaVersionId: session.personaVersionId, language, intentKey: state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? null, grounded: safeGrounded, citationCount: safeCitations.length }, createdAt: new Date().toISOString() });
      await cache.set(responseCacheKey, { messageHash, response: persistedResponse }, chatResponseCacheTtlSeconds);
      recordChatOutcome(session.tenantId, safeGrounded, Boolean(actionForResponse), estimatedInputTokens, estimatedOutputTokens);
      res.json(response);
    } catch (error) {
      if (pendingMessage && !pendingMessage.response) {
        try { await store.updateMessage({ ...pendingMessage, response: { retryable: true } }); } catch { /* preserve the original failure response */ }
      }
      next(error);
    }
  });

  app.post('/api/v1/chat/actions/:id/confirm', chatApi, async (req, res, next) => {
    try {
      const input = parse(confirmSchema, req.body);
      const channel = getChannel(req);
      const action = await store.getAction(routeParam(req, 'id'));
      if (!action || action.sessionId !== input.sessionId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const session = await store.getSession(input.sessionId);
      const tenant = await store.getTenant(action.tenantId);
      if (!session || session.tenantId !== action.tenantId || !tenant || (channel && channel.tenantId !== action.tenantId) || (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== action.tenantId)) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.');
      if (!getAuth(req) && !channel) { enforcePublicOrigin(req, tenant, nodeEnv); enforcePublicChatEnabled(req, tenant); }
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      await authorizeSessionAccessToken(req, session);
      await activeTenant(store, action.tenantId);
      const confirmationState = session.conversationState ?? newConversationState();
      const confirmationIntentKey = confirmationState.activeFollowUpIntentKey ?? confirmationState.intentProgress?.activeIntentKey ?? confirmationState.selectedIntentKey;
      const confirmationOpportunityId = confirmationIntentKey ? confirmationState.intentProgress?.entries[confirmationIntentKey]?.journeyId ?? null : null;
      if (action.state === 'failed') throw new HttpError(409, 'ACTION_NOT_ACCEPTED', 'This request is no longer confirmable. Please start a new request.');
      if ((action.opportunityId ?? null) !== confirmationOpportunityId) throw new HttpError(409, 'ACTION_OPPORTUNITY_MISMATCH', 'This action belongs to a different conversation request.');
      if (session.conversationState?.contactConsent === 'denied' && action.payload.contactConsent !== true) throw new HttpError(422, 'CONSENT_DECLINED', 'The contact request was declined.');
      if (action.catalogVersionId && action.payload.contactConsent === false
        && (session.conversationState?.pendingPrompt?.type !== 'consent'
          || session.conversationState.pendingPrompt.intentKey !== action.intentKey
          || session.conversationState.catalogVersionId !== action.catalogVersionId)) {
        throw new HttpError(422, 'CONSENT_PROMPT_REQUIRED', 'Consent must be given for the active, purpose-scoped request.');
      }
      // V2 approval never borrows legacy goal/consent state. The tenant-pinned
      // action binding and independently persisted purpose consent must pass.
      const v2Authorization = await evaluatePersistedV2ActionConfirmation(store, session, action);
      if (v2Authorization.applies && !v2Authorization.accepted) {
        throw new HttpError(409, 'V2_ACTION_CONFIRMATION_DENIED',
          'The action cannot be approved without a confirmed goal, a current stage and purpose-specific consent.');
      }
      const confirmedState = confirmationState;
      const consentGranted = !v2Authorization.applies && (action.payload.contactConsent === true || action.payload.contactConsent === false);
      const sessionForApproval: Session = { ...session, lastActivityAt: new Date().toISOString(), tokenMap: new Map(session.tokenMap), conversationState: { ...confirmedState, ...(consentGranted ? { contactConsent: 'granted' as const, consentCapturedAt: new Date().toISOString(), consentVersion: consentVersionForState({ catalogVersionId: action.catalogVersionId ?? confirmedState.catalogVersionId, selectedIntentKey: action.intentKey ?? confirmedState.selectedIntentKey }) } : {}), workflowStatus: 'queued', phase: 'QUEUED', pendingPrompt: null } };
      const confirmed = await gateway.confirm(action.id, action.tenantId, sessionForApproval);
      if (!['approved', 'processing', 'completed'].includes(confirmed.state)) throw new HttpError(409, 'ACTION_NOT_ACCEPTED', 'This request was not accepted. Please start a new request.');
      Object.assign(session, sessionForApproval);
      await invalidateTenantCache(action.tenantId);
      res.json({ action: confirmed, message: null });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/actions/:id', chatApi, async (req, res, next) => { try { const { action } = await chatActionContext(req, routeParam(req, 'id')); res.json({ action }); } catch (error) { next(error); } });
  app.post('/api/v1/chat/actions/:id/follow-up', chatApi, async (req, res, next) => {
    try {
      const { action, session, tenant } = await chatActionContext(req, routeParam(req, 'id'));
      if (action.state !== 'reconcile_required') throw new HttpError(409, 'FOLLOW_UP_NOT_REQUIRED', 'A reconciliation follow-up is not available for this action state.');
      const message = await createReconciliationFollowUp(action, session, tenant);
      res.json({ message: { id: message.id, sessionId: message.sessionId, answer: rehydrateForSession(session, message.maskedContent, tokenVault), grounded: false, conversational: true, citations: [], createdAt: message.createdAt } });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/internal/crm/contact-lookup', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(z.object({
        tenantId: z.string().guid(), sessionId: z.string().guid(),
        actionId: z.string().guid(),
      }), req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId
        || !['approved', 'processing'].includes(action.state)) {
        throw new HttpError(403, 'CRM_LOOKUP_FORBIDDEN', 'CRM lookup requires an authorized, active tenant action.');
      }
      const lead = await store.getCrmLeadBySessionId(input.sessionId, input.tenantId);
      res.json({ matched: Boolean(lead), leadId: lead?.id ?? null, externalCRMId: lead?.leadId ?? null, crm: lead?.remoteCrm ?? null });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/internal/workflow-events/claim', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(workflowClaimSchema, req.body);
      const completionDeadlineMs = Number(process.env.N8N_COMPLETION_DEADLINE_MS ?? 15 * 60_000);
      const deadlineAt = new Date(Date.now() + (Number.isFinite(completionDeadlineMs) && completionDeadlineMs > 0 ? completionDeadlineMs : 15 * 60_000)).toISOString();
      const claims = await store.claimWorkflowActionsWithExecutions({ n8nWorkflowId: input.n8nWorkflowId, executionReference: input.executionReference, limit: input.limit ?? 10, attempt: input.attempt ?? 1, deadlineAt, ...(input.actionId ? { actionId: input.actionId } : {}), ...(input.tenantId ? { tenantId: input.tenantId } : {}), ...(input.workflowKey ? { workflowKey: input.workflowKey } : {}), ...(input.eventId ? { eventId: input.eventId } : {}), ...(input.correlationId ? { correlationId: input.correlationId } : {}) });
      const items = [];
      for (const claim of claims) {
        const { action, execution } = claim;
        const session = await store.getSession(action.sessionId);
        const v2Version = (await store.listIntentCatalogV2Versions(action.tenantId)).find(version => version.status === 'published' && version.catalogVersionRef === action.catalogVersionId);
        if (v2Version) {
          const document = session ? await store.getUserIntentDocument(action.tenantId, action.sessionId) : null;
          const workflow = v2Version.catalog.sheets.WorkflowBindings.find(binding => binding.workflowKey === action.workflowKey && binding.enabled);
          const tool = workflow ? v2Version.catalog.sheets.ToolBindings.find(binding => binding.registryKey === workflow.registryKey && binding.enabled && binding.sideEffectClass !== 'read_only') : null;
          const authorization = session && document && workflow && tool
            ? await evaluatePersistedV2ActionConfirmation(store, session, { ...action, state: 'awaiting_confirmation' })
            : { applies: true, accepted: false, reasons: ['v2_workflow_binding_missing'] };
          if (!session || !document || !workflow || !tool || !workflow.n8nWorkflowId || !workflow.webhookPath || !workflow.payloadContract || !authorization.accepted) {
            const failed = await store.transitionActionWithExecution({ actionId: action.id, tenantId: action.tenantId, fromState: action.state, toState: 'failed', result: null, providerStatus: 'failed', n8nExecutionRef: execution.n8nExecutionRef ?? input.executionReference, eventId: execution.eventId!, correlationId: execution.correlationId!, expectedAttempt: execution.attempt, outcome: { reason: authorization.reasons.join(',') || 'v2_workflow_authorization_failed' } });
            if (failed) await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.failed', metadata: { actionId: action.id, workflowKey: action.workflowKey, reason: authorization.reasons.join(',') || 'v2_workflow_authorization_failed' }, createdAt: new Date().toISOString() });
            continue;
          }
          const conversation = (await store.listMessages(action.sessionId, action.tenantId)).map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt }));
          const lead = await ensureV2LocalLead({ store, action, session: session!, tokenVault, vaultSecret });
          const rehydrateLeadValue = (value: string): string => rehydrateForSession(session!, value, tokenVault, 'admin_crm');
          const providerPayload = { name: rehydrateLeadValue(lead.leadData.name!), company: 'Individual', email: rehydrateLeadValue(lead.leadData.email!), phone: rehydrateLeadValue(lead.leadData.phone!), description: rehydrateLeadValue(lead.summary ?? `Intent: ${lead.intent}`), leadExternalId: lead.leadId, actionId: action.id };
          items.push({ actionId: action.id, tenantId: action.tenantId, sessionId: action.sessionId, opportunityId: action.opportunityId, workflowKey: workflow.registryKey, contract: input.contract ?? workflow.payloadContract, stageKey: document.currentStageKey, catalogVersionId: v2Version.catalogVersionRef, idempotencyKey: action.idempotencyKey, actionKey: action.actionKey, actionRevision: action.actionRevision, approvedPayload: action.payload.slotValues ?? {}, providerPayload, providerEnabled: true, v2Authorized: authorization.accepted, purposeConsentVerified: true, actionConfirmationVerified: true, eventId: execution.eventId ?? null, correlationId: execution.correlationId ?? null, attempt: execution.attempt, executionReference: execution.n8nExecutionRef ?? input.executionReference, conversation, catalog: v2Version.catalog });
          continue;
        }
        const version = action.catalogVersionId ? await store.getIntentCatalogVersion(action.tenantId, action.catalogVersionId) : null;
        const intent = version?.catalog.intents.find((item) => item.intentKey === action.intentKey);
        const binding = version?.catalog.workflowBindings.find((item) => item.workflowKey === action.workflowKey);
        const qualityRule = version?.catalog.qualityRules?.find((item) => item.intentKey === action.intentKey);
        const qualityBinding = qualityRule ? version?.catalog.workflowBindings.find((item) => item.workflowKey === qualityRule.qualityWorkflowKey) : null;
        if (!session || !version || !intent || !binding?.active || (qualityRule && !qualityBinding?.active)) {
          const failed = await store.transitionActionWithExecution({ actionId: action.id, tenantId: action.tenantId, fromState: action.state, toState: 'failed', result: null, providerStatus: 'failed', n8nExecutionRef: 'claim-validation-failed', eventId: execution.eventId!, correlationId: execution.correlationId!, expectedAttempt: execution.attempt, outcome: { reason: 'catalog_binding_invalid' } });
          if (failed) await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.failed', metadata: { actionId: action.id, workflowKey: action.workflowKey, reason: 'catalog_binding_invalid' }, createdAt: new Date().toISOString() });
          continue;
        }
        const conversation = (await store.listMessages(action.sessionId, action.tenantId)).map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt }));
        items.push({ actionId: action.id, tenantId: action.tenantId, sessionId: action.sessionId, workflowKey: action.workflowKey, contract: input.contract ?? binding.payloadContract, intent: intent.intentKey, intentSummary: `${intent.displayName}: ${intent.description}`, intentScore: action.intentScore ?? 0, intentConfidence: action.intentConfidence ?? 0, catalogVersionId: version.id, qualityWorkflowKey: qualityRule?.qualityWorkflowKey ?? null, idempotencyKey: action.idempotencyKey, opaqueReference: action.opaqueReference, eventId: execution.eventId ?? null, correlationId: execution.correlationId ?? null, attempt: execution.attempt, executionReference: execution.n8nExecutionRef ?? null, leadData: action.payload, conversation, catalog: version.catalog });
      }
      res.json({ items });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/internal/provider-evidence/verify', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(v2ProviderEvidenceVerifySchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const document = session ? await store.getUserIntentDocument(input.tenantId, input.sessionId) : null;
      const version = (await store.listIntentCatalogV2Versions(input.tenantId)).find((candidate) => candidate.status === 'published' && candidate.catalogVersionRef === input.catalogVersionId);
      const workflowBinding = version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === input.workflowKey && candidate.enabled);
      const toolBinding = workflowBinding ? version?.catalog.sheets.ToolBindings.find((candidate) => candidate.enabled && candidate.registryKey === workflowBinding.registryKey && candidate.sideEffectClass !== 'read_only') : null;
      if (!action || !session || !document || !version || !workflowBinding || !toolBinding || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== input.workflowKey || action.opportunityId !== input.opportunityId || action.catalogVersionId !== input.catalogVersionId || action.actionKey !== input.actionKey || action.actionRevision !== input.actionRevision) throw new HttpError(403, 'V2_PROVIDER_EVIDENCE_FORBIDDEN', 'Provider evidence does not match the pinned V2 action.');
      const correlationReason = validateV2ProviderCorrelation(action, input);
      if (correlationReason) throw new HttpError(409, 'V2_PROVIDER_CORRELATION_MISMATCH', `Provider evidence correlation is invalid (${correlationReason}).`);
      const execution = await store.getActionExecution(action.id, action.tenantId);
      if (!execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.attempt) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'Provider evidence does not match the current workflow execution.');
      if (action.state !== 'processing') throw new HttpError(409, 'V2_PROVIDER_ACTION_NOT_PROCESSING', 'Provider evidence can only finalize a claimed V2 action.');
      const providerType = workflowBinding.providerType;
      if (input.providerType && input.providerType !== providerType) throw new HttpError(409, 'V2_PROVIDER_TYPE_MISMATCH', 'Provider evidence type does not match the published workflow binding.');
      if (providerType !== 'deterministic_mock') {
        if (providerType !== 'salesforce_sandbox' || !salesforceLeadProvider) {
          const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
          res.status(409).json({ accepted: false, status: 'reconciliation_required', reason: 'provider_readback_requires_configured_node_adapter', action: reconciled });
          return;
        }
        const leadRequest = await ensureV2LocalLead({ store, action, session, tokenVault, vaultSecret });
        const request = buildV2LeadProviderRequest({ action, lead: leadRequest, providerType: 'salesforce_sandbox' });
        try {
          const readback = await salesforceLeadProvider.verify({ request, providerRecordId: input.providerRecordId });
          const result = {
            schemaVersion: request.schemaVersion,
            operation: request.operation,
            providerType: request.providerType,
            tenantId: request.tenantId,
            sessionId: request.sessionId,
            opportunityId: request.opportunityId,
            catalogVersionId: request.catalogVersionId,
            actionId: request.actionId,
            actionKey: request.actionKey,
            actionRevision: request.actionRevision,
            idempotencyKey: request.idempotencyKey,
            externalLeadId: readback.recordRef,
            deduplicated: input.providerReadback?.deduplicated === true,
            notificationStatus: 'not_sent' as const,
            evidenceTier: readback.evidenceTier,
          };
          const validation = validateV2LeadProviderResult(request, result, readback);
          if (!validation.accepted) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_INVALID', `Salesforce provider evidence was rejected (${validation.reasons.join(',')}).`);
          await store.updateCrmLeadRemote({ id: leadRequest.id, tenantId: action.tenantId, leadId: readback.recordRef, remoteCrm: 'salesforce_sandbox' });
          const completed = await transitionWorkflowAction(action, 'completed', readback.recordRef, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
          res.json({ accepted: true, status: validation.status, evidenceTier: validation.status, stageKey: input.stageKey, providerRecordRef: readback.recordRef,
            actionId: input.actionId, tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: input.opportunityId,
            catalogVersionId: input.catalogVersionId, idempotencyKey: input.idempotencyKey, actionKey: input.actionKey,
            actionRevision: input.actionRevision, eventId: input.eventId, correlationId: input.correlationId, attempt: input.attempt, action: completed });
        } catch (error) {
          const reason = error instanceof HttpError ? error.code : error instanceof Error && /^SALESFORCE_[A-Z0-9_]+$/u.test(error.message) ? error.message : 'provider_readback_failed';
          const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
          res.status(409).json({ accepted: false, status: 'reconciliation_required', reason, action: reconciled });
        }
        return;
      }
      const lead = await ensureV2LocalLead({ store, action, session, tokenVault, vaultSecret });
      if (lead.leadId && lead.leadId !== input.providerRecordId) throw new HttpError(409, 'V2_PROVIDER_RECORD_MISMATCH', 'The action is already linked to a different provider record.');
      const request = buildV2LeadProviderRequest({ action, lead, providerType: 'deterministic_mock' });
      const expected = new DeterministicV2LeadProvider().execute(request);
      const result = { ...expected, externalLeadId: input.providerRecordId };
      const readback = { tenantId: action.tenantId, sessionId: action.sessionId, opportunityId: action.opportunityId!, providerType: 'deterministic_mock', idempotencyKey: action.idempotencyKey, recordRef: input.providerRecordId, evidenceTier: 'mock_verified' as const, verificationStatus: 'verified' as const };
      const validation = validateV2LeadProviderResult(request, result, readback);
      if (!validation.accepted) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_INVALID', `Deterministic provider evidence was rejected (${validation.reasons.join(',')}).`);
      await store.updateCrmLeadRemote({ id: lead.id, tenantId: action.tenantId, leadId: input.providerRecordId, remoteCrm: 'deterministic_mock' });
      const completed = await transitionWorkflowAction(action, 'completed', input.providerRecordId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
      res.json({ accepted: true, status: validation.status, evidenceTier: validation.status, stageKey: input.stageKey, providerRecordRef: input.providerRecordId,
        actionId: input.actionId, tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: input.opportunityId,
        catalogVersionId: input.catalogVersionId, idempotencyKey: input.idempotencyKey, actionKey: input.actionKey,
        actionRevision: input.actionRevision, eventId: input.eventId, correlationId: input.correlationId, attempt: input.attempt, action: completed });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/internal/account-otp/issue', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(v2AccountOtpIssueSchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const document = session ? await store.getUserIntentDocument(input.tenantId, input.sessionId) : null;
      const version = (await store.listIntentCatalogV2Versions(input.tenantId)).find((candidate) => candidate.status === 'published' && candidate.catalogVersionRef === action?.catalogVersionId);
      const workflowBinding = version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === action?.workflowKey && candidate.enabled);
      const toolBinding = workflowBinding ? version?.catalog.sheets.ToolBindings.find((candidate) => candidate.enabled && candidate.toolKey === action?.actionKey && candidate.registryKey === workflowBinding.registryKey && candidate.sideEffectClass !== 'read_only') : null;
      const accountId = action?.payload.slotValues?.crmAccountId;
      const account = accountId ? await store.getCrmAccount(accountId, input.tenantId) : null;
      const lead = account ? await store.getCrmLead(account.leadId, input.tenantId) : null;
      if (!action || !session || !document || !version || !workflowBinding || !toolBinding || !account || !lead
        || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.opportunityId !== input.opportunityId
        || account.opportunityId !== input.opportunityId || account.leadId !== input.leadId || lead.sessionId !== input.sessionId
        || document.catalogSource !== 'v2' || document.catalogVersionRef !== action.catalogVersionId || document.opportunityId !== input.opportunityId || document.currentStageKey !== 'account_creation'
        || toolBinding.stageKey !== 'account_creation' || action.state !== 'processing' || account.status !== 'pending' || lead.qualificationStatus !== 'qualified' || !lead.leadId || !lead.remoteCrm
        || workflowBinding.providerType !== 'deterministic_mock' || nodeEnv === 'production') {
        throw new HttpError(409, 'ACCOUNT_OTP_NOT_ELIGIBLE', 'The Account OTP challenge is not eligible for this verified development action.');
      }
      const challenge = await v2AccountOtp.issue({ tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: input.opportunityId, leadId: input.leadId, code: input.code });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'account.otp_challenge_issued', metadata: { actionId: action.id, opportunityId: input.opportunityId, challengeId: challenge.challengeId, providerType: workflowBinding.providerType }, createdAt: new Date().toISOString() });
      res.json({ challenge: { ...challenge, code: undefined }, providerType: workflowBinding.providerType });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/internal/provider-evidence/account', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(v2AccountProviderEvidenceSchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const document = session ? await store.getUserIntentDocument(input.tenantId, input.sessionId) : null;
      const version = (await store.listIntentCatalogV2Versions(input.tenantId)).find((candidate) => candidate.status === 'published' && candidate.catalogVersionRef === input.catalogVersionId);
      const workflowBinding = version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === input.workflowKey && candidate.enabled);
      const toolBinding = workflowBinding ? version?.catalog.sheets.ToolBindings.find((candidate) => candidate.enabled && candidate.toolKey === input.actionKey && candidate.registryKey === workflowBinding.registryKey && candidate.sideEffectClass !== 'read_only') : null;
      const accountId = action?.payload.slotValues?.crmAccountId;
      const account = accountId ? await store.getCrmAccount(accountId, input.tenantId) : null;
      const lead = account ? await store.getCrmLead(account.leadId, input.tenantId) : null;
      const completedReplay = action?.state === 'completed' && account?.status === 'verified';
      if (!action || !session || !document || !version || !workflowBinding || !toolBinding || !account || !lead
        || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== input.workflowKey
        || action.opportunityId !== input.opportunityId || action.catalogVersionId !== input.catalogVersionId || action.actionKey !== input.actionKey
        || action.actionRevision !== input.actionRevision || account.opportunityId !== input.opportunityId || account.leadId !== lead.id
        || document.catalogSource !== 'v2' || document.catalogVersionRef !== action.catalogVersionId || document.opportunityId !== input.opportunityId
        || (!completedReplay && (document.currentStageKey !== 'account_creation' || input.stageKey !== 'account_creation' || toolBinding.stageKey !== 'account_creation' || account.status !== 'pending'))
        || lead.qualificationStatus !== 'qualified' || !lead.leadId || !lead.remoteCrm) {
        throw new HttpError(403, 'V2_ACCOUNT_PROVIDER_EVIDENCE_FORBIDDEN', 'Provider evidence does not match the pinned V2 Account action.');
      }
      const correlationReason = validateV2ProviderCorrelation(action, input);
      if (correlationReason) throw new HttpError(409, 'V2_PROVIDER_CORRELATION_MISMATCH', `Provider evidence correlation is invalid (${correlationReason}).`);
      const execution = await store.getActionExecution(action.id, action.tenantId);
      if (!execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.attempt) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'Provider evidence does not match the current workflow execution.');
      if (action.state === 'completed' && account.status === 'verified') {
        res.json({ accepted: true, status: 'mock_verified', evidenceTier: 'mock_verified', stageKey: input.stageKey, providerRecordRef: account.remoteAccountId, action });
        return;
      }
      if (action.state !== 'processing') throw new HttpError(409, 'V2_PROVIDER_ACTION_NOT_PROCESSING', 'Provider evidence can only finalize a claimed V2 action.');
      const providerType = workflowBinding.providerType;
      if (input.providerType && input.providerType !== providerType) throw new HttpError(409, 'V2_PROVIDER_TYPE_MISMATCH', 'Provider evidence type does not match the published workflow binding.');
      if (providerType !== 'deterministic_mock') {
        if (providerType !== 'salesforce_sandbox' || !salesforceAccountProvider) {
          await store.updateCrmAccount({ ...account, status: 'reconcile_required', updatedAt: new Date().toISOString() });
          const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
          res.status(409).json({ accepted: false, status: 'reconciliation_required', reason: 'account_provider_readback_requires_configured_node_adapter', action: reconciled });
          return;
        }
        const otp = await v2AccountOtp.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: input.opportunityId, leadId: lead.id, challengeId: input.otpChallengeId, code: input.otpCode });
        if (otp.status !== 'verified') throw new HttpError(409, 'OTP_VERIFICATION_FAILED', 'The OTP is invalid, expired, already used or bound to a different request.');
        const originalLeadAction = await store.getAction(lead.actionId);
        if (!originalLeadAction) throw new HttpError(409, 'V2_ACCOUNT_ORIGINAL_LEAD_ACTION_UNVERIFIED', 'The verified Lead action cannot be found.');
        const providerRequest = buildV2AccountProviderRequest({ action, lead, originalLeadAction, providerType: 'salesforce_sandbox', otp, explicitConfirmation: input.explicitConfirmation });
        try {
          const providerReadback = await salesforceAccountProvider.verifyAccount({ request: providerRequest, providerRecordId: input.providerRecordId });
          const result = {
            schemaVersion: providerRequest.schemaVersion,
            operation: providerRequest.operation,
            providerType: providerRequest.providerType,
            tenantId: providerRequest.tenantId,
            sessionId: providerRequest.sessionId,
            opportunityId: providerRequest.opportunityId,
            leadId: providerRequest.leadId,
            actionId: providerRequest.actionId,
            catalogVersionId: providerRequest.catalogVersionId,
            actionKey: providerRequest.actionKey,
            actionRevision: providerRequest.actionRevision,
            idempotencyKey: providerRequest.idempotencyKey,
            remoteAccountId: providerReadback.remoteAccountId,
            remoteContactId: providerReadback.remoteContactId,
            remoteOpportunityId: providerReadback.remoteOpportunityId,
            leadExternalId: providerReadback.leadExternalId,
            deduplicated: providerReadback.deduplicated,
            evidenceTier: providerReadback.evidenceTier,
          };
          const validation = validateV2AccountProviderResult(providerRequest, result, providerReadback);
          if (!validation.accepted) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_INVALID', `Salesforce Account provider evidence was rejected (${validation.reasons.join(',')}).`);
          const verifiedAccount = await store.updateCrmAccount({ ...account, remoteAccountId: result.remoteAccountId, remoteContactId: result.remoteContactId, remoteOpportunityId: result.remoteOpportunityId, status: 'verified', verifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          try {
            const completed = await transitionWorkflowAction(action, 'completed', result.remoteAccountId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
            res.json({ accepted: true, status: validation.status, evidenceTier: validation.status, stageKey: input.stageKey, providerRecordRef: result.remoteAccountId, account: verifiedAccount, action: completed });
          } catch (error) {
            await store.updateCrmAccount({ ...verifiedAccount, status: 'reconcile_required', updatedAt: new Date().toISOString() });
            throw error;
          }
        } catch (error) {
          const reason = error instanceof HttpError ? error.code : error instanceof Error && /^SALESFORCE_[A-Z0-9_]+$/u.test(error.message) ? error.message : 'provider_readback_failed';
          const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
          await store.updateCrmAccount({ ...account, status: 'reconcile_required', updatedAt: new Date().toISOString() });
          res.status(409).json({ accepted: false, status: 'reconciliation_required', reason, action: reconciled });
        }
        return;
      }
      if (!mockAccountProvider || nodeEnv === 'production') {
        await store.updateCrmAccount({ ...account, status: 'reconcile_required', updatedAt: new Date().toISOString() });
        const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
        res.status(409).json({ accepted: false, status: 'reconciliation_required', reason: 'account_provider_readback_requires_configured_node_adapter', action: reconciled });
        return;
      }
      const otp = await v2AccountOtp.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: input.opportunityId, leadId: lead.id, challengeId: input.otpChallengeId, code: input.otpCode });
      if (otp.status !== 'verified') throw new HttpError(409, 'OTP_VERIFICATION_FAILED', 'The OTP is invalid, expired, already used or bound to a different request.');
      const originalLeadAction = await store.getAction(lead.actionId);
      if (!originalLeadAction) throw new HttpError(409, 'V2_ACCOUNT_ORIGINAL_LEAD_ACTION_UNVERIFIED', 'The verified Lead action cannot be found.');
      const providerRequest = buildV2AccountProviderRequest({ action, lead, originalLeadAction, providerType: 'deterministic_mock', otp, explicitConfirmation: input.explicitConfirmation });
      const result = mockAccountProvider.execute(providerRequest);
      if (result.remoteAccountId !== input.providerRecordId) throw new HttpError(409, 'V2_PROVIDER_RECORD_MISMATCH', 'The provider Account record does not match the deterministic readback.');
      const readback = { tenantId: action.tenantId, sessionId: action.sessionId, opportunityId: action.opportunityId!, providerType: 'deterministic_mock', idempotencyKey: action.idempotencyKey, recordRef: result.remoteAccountId, evidenceTier: 'mock_verified' as const, verificationStatus: 'verified' as const };
      const validation = validateV2AccountProviderResult(providerRequest, result, readback);
      if (!validation.accepted) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_INVALID', `Deterministic Account provider evidence was rejected (${validation.reasons.join(',')}).`);
      const verifiedAccount = await store.updateCrmAccount({ ...account, remoteAccountId: result.remoteAccountId, remoteContactId: result.remoteContactId, remoteOpportunityId: result.remoteOpportunityId, status: 'verified', verifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      try {
        const completed = await transitionWorkflowAction(action, 'completed', result.remoteAccountId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
        res.json({ accepted: true, status: validation.status, evidenceTier: validation.status, stageKey: input.stageKey, providerRecordRef: result.remoteAccountId, account: verifiedAccount, action: completed });
      } catch (error) {
        await store.updateCrmAccount({ ...verifiedAccount, status: 'reconcile_required', updatedAt: new Date().toISOString() });
        throw error;
      }
    } catch (error) { next(error); }
  });
  const v2BillingAttestationScope = (input: z.infer<typeof v2ProviderEvidenceVerifySchema>) => ({
    actionId: input.actionId, tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: input.opportunityId,
    catalogVersionId: input.catalogVersionId, idempotencyKey: input.idempotencyKey, actionKey: input.actionKey,
    actionRevision: input.actionRevision, eventId: input.eventId, correlationId: input.correlationId, attempt: input.attempt,
  });
  app.post('/api/v2/internal/provider-evidence/invoice', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(v2InvoiceProviderEvidenceSchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const document = session ? await store.getUserIntentDocument(input.tenantId, input.sessionId) : null;
      const version = (await store.listIntentCatalogV2Versions(input.tenantId)).find((candidate) => candidate.status === 'published' && candidate.catalogVersionRef === input.catalogVersionId);
      const workflowBinding = version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === input.workflowKey && candidate.enabled);
      const toolBinding = workflowBinding ? version?.catalog.sheets.ToolBindings.find((candidate) => candidate.enabled && candidate.toolKey === input.actionKey && candidate.registryKey === workflowBinding.registryKey && candidate.stageKey === 'payment_invoice' && candidate.sideEffectClass !== 'read_only') : null;
      const invoiceId = action?.payload.slotValues?.invoiceId;
      const invoice = typeof invoiceId === 'string' ? await store.getInvoice(invoiceId, input.tenantId) : null;
      const completedReplay = action?.state === 'completed' && invoice?.externalInvoiceId !== null && invoice?.paymentUrl !== null;
      if (!action || !session || !document || !version || !workflowBinding || !toolBinding || !invoice
        || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== input.workflowKey
        || action.opportunityId !== input.opportunityId || action.catalogVersionId !== input.catalogVersionId || action.actionKey !== input.actionKey
        || action.actionRevision !== input.actionRevision || invoice.opportunityId !== input.opportunityId
        || document.catalogSource !== 'v2' || document.catalogVersionRef !== action.catalogVersionId || document.opportunityId !== input.opportunityId
        || (!completedReplay && (document.currentStageKey !== 'payment_invoice' || input.stageKey !== 'payment_invoice' || invoice.status !== 'pending'))) {
        throw new HttpError(403, 'V2_INVOICE_PROVIDER_EVIDENCE_FORBIDDEN', 'Provider evidence does not match the pinned V2 invoice action.');
      }
      await assertV2ProviderCorrelation(action, input);
      const execution = await store.getActionExecution(action.id, action.tenantId);
      if (!execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.attempt) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'Provider evidence does not match the current workflow execution.');
      if (completedReplay) { res.json({ ...v2BillingAttestationScope(input), accepted: true, status: invoice.provider === 'billing_live' ? 'provider_record_verified' : 'mock_verified', evidenceTier: invoice.provider === 'billing_live' ? 'provider_record_verified' : 'mock_verified', stageKey: input.stageKey, providerRecordRef: invoice.externalInvoiceId, invoice, action }); return; }
      if (action.state !== 'processing') throw new HttpError(409, 'V2_PROVIDER_ACTION_NOT_PROCESSING', 'Provider evidence can only finalize a claimed V2 action.');
      const providerType = workflowBinding.providerType;
      if (input.providerType && input.providerType !== providerType) throw new HttpError(409, 'V2_PROVIDER_TYPE_MISMATCH', 'Provider evidence type does not match the published workflow binding.');
      if (providerType === 'billing_live' && billingReadbackProvider) {
        const quote = await store.getQuote(invoice.quoteId, input.tenantId);
        if (!quote) throw new HttpError(409, 'BILLING_QUOTE_MISSING', 'The approved source quote is missing.');
        const invoiceRecord = await billingReadbackProvider.readInvoice(input.providerRecordId);
        let verified;
        try { verified = verifyLiveInvoiceReadback(invoice, quote, input.providerRecordId, invoiceRecord); }
        catch { throw new HttpError(409, 'BILLING_INVOICE_READBACK_INVALID', 'The issued and sent invoice failed independent provider verification.'); }
        const updatedInvoice = await store.updateInvoice({ ...invoice, externalInvoiceId: verified.externalInvoiceId, paymentUrl: verified.hostedPaymentUrl, provider: 'billing_live', status: 'pending', updatedAt: new Date().toISOString() });
        await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'invoice.live_delivery_verified', metadata: { invoiceId: invoice.id, quoteId: quote.id, opportunityId: invoice.opportunityId, actionId: action.id, externalInvoiceId: verified.externalInvoiceId, artifactSha256: verified.artifactSha256, deliveryStatus: verified.deliveryStatus, amountMinor: verified.amountMinor, currency: verified.currency }, createdAt: new Date().toISOString() });
        const completed = await transitionWorkflowAction(action, 'completed', verified.externalInvoiceId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
        res.json({ ...v2BillingAttestationScope(input), accepted: true, status: 'provider_record_verified', evidenceTier: 'provider_record_verified', stageKey: input.stageKey, providerRecordRef: verified.externalInvoiceId, invoice: updatedInvoice, action: completed });
        return;
      }
      if (providerType !== 'deterministic_mock' || !mockPaymentProvider || nodeEnv === 'production') {
        const reconciledInvoice = await store.updateInvoice({ ...invoice, status: 'reconcile_required', provider: providerType, updatedAt: new Date().toISOString() });
        const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
        res.status(409).json({ accepted: false, status: 'reconciliation_required', reason: 'invoice_provider_readback_requires_configured_node_adapter', invoice: reconciledInvoice, action: reconciled });
        return;
      }
      const providerRecordId = `mock-invoice-${createHash('sha256').update(action.idempotencyKey).digest('hex').slice(0, 24)}`;
      if (input.providerRecordId !== providerRecordId) throw new HttpError(409, 'V2_PROVIDER_RECORD_MISMATCH', 'The provider Invoice record does not match the deterministic readback.');
      const updatedInvoice = await store.updateInvoice({ ...invoice, externalInvoiceId: providerRecordId, paymentUrl: `https://sandbox.invalid/pay/${providerRecordId}`, provider: 'deterministic_mock', status: 'pending', updatedAt: new Date().toISOString() });
      const completed = await transitionWorkflowAction(action, 'completed', providerRecordId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'invoice.provider_readback_verified', metadata: { actionId: action.id, invoiceId: invoice.id, providerRecordId, evidenceTier: 'mock_verified' }, createdAt: new Date().toISOString() });
      res.json({ ...v2BillingAttestationScope(input), accepted: true, status: 'mock_verified', evidenceTier: 'mock_verified', stageKey: input.stageKey, providerRecordRef: providerRecordId, invoice: updatedInvoice, action: completed });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/internal/provider-evidence/payment', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(v2PaymentProviderEvidenceSchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const document = session ? await store.getUserIntentDocument(input.tenantId, input.sessionId) : null;
      const version = (await store.listIntentCatalogV2Versions(input.tenantId)).find((candidate) => candidate.status === 'published' && candidate.catalogVersionRef === input.catalogVersionId);
      const workflowBinding = version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === input.workflowKey && candidate.enabled);
      const toolBinding = workflowBinding ? version?.catalog.sheets.ToolBindings.find((candidate) => candidate.enabled && candidate.toolKey === input.actionKey && candidate.registryKey === workflowBinding.registryKey && candidate.stageKey === 'payment_invoice' && candidate.sideEffectClass !== 'read_only') : null;
      const invoiceId = action?.payload.slotValues?.invoiceId;
      const invoice = typeof invoiceId === 'string' ? await store.getInvoice(invoiceId, input.tenantId) : null;
      const quote = invoice ? await store.getQuote(invoice.quoteId, input.tenantId) : null;
      if (!action || !session || !document || !version || !workflowBinding || !toolBinding || !invoice || !quote
        || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== input.workflowKey
        || action.opportunityId !== input.opportunityId || action.catalogVersionId !== input.catalogVersionId || action.actionKey !== input.actionKey
        || action.actionRevision !== input.actionRevision || invoice.opportunityId !== input.opportunityId || quote.opportunityId !== input.opportunityId
        || document.catalogSource !== 'v2' || document.catalogVersionRef !== action.catalogVersionId || document.opportunityId !== input.opportunityId
        || document.currentStageKey !== 'payment_invoice' || input.stageKey !== 'payment_invoice') {
        throw new HttpError(403, 'V2_PAYMENT_PROVIDER_EVIDENCE_FORBIDDEN', 'Provider evidence does not match the pinned V2 payment action.');
      }
      await assertV2ProviderCorrelation(action, input);
      const execution = await store.getActionExecution(action.id, action.tenantId);
      if (!execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.attempt) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'Provider evidence does not match the current workflow execution.');
      if (action.state !== 'processing') throw new HttpError(409, 'V2_PROVIDER_ACTION_NOT_PROCESSING', 'Provider evidence can only finalize a claimed V2 action.');
      const providerType = workflowBinding.providerType;
      if (input.providerType && input.providerType !== providerType) throw new HttpError(409, 'V2_PROVIDER_TYPE_MISMATCH', 'Provider evidence type does not match the published workflow binding.');
      if (providerType === 'billing_live' && billingReadbackProvider) {
        if (!await hasVerifiedLiveInvoiceDelivery(store, session, invoice))
          throw new HttpError(409, 'BILLING_INVOICE_DELIVERY_NOT_VERIFIED', 'A completed invoice delivery action and independent readback proof are required before payment settlement.');
        const paymentRecord = await billingReadbackProvider.readPayment(input.providerRecordId);
        let verified;
        try { verified = verifyLivePaymentReadback(invoice, quote, input.providerRecordId, paymentRecord); }
        catch { throw new HttpError(409, 'BILLING_PAYMENT_READBACK_INVALID', 'Payment settlement has not been independently verified.'); }
        const paidInvoice = await store.updateInvoice({ ...invoice, status: 'paid', provider: 'billing_live', updatedAt: new Date().toISOString() });
        await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'payment.live_settlement_verified', metadata: { invoiceId: invoice.id, quoteId: quote.id, opportunityId: invoice.opportunityId, actionId: action.id, externalInvoiceId: verified.externalInvoiceId, paymentId: verified.paymentId, amountMinor: verified.amountMinor, currency: verified.currency, settledAt: verified.settledAt, evidenceTier: 'provider_record_verified' }, createdAt: new Date().toISOString() });
        const completed = await transitionWorkflowAction(action, 'completed', verified.paymentId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true);
        res.json({ ...v2BillingAttestationScope(input), accepted: true, status: 'provider_record_verified', paymentVerified: true, evidenceTier: 'provider_record_verified', stageKey: input.stageKey, providerRecordRef: verified.paymentId, invoice: paidInvoice, action: completed });
        return;
      }
      if (providerType !== 'deterministic_mock' || !mockPaymentProvider || nodeEnv === 'production') {
        const reconciledInvoice = await store.updateInvoice({ ...invoice, status: 'reconcile_required', provider: providerType, updatedAt: new Date().toISOString() });
        const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
        res.status(409).json({ accepted: false, status: 'reconciliation_required', reason: 'payment_provider_readback_requires_configured_node_adapter', invoice: reconciledInvoice, action: reconciled });
        return;
      }
      const artifactSha256 = contentHash(JSON.stringify({ invoiceId: invoice.id, externalInvoiceId: invoice.externalInvoiceId, amountMinor: invoice.amountMinor, currency: invoice.currency }));
      const providerRequest = buildV2PaymentProviderRequest({ invoice, quote, sessionId: session.id, tenantId: input.tenantId, artifactSha256, idempotencyKey: action.idempotencyKey, providerType: 'deterministic_mock' });
      const result = input.settle ? mockPaymentProvider.settle(providerRequest) : mockPaymentProvider.execute(providerRequest);
      if (input.providerRecordId !== result.paymentId) throw new HttpError(409, 'V2_PROVIDER_RECORD_MISMATCH', 'The provider Payment record does not match the provider readback.');
      const readback = result.status === 'mock_paid' ? { tenantId: input.tenantId, sessionId: session.id, opportunityId: input.opportunityId, providerType: 'deterministic_mock', idempotencyKey: action.idempotencyKey, recordRef: result.paymentId, evidenceTier: 'mock_verified' as const, verificationStatus: 'verified' as const } : undefined;
      const validation = validateV2PaymentProviderResult(providerRequest, result, readback);
      if (!validation.accepted) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_INVALID', `Deterministic Payment provider evidence was rejected (${validation.reasons.join(',')}).`);
      // Simulation does not settle money and must never mark an invoice paid.
      const updatedInvoice = await store.updateInvoice({ ...invoice, provider: 'deterministic_mock', status: 'pending', updatedAt: new Date().toISOString() });
      // A deterministic settlement remains a simulation. The authoritative
      // workflow must not complete or advance Stage 6 from mock settlement.
      const updatedAction = await transitionWorkflowAction(action, 'processing', result.paymentId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, false);
      res.json({ ...v2BillingAttestationScope(input), accepted: true, status: validation.status, paymentVerified: false, simulationPaid: validation.paymentVerified, evidenceTier: validation.status, stageKey: input.stageKey, providerRecordRef: result.paymentId, invoice: updatedInvoice, action: updatedAction });
    } catch (error) { next(error); }
  });
  app.post('/api/v2/internal/provider-evidence/contract', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(v2ContractProviderEvidenceSchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const document = session ? await store.getUserIntentDocument(input.tenantId, input.sessionId) : null;
      const version = (await store.listIntentCatalogV2Versions(input.tenantId)).find((candidate) => candidate.status === 'published' && candidate.catalogVersionRef === input.catalogVersionId);
      const workflowBinding = version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === input.workflowKey && candidate.enabled);
      const toolBinding = workflowBinding ? version?.catalog.sheets.ToolBindings.find((candidate) => candidate.enabled && candidate.toolKey === input.actionKey && candidate.registryKey === workflowBinding.registryKey && candidate.stageKey === 'contract' && candidate.sideEffectClass !== 'read_only') : null;
      const contractId = action?.payload.slotValues?.contractId;
      const contract = typeof contractId === 'string' ? await store.getContract(contractId, input.tenantId) : null;
      const selection = contract ? await store.getPackageSelection(contract.packageSelectionId, input.tenantId) : null;
      const invoice = contract?.invoiceId ? await store.getInvoice(contract.invoiceId, input.tenantId) : null;
      const account = contract ? await store.getCrmAccountByOpportunity(contract.opportunityId, input.tenantId) : null;
      if (!action || !session || !document || !version || !workflowBinding || !toolBinding || !contract || !selection || !invoice || !account
        || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== input.workflowKey
        || action.opportunityId !== input.opportunityId || action.catalogVersionId !== input.catalogVersionId || action.actionKey !== input.actionKey
        || action.actionRevision !== input.actionRevision || contract.opportunityId !== input.opportunityId
        || document.catalogSource !== 'v2' || document.catalogVersionRef !== action.catalogVersionId || document.opportunityId !== input.opportunityId
        || document.currentStageKey !== 'contract' || input.stageKey !== 'contract') {
        throw new HttpError(403, 'V2_CONTRACT_PROVIDER_EVIDENCE_FORBIDDEN', 'Provider evidence does not match the pinned V2 contract action.');
      }
      await assertV2ProviderCorrelation(action, input);
      const execution = await store.getActionExecution(action.id, action.tenantId);
      if (!execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.attempt) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'Provider evidence does not match the current workflow execution.');
      if (action.state !== 'processing') throw new HttpError(409, 'V2_PROVIDER_ACTION_NOT_PROCESSING', 'Provider evidence can only finalize a claimed V2 action.');
      const providerType = workflowBinding.providerType;
      if (input.providerType && input.providerType !== providerType) throw new HttpError(409, 'V2_PROVIDER_TYPE_MISMATCH', 'Provider evidence type does not match the published workflow binding.');
      if (providerType !== 'deterministic_mock' || !mockContractProvider || nodeEnv === 'production') {
        const reconciledContract = await store.updateContract({ ...contract, status: 'reconcile_required', provider: providerType, updatedAt: new Date().toISOString() });
        const reconciled = await transitionWorkflowAction(action, 'reconcile_required', undefined, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input);
        res.status(409).json({ accepted: false, status: 'reconciliation_required', reason: 'contract_provider_readback_requires_configured_node_adapter', contract: reconciledContract, action: reconciled });
        return;
      }
      const artifactSha256 = contentHash(JSON.stringify({ contractId: contract.id, packageSelectionId: selection.id, invoiceId: invoice.id, templateKey: contract.templateKey }));
      const providerRequest = buildV2ContractProviderRequest({ session, contract, selection, invoice, account, artifactSha256, signatoryRef: input.signatoryRef, signingExpiresAt: input.signingExpiresAt, customerApproval: input.customerApproval, paymentEvidenceTier: 'mock_verified', idempotencyKey: action.idempotencyKey, providerType: 'deterministic_mock' });
      const result = input.sign ? mockContractProvider.sign(providerRequest) : mockContractProvider.execute(providerRequest);
      if (input.providerRecordId !== result.remoteContractId) throw new HttpError(409, 'V2_PROVIDER_RECORD_MISMATCH', 'The provider Contract record does not match the provider readback.');
      const readback = result.status === 'signed' ? { tenantId: input.tenantId, sessionId: session.id, opportunityId: input.opportunityId, providerType: 'deterministic_mock', idempotencyKey: action.idempotencyKey, recordRef: result.remoteContractId, evidenceTier: 'mock_verified' as const, verificationStatus: 'verified' as const } : undefined;
      const validation = validateV2ContractProviderResult(providerRequest, result, readback);
      if (!validation.accepted) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_INVALID', `Deterministic Contract provider evidence was rejected (${validation.reasons.join(',')}).`);
      const updatedContract = await store.updateContract({ ...contract, externalContractId: result.remoteContractId, signingUrl: `https://sandbox.invalid/sign/${result.remoteContractId}`, status: validation.stageCompletionEligible ? 'signed' : 'sent', provider: 'deterministic_mock', updatedAt: new Date().toISOString() });
      const updatedAction = validation.stageCompletionEligible
        ? await transitionWorkflowAction(action, 'completed', result.remoteContractId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, true)
        : await transitionWorkflowAction(action, 'processing', result.remoteContractId, null, execution.n8nExecutionRef ?? undefined, input.eventId, input.correlationId, input.attempt, input, false);
      res.json({ accepted: true, status: validation.status, contractVerified: validation.stageCompletionEligible, evidenceTier: validation.status, stageKey: input.stageKey, providerRecordRef: result.remoteContractId, contract: updatedContract, action: updatedAction });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/workflow-events/complete', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(workflowCompletionSchema, req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(403, 'WORKFLOW_FORBIDDEN', 'Workflow completion does not match the authorized action.');
      const updated = await transitionWorkflowAction(action, input.state, input.externalReference, null, input.executionReference, input.eventId, input.correlationId, input.attempt, input);
      res.json({ action: updated });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/workflow-events/fail', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(workflowFailureSchema, req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(403, 'WORKFLOW_FORBIDDEN', 'Workflow failure does not match the authorized action.');
      const updated = await transitionWorkflowAction(action, input.state, undefined, null, input.executionReference, input.eventId, input.correlationId, input.attempt, input, false, { reasonCode: input.reasonCode, eventId: input.eventId, correlationId: input.correlationId, attempt: input.attempt });
      res.json({ action: updated, failure: { state: input.state, reasonCode: input.reasonCode, eventId: input.eventId, correlationId: input.correlationId, attempt: input.attempt } });
    } catch (error) { next(error); }
  });
  app.post('/api/internal/workflows/quote-pdf/execute', n8nInternalApi, async (req, res, next) => {
    try {
      if (!quoteWorkflowEnabled) throw new HttpError(503, 'QUOTE_WORKFLOW_DISABLED', 'The quote workflow is not enabled.');
      const input = parse(z.object({ actionId: z.string().guid(), tenantId: z.string().guid(), sessionId: z.string().guid() }).strict(), req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      if (!action || !session || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== 'package.confirm' || action.actionKey !== 'package.confirm' || !['approved', 'processing', 'completed'].includes(action.state) || action.payload.contactConsent !== true) throw new HttpError(403, 'QUOTE_ACTION_FORBIDDEN', 'The quote action does not match an approved session package selection.');
      const selectionId = action.payload.slotValues?.selectionId;
      const packageOfferingId = action.payload.slotValues?.packageOfferingId;
      if (typeof selectionId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(selectionId) || typeof packageOfferingId !== 'string' || !/^[0-9a-f-]{36}$/iu.test(packageOfferingId)) throw new HttpError(409, 'QUOTE_ACTION_PAYLOAD_INVALID', 'The approved package selection is incomplete.');
      if (action.state === 'completed' && action.result) { res.json({ verified: true, action }); return; }
      const customer = await resolveQuoteCustomer(session);
      const processing = action.state === 'approved' ? await store.updateAction({ ...action, state: 'processing', result: null }) : action;
      const selection = await store.getPackageSelection(selectionId, input.tenantId);
      const offering = await store.getPackageOffering(packageOfferingId, input.tenantId);
      if (!selection || !offering || selection.sessionId !== session.id || selection.opportunityId !== action.opportunityId || selection.packageOfferingId !== offering.id || offering.approvalStatus !== 'approved') throw new HttpError(403, 'QUOTE_SELECTION_SCOPE_DENIED', 'The package selection is not valid for this action.');
      const quote = selection.quoteId ? await store.getQuote(selection.quoteId, input.tenantId) : await createDevelopmentQuoteAfterLead(store, session, offering.id);
      if (!quote) throw new HttpError(409, 'QUOTE_NOT_FOUND', 'The approved quote could not be loaded.');
      if (selection.status !== 'confirmed') await store.confirmPackageSelection(selection.id, input.tenantId, quote.id);
      const tenant = await store.getTenant(input.tenantId);
      if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
      const artifact = await renderQuotePdf(quote, offering.name, customer, tenant.name);
      const completed = await store.updateAction({ ...processing, state: 'completed', result: { externalReference: `quote-${quote.id}`, artifactId: artifact.artifactId, artifactSha256: artifact.sha256, artifactFileName: artifact.fileName, artifactMimeType: artifact.mimeType } });
      const currentDocument = await store.getUserIntentDocument(input.tenantId, input.sessionId);
      const documentRequirementKey = await resolveActiveDocumentRequirementKey(input.tenantId, action.catalogVersionId ?? currentDocument?.catalogVersionRef ?? session.conversationState?.catalogVersionId ?? null, action.intentKey ?? currentDocument?.businessGoalKey ?? null);
      await advanceLifecycleStage(session, 'package_selection', { actionId: action.id, quoteId: quote.id, artifactSha256: artifact.sha256 }, documentRequirementKey);
      if (documentRequirementKey) {
        const refreshedDocument = await store.getUserIntentDocument(input.tenantId, input.sessionId);
        if (refreshedDocument && refreshedDocument.opportunityId === action.opportunityId && refreshedDocument.currentStageKey === 'document_upload' && refreshedDocument.pendingRequirementKey !== documentRequirementKey) {
          const updated = await store.updateUserIntentDocument({ document: { ...refreshedDocument, pendingRequirementKey: documentRequirementKey, lastQuestion: null, updatedAt: new Date().toISOString(), revision: refreshedDocument.revision + 1 }, expectedRevision: refreshedDocument.revision });
          if (!updated) throw new HttpError(409, 'V2_DOCUMENT_REQUIREMENT_CONFLICT', 'The document-upload requirement changed before the quote handoff completed.');
        }
        const afterAdvance = await store.getSession(input.sessionId);
        const afterState = afterAdvance?.conversationState;
        const afterIntentKey = afterState?.activeFollowUpIntentKey ?? afterState?.intentProgress?.activeIntentKey ?? afterState?.selectedIntentKey;
        const afterEntry = afterIntentKey ? afterState?.intentProgress?.entries[afterIntentKey] : null;
        const developmentHandoffAllowed = Boolean(afterEntry?.lifecycle && ['lead_generation', 'lead_qualification', 'account_creation', 'package_selection', 'document_upload'].includes(afterEntry.lifecycle.currentStage));
        if (developmentHandoffAllowed && afterEntry?.lifecycle?.currentStage !== 'document_upload') await handoffDevelopmentQuoteToDocumentStage(session, action.opportunityId!, documentRequirementKey);
        const handoffDocument = await store.getUserIntentDocument(input.tenantId, input.sessionId);
        if (developmentHandoffAllowed && handoffDocument && handoffDocument.opportunityId === action.opportunityId && handoffDocument.currentStageKey !== 'document_upload') {
          const handoffSession = await store.getSession(input.sessionId);
          const handoffState = handoffSession?.conversationState;
          const handoffIntentKey = handoffState?.activeFollowUpIntentKey ?? handoffState?.intentProgress?.activeIntentKey ?? handoffState?.selectedIntentKey;
          const handoffEntry = handoffIntentKey ? handoffState?.intentProgress?.entries[handoffIntentKey] : null;
          const updated = await store.updateUserIntentDocument({ document: { ...handoffDocument, currentStageKey: 'document_upload', stageRevision: handoffEntry?.lifecycle?.stages.document_upload.revision ?? handoffDocument.stageRevision, pendingRequirementKey: documentRequirementKey, lastQuestion: null, updatedAt: new Date().toISOString(), revision: handoffDocument.revision + 1 }, expectedRevision: handoffDocument.revision });
          if (!updated) throw new HttpError(409, 'V2_DOCUMENT_REQUIREMENT_CONFLICT', 'The document-upload requirement changed before the quote handoff completed.');
        }
      }
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'quote.workflow.completed', metadata: { actionId: action.id, quoteId: quote.id, artifactId: artifact.artifactId, artifactSha256: artifact.sha256 }, createdAt: new Date().toISOString() });
      res.json({ verified: true, mock: true, quote, artifact: { artifactId: artifact.artifactId, sha256: artifact.sha256, fileName: artifact.fileName, mimeType: artifact.mimeType }, action: completed });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/workflow-runs/:id/transition', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const action = await store.getAction(routeParam(req, 'id'));
      if (!action || action.tenantId !== tenantId) throw new HttpError(404, 'WORKFLOW_NOT_FOUND', 'Workflow action not found.');
      const input = parse(workflowTransitionSchema, req.body);
      const updated = await transitionWorkflowAction(action, input.state, input.externalReference, getAuth(req)?.userId ?? null, input.executionReference, input.eventId, input.correlationId, input.attempt);
      res.json({ action: updated });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/workflow-runs/:id/retry', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const actionId = routeParam(req, 'id');
      const retried = await store.retryActionAfterReconciliation({ actionId, tenantId, deadlineAt: new Date(Date.now() + Number(process.env.N8N_COMPLETION_DEADLINE_MS ?? 15 * 60_000)).toISOString(), reason: 'authorized_reconciliation_retry_after_provider_readback' });
      if (!retried) throw new HttpError(409, 'RECONCILIATION_RETRY_FORBIDDEN', 'Only an unlinked reconciliation-required action can be retried.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'workflow.reconciliation_retry_queued', metadata: { actionId, eventId: retried.event.eventId, correlationId: retried.event.correlationId }, createdAt: new Date().toISOString() });
      res.status(202).json({ action: { id: retried.action.id, state: retried.action.state, workflowKey: retried.action.workflowKey, idempotencyKey: retried.action.idempotencyKey }, event: { eventId: retried.event.eventId, correlationId: retried.event.correlationId, idempotencyKey: retried.event.idempotencyKey } });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/internal/crm/leads', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmLeadSchema, req.body);
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      const catalog = action?.catalogVersionId ? await store.getIntentCatalogVersion(input.tenantId, action.catalogVersionId) : null;
      const binding = action ? catalog?.catalog.workflowBindings.find((item) => item.workflowKey === action.workflowKey) : null;
      if (!action || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || (!['lead.capture', 'crm.lead.create'].includes(action.workflowKey) && !binding?.active) || !session || session.tenantId !== input.tenantId) throw new HttpError(403, 'LEAD_FORBIDDEN', 'Lead context does not match the authorized action.');
      const authorizedIntent = action.intentKey ?? action.workflowKey;
      if (input.intent !== authorizedIntent) throw new HttpError(403, 'LEAD_INTENT_MISMATCH', 'Lead intent does not match the authorized action.');
      const messages = await store.listMessages(input.sessionId, input.tenantId);
      const leadData = { ...(action.payload.name ? { name: action.payload.name } : {}), ...(action.payload.email ? { email: action.payload.email } : {}), ...(action.payload.phone ? { phone: action.payload.phone } : {}), ...(action.payload.interest ? { interest: action.payload.interest } : {}), ...(action.payload.slotValues ? { slotValues: action.payload.slotValues } : {}) };
      if (action.payload.contactConsent !== true) throw new HttpError(422, 'LEAD_CONSENT_REQUIRED', 'Explicit contact consent is required before creating this lead.');
      const rehydratedName = leadData.name ? rehydrateForSession(session, leadData.name, tokenVault, 'admin_crm') : '';
      const rehydratedEmail = leadData.email ? rehydrateForSession(session, leadData.email, tokenVault, 'admin_crm') : '';
      const rehydratedPhone = leadData.phone ? rehydrateForSession(session, leadData.phone, tokenVault, 'admin_crm') : '';
      const validName = Boolean(rehydratedName && isValidLeadName(rehydratedName));
      const validContact = Boolean(
        rehydratedEmail && isValidLeadEmail(rehydratedEmail)
        && rehydratedPhone && isValidLeadPhone(rehydratedPhone)
      );
      // Qualification must use visitor-supplied facts, not assistant wording or retrieved evidence.
      const conversationText = messages.filter((message) => message.role === 'user').map((message) => message.maskedContent).join(' ');
      const intentDefinition = catalog?.catalog.intents.find((intent) => intent.intentKey === authorizedIntent);
      const intentCategory = String(intentDefinition?.category ?? '').trim().toLocaleLowerCase();
      const supportOnly = ['support', 'customer_support', 'human_review'].includes(intentCategory);
      const catalogCommercial = Boolean(intentDefinition?.active && isCrmWriteBinding(binding));
      const legacyCommercial = !intentDefinition && ['lead.capture', 'crm.lead.create'].includes(action.workflowKey);
      const commercialIntent = Boolean((catalogCommercial || legacyCommercial) && (action.intentScore ?? 0) >= (intentDefinition?.minimumScore ?? 0) && (action.intentConfidence ?? 0) >= (intentDefinition?.confidenceThreshold ?? 0));
      const score = scoreCrmLead({ commercialIntent, timelineMentioned: /\b(?:today|tomorrow|urgent|asap|next\s+(?:week|month)|this\s+(?:week|month)|deadline|quarter)\b/i.test(conversationText), businessFit: /\b(?:company|business|licen[cs]e|visa|it|software|platform|quote|demo|service|setup)\b/i.test(conversationText), validName, validContact, engagedUserTurns: messages.filter((message) => message.role === 'user').length }).total;
      const validationPass = validName && validContact && commercialIntent && !supportOnly && action.payload.contactConsent === true && score >= 70;
      if (!validationPass) throw new HttpError(422, 'LEAD_VALIDATION_FAILED', 'The lead did not pass the completeness threshold.');
      const conversation = messages.map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt }));
      assertKnownTokens(session, JSON.stringify({ leadData, conversation }), tokenVault);
      const existing = await store.getCrmLeadByActionId(input.actionId, input.tenantId);
      if (existing) {
        if (input.completeAction && action.state !== 'completed') {
          const completedAction = await store.updateAction({ ...action, state: 'completed', result: { externalReference: `crm-lead-${existing.id}` } });
          await syncWorkflowState(completedAction, 'completed');
        }
        res.json({ lead: existing, externalReference: `crm-lead-${existing.id}` }); return;
      }
      const lead: CrmLead = { id: randomUUID(), tenantId: input.tenantId, actionId: input.actionId, sessionId: input.sessionId, intent: authorizedIntent, secondaryIntentKeys: (session.conversationState?.candidateIntentKeys ?? []).filter((key) => key !== authorizedIntent), intentScore: action.intentScore ?? 0, intentConfidence: action.intentConfidence ?? 0, catalogVersionId: action.catalogVersionId ?? null, score, contactCompletenessScore: contactCompletenessScore({ validName, validEmail: Boolean(rehydratedEmail && isValidLeadEmail(rehydratedEmail)), validPhone: Boolean(rehydratedPhone && isValidLeadPhone(rehydratedPhone)) }), validationPass, leadData, conversation, summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const created = await store.upsertCrmLead(lead, crmDedupeKey(input.tenantId, leadData, session, tokenVault, vaultSecret));
      if (created.actionId !== input.actionId || created.sessionId !== input.sessionId) {
        const association = await store.createCrmLeadAssociation({ id: randomUUID(), tenantId: input.tenantId, crmLeadId: created.id, actionId: input.actionId, sessionId: input.sessionId, opportunityId: action.opportunityId ?? null, associationType: 'deduplicated', createdAt: new Date().toISOString() });
        await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'crm.lead.reuse_requires_reconciliation', metadata: { leadId: created.id, actionId: input.actionId, originalActionId: created.actionId, sessionId: input.sessionId, originalSessionId: created.sessionId }, createdAt: new Date().toISOString() });
        res.status(201).json({ lead: created, externalReference: `crm-lead-${created.id}`, associationId: association.id, reconciliationRequired: true }); return;
      }
      await store.createCrmLeadAssociation({ id: randomUUID(), tenantId: input.tenantId, crmLeadId: created.id, actionId: input.actionId, sessionId: input.sessionId, opportunityId: action.opportunityId ?? null, associationType: 'canonical', createdAt: new Date().toISOString() });
      await store.linkSessionDocuments(created.sessionId, created.tenantId, created.id);
      if (input.completeAction) {
        const completedAction = await store.updateAction({ ...action, state: 'completed', result: { externalReference: `crm-lead-${created.id}` } });
        await syncWorkflowState(completedAction, 'completed');
      }
      session.conversationState = { ...(session.conversationState ?? newConversationState()), workflowStatus: 'queued', phase: 'QUEUED', pendingPrompt: null };
      await updateSessionSafely(session, true);
      await store.addAudit({ id: randomUUID(), tenantId: created.tenantId, actorId: null, eventName: 'crm.lead_created', metadata: { leadId: created.id, intent: created.intent, score: created.score, validationPass: created.validationPass }, createdAt: new Date().toISOString() });
      res.status(201).json({ lead: created, externalReference: `crm-lead-${created.id}` });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/crm/leads/:id/quality', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmQualitySchema, req.body);
      const lead = await store.getCrmLead(routeParam(req, 'id'), input.tenantId);
      const version = await store.getIntentCatalogVersion(input.tenantId, input.catalogVersionId);
      const intent = version?.catalog.intents.find((item) => item.intentKey === input.intentKey);
      const rule = version?.catalog.qualityRules?.find((item) => item.intentKey === input.intentKey);
      const binding = rule ? version?.catalog.workflowBindings.find((item) => item.workflowKey === rule.qualityWorkflowKey) : null;
      if (!lead || lead.intent !== input.intentKey || lead.catalogVersionId !== input.catalogVersionId || !version || !rule || rule.qualityWorkflowKey !== input.qualityWorkflowKey || !binding?.active) throw new HttpError(403, 'QUALITY_FORBIDDEN', 'Lead quality must use the published catalog workflow.');
      if (!intent) throw new HttpError(403, 'QUALITY_INTENT_MISMATCH', 'Lead quality intent does not match the catalog.');
      const updated = await store.updateCrmLeadScore(lead.id, input.tenantId, input.score);
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      res.json({ lead: updated, quality: catalogQuality(updated.score, rule) });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/crm/leads/:id/qualification', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmQualificationSchema, req.body);
      const lead = await store.getCrmLead(routeParam(req, 'id'), input.tenantId);
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      const scored = await store.updateCrmLeadScore(lead.id, input.tenantId, input.score);
      const documents = scored ? await store.listSupportingDocuments(scored.tenantId, undefined, scored.id) : [];
      const composed = documents.some((document) => document.status === 'completed') ? `${input.summary}\n${composeDocumentSummary(scored!, documents)}`.slice(0, 20_000) : input.summary;
      const summarized = scored ? await store.updateCrmLeadSummary(scored.id, input.tenantId, composed, 'completed') : null;
      const updated = summarized ? await store.updateCrmLeadQualification(summarized.id, input.tenantId, input.status, input.evidence) : null;
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      const action = await store.getAction(updated.actionId);
      if (action?.state === 'completed') await syncWorkflowState(action, 'completed');
      res.json({ lead: updated });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/crm/leads/:id/summary', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmSummarySchema, req.body);
      const lead = await store.getCrmLead(routeParam(req, 'id'), input.tenantId);
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      const session = await store.getSession(lead.sessionId);
      if (session) assertKnownTokens(session, input.summary, tokenVault);
      const documents = await store.listSupportingDocuments(lead.tenantId, undefined, lead.id);
      const composed = documents.some((document) => document.status === 'completed') ? `${input.summary}\n${composeDocumentSummary(lead, documents)}`.slice(0, 20_000) : input.summary;
      if (session) assertKnownTokens(session, composed, tokenVault);
      const updated = await store.updateCrmLeadSummary(lead.id, input.tenantId, composed, input.status);
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      res.json({ lead: updated });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/crm/leads/:id/remote', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmRemoteSchema, req.body);
      const updated = await store.updateCrmLeadRemote({ id: routeParam(req, 'id'), tenantId: input.tenantId, leadId: input.leadId, remoteCrm: input.remoteCrm });
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'crm.lead.remote_linked', metadata: { leadId: updated.id, remoteCrm: input.remoteCrm }, createdAt: new Date().toISOString() });
      res.json({ lead: updated });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/crm/leads/:id/remote-payload', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmRemotePayloadSchema, req.body);
      const lead = await store.getCrmLead(routeParam(req, 'id'), input.tenantId);
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      if (lead.actionId !== input.actionId) {
        if (!lead.leadId || !lead.remoteCrm) throw new HttpError(409, 'LEAD_ALREADY_LINKED', 'This lead is already associated with another action and requires reconciliation.');
        res.json({ alreadyLinked: true, canonicalLeadId: lead.id, existingRemoteLeadId: lead.leadId, existingRemoteCrm: lead.remoteCrm }); return;
      }
      if (lead.leadId || lead.remoteCrm) throw new HttpError(409, 'LEAD_ALREADY_LINKED', 'This lead is already linked to a remote CRM or the action does not match.');
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId || action.sessionId !== lead.sessionId || !['approved', 'processing'].includes(action.state)) throw new HttpError(403, 'REMOTE_PAYLOAD_FORBIDDEN', 'Remote CRM payload access is not authorized for this action.');
      const session = await store.getSession(lead.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Lead session not found.');
      const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault, 'admin_crm');
      if (!lead.validationPass || !lead.leadData.name || !lead.leadData.email || !lead.leadData.phone || action.payload.contactConsent !== true) throw new HttpError(422, 'REMOTE_CONTACT_INCOMPLETE', 'The lead requires a valid name, email and phone for remote CRM sync.');
      const payload = { name: rehydrate(lead.leadData.name), company: lead.leadData.slotValues?.company ? rehydrate(lead.leadData.slotValues.company) : 'Individual', email: lead.leadData.email ? rehydrate(lead.leadData.email) : '', phone: lead.leadData.phone ? rehydrate(lead.leadData.phone) : '', description: rehydrate(lead.summary ?? `Intent: ${lead.intent}`) };
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'crm.lead.remote_payload_issued', metadata: { leadId: lead.id, actionId: action.id }, createdAt: new Date().toISOString() });
      res.json(payload);
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/crm/leads/:id/remote-reconcile', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmRemoteReconcileSchema, req.body);
      const leadId = parse(z.string().uuid(), routeParam(req, 'id'));
      const lead = await store.getCrmLead(leadId, input.tenantId);
      const action = await store.getAction(input.actionId);
      if (!lead || !action || action.tenantId !== input.tenantId || action.state !== 'processing' || !lead.leadId || !lead.remoteCrm) throw new HttpError(403, 'REMOTE_RECONCILE_FORBIDDEN', 'Remote CRM reconciliation is not authorized for this action.');
      const association = await store.createCrmLeadAssociation({ id: randomUUID(), tenantId: input.tenantId, crmLeadId: lead.id, actionId: action.id, sessionId: action.sessionId, opportunityId: action.opportunityId ?? null, associationType: 'deduplicated', createdAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'crm.lead.remote_reconciled', metadata: { leadId: lead.id, actionId: action.id, remoteLeadId: lead.leadId, remoteCrm: lead.remoteCrm, associationId: association.id }, createdAt: new Date().toISOString() });
      res.json({ alreadyLinked: true, canonicalLeadId: lead.id, externalLeadId: lead.leadId, remoteCrm: lead.remoteCrm, associationId: association.id });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/crm/accounts/:id/remote-payload', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmAccountRemotePayloadSchema, req.body);
      const account = await store.getCrmAccount(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      const session = action ? await store.getSession(action.sessionId) : null;
      if (!account || account.status !== 'pending' || !action || !session || session.tenantId !== input.tenantId || action.tenantId !== input.tenantId || action.opportunityId !== account.opportunityId || !['approved', 'processing'].includes(action.state) || action.payload.slotValues?.crmAccountId !== account.id) throw new HttpError(403, 'ACCOUNT_REMOTE_PAYLOAD_FORBIDDEN', 'Remote Account conversion is not authorized for this action.');
      const lead = await store.getCrmLead(account.leadId, input.tenantId);
      if (!lead?.leadId || !lead.remoteCrm) throw new HttpError(409, 'LEAD_NOT_VERIFIED', 'A verified remote Lead is required before Account conversion.');
      res.json({ accountId: account.id, opportunityId: account.opportunityId, remoteLeadId: lead.leadId, remoteCrm: lead.remoteCrm, conversionRule: account.conversionRule });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/crm/accounts/:id/remote', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmAccountRemoteSchema, req.body);
      const account = await store.getCrmAccount(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      const v2Document = action ? await store.getUserIntentDocument(input.tenantId, action.sessionId) : null;
      const isV2Action = Boolean(v2Document?.catalogSource === 'v2' || (action && (await store.listIntentCatalogV2Versions(input.tenantId)).some((version) => version.catalogVersionRef === action.catalogVersionId)));
      if (isV2Action) throw new HttpError(409, 'V2_PROVIDER_EVIDENCE_REQUIRED', 'V2 Account conversion requires correlated provider evidence and readback.');
      if (!account || account.status !== 'pending' || !action || action.tenantId !== input.tenantId || action.opportunityId !== account.opportunityId || !['approved', 'processing'].includes(action.state) || action.payload.slotValues?.crmAccountId !== account.id) throw new HttpError(409, 'ACCOUNT_NOT_PENDING', 'This Account conversion is not awaiting a verified remote result.');
      const updated = await store.updateCrmAccount({ ...account, remoteAccountId: input.remoteAccountId, remoteContactId: input.remoteContactId, remoteOpportunityId: input.remoteOpportunityId, status: 'verified', verifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'crm.account.remote_verified', metadata: { accountId: account.id, opportunityId: account.opportunityId, remoteAccountId: input.remoteAccountId, remoteContactId: input.remoteContactId, remoteOpportunityId: input.remoteOpportunityId }, createdAt: new Date().toISOString() });
      res.json({ account: updated, verified: true });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/finance/invoices/:id/remote-payload', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(invoiceRemotePayloadSchema, req.body);
      const invoice = await store.getInvoice(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      if (!invoice || invoice.status !== 'pending' || !action || action.tenantId !== input.tenantId || action.opportunityId !== invoice.opportunityId || !['approved', 'processing'].includes(action.state) || action.payload.slotValues?.invoiceId !== invoice.id) throw new HttpError(403, 'INVOICE_REMOTE_PAYLOAD_FORBIDDEN', 'Invoice generation is not authorized for this action.');
      res.json({ invoiceId: invoice.id, opportunityId: invoice.opportunityId, amountMinor: invoice.amountMinor, currency: invoice.currency });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/finance/invoices/:id/remote', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(invoiceRemoteSchema, req.body);
      const invoice = await store.getInvoice(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      if (!invoice || !action || action.tenantId !== input.tenantId || action.opportunityId !== invoice.opportunityId || !['approved', 'processing'].includes(action.state) || action.payload.slotValues?.invoiceId !== invoice.id || !['pending', 'draft'].includes(invoice.status)) throw new HttpError(409, 'INVOICE_NOT_PENDING', 'This invoice is not awaiting a verified provider result.');
      const updated = await store.updateInvoice({ ...invoice, externalInvoiceId: input.externalInvoiceId, paymentUrl: input.paymentUrl, status: input.status, updatedAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'invoice.remote_verified', metadata: { invoiceId: invoice.id, status: input.status, externalInvoiceId: input.externalInvoiceId }, createdAt: new Date().toISOString() });
      res.json({ invoice: updated, verified: input.status === 'paid' });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/finance/invoices/:id/payment-status', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(paymentStatusSchema, req.body);
      const invoice = await store.getInvoice(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      if (!invoice || !action || action.tenantId !== input.tenantId || action.opportunityId !== invoice.opportunityId || invoice.externalInvoiceId !== input.externalInvoiceId) throw new HttpError(409, 'PAYMENT_STATUS_MISMATCH', 'The payment status does not match the authorized invoice.');
      const updated = await store.updateInvoice({ ...invoice, status: input.status, updatedAt: new Date().toISOString() });
      res.json({ invoice: updated, verified: input.status === 'paid' });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/contracts/:id/remote-payload', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(contractRemotePayloadSchema, req.body);
      const contract = await store.getContract(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      const invoice = contract?.invoiceId ? await store.getInvoice(contract.invoiceId, input.tenantId) : null;
      const account = contract ? await store.getCrmAccountByOpportunity(contract.opportunityId, input.tenantId) : null;
      if (!contract || contract.status !== 'draft' || !invoice || invoice.status !== 'paid' || !account || account.status !== 'verified' || !action || action.tenantId !== input.tenantId || action.opportunityId !== contract.opportunityId || !['approved', 'processing'].includes(action.state) || action.payload.slotValues?.contractId !== contract.id) throw new HttpError(403, 'CONTRACT_REMOTE_PAYLOAD_FORBIDDEN', 'Contract preparation prerequisites are not verified for this action.');
      res.json({ contractId: contract.id, opportunityId: contract.opportunityId, templateKey: contract.templateKey, remoteAccountId: account.remoteAccountId, packageSelectionId: contract.packageSelectionId, invoiceId: invoice.id });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/contracts/:id/remote', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(contractRemoteSchema, req.body);
      const contract = await store.getContract(routeParam(req, 'id'), input.tenantId);
      const action = await store.getAction(input.actionId);
      if (!contract || contract.status !== 'draft' || !action || action.tenantId !== input.tenantId || action.opportunityId !== contract.opportunityId || !['approved', 'processing'].includes(action.state) || action.payload.slotValues?.contractId !== contract.id) throw new HttpError(409, 'CONTRACT_NOT_PENDING', 'This contract is not awaiting a verified provider result.');
      const updated = await store.updateContract({ ...contract, externalContractId: input.externalContractId, signingUrl: input.signingUrl, status: input.status, updatedAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'contract.remote_verified', metadata: { contractId: contract.id, status: input.status, externalContractId: input.externalContractId }, createdAt: new Date().toISOString() });
      res.json({ contract: updated, verified: input.status === 'signed' });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/n8n/callback', async (req, res, next) => {
    try {
      if (!n8nCallbackSecret) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      const timestamp = req.header('x-agentic-timestamp') ?? '';
      const nonce = req.header('x-agentic-nonce') ?? '';
      const signature = req.header('x-agentic-signature') ?? '';
      const body = JSON.stringify(req.body);
      if (!verifyN8nPayload(n8nCallbackSecret, timestamp, nonce, body, signature)) throw new HttpError(401, 'INVALID_CALLBACK', 'Callback authentication failed.');
      if (!(await store.claimCallbackNonce(nonce, new Date(Date.now() + 300_000).toISOString()))) throw new HttpError(401, 'REPLAYED_CALLBACK', 'Callback replay rejected.');
      const input = parse(z.object({ actionId: z.string().guid(), tenantId: z.string().guid(), state: z.enum(['completed', 'failed']), externalReference: z.string().refine(isSafeExternalReference, 'An opaque external reference is required.'), executionReference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u), eventId: z.string().guid(), correlationId: z.string().guid(), attempt: z.number().int().min(1).max(100_000), ...v2ProviderCorrelationSchema.shape }), req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const updated = await transitionWorkflowAction(action, input.state, input.externalReference, null, input.executionReference, input.eventId, input.correlationId, input.attempt, input);
      await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: `workflow.callback.${input.state}`, metadata: { actionId: action.id, executionReference: input.executionReference ?? null, eventId: input.eventId ?? null, correlationId: input.correlationId ?? null, attempt: input.attempt ?? null }, createdAt: new Date().toISOString() });
      res.json({ action: updated });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/chat/sessions/:id/documents/config', chatApi, async (req, res, next) => {
    try {
      const session = await store.getSession(routeParam(req, 'id'));
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      await authorizeChatSession(req, session);
      res.json(await documentConfig(session.tenantId));
    } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/documents', chatApi, async (req, res, next) => {
    try {
      const session = await store.getSession(routeParam(req, 'id'));
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      await authorizeChatSession(req, session);
      const input = parse(documentUploadSchema, req.body);
      const existingLead = await store.getCrmLeadBySessionId(session.id, session.tenantId);
      const conversationState = session.conversationState ?? newConversationState();
      const activeIntentKeys = new Set([conversationState.selectedIntentKey, conversationState.activeFollowUpIntentKey, ...conversationState.candidateIntentKeys].filter((value): value is string => Boolean(value)));
      const requestedIntentKey = input.primaryIntentKey ?? conversationState.activeFollowUpIntentKey ?? conversationState.selectedIntentKey ?? existingLead?.intent ?? null;
      if (!requestedIntentKey || (!activeIntentKeys.has(requestedIntentKey) && existingLead?.intent !== requestedIntentKey)) throw new HttpError(409, 'DOCUMENT_INTENT_NOT_ACTIVE', 'The document must belong to the active conversation request.');
      const v2Version = conversationState.catalogVersionId
        ? (await store.listIntentCatalogV2Versions(session.tenantId)).find((candidate) => candidate.status === 'published' && (candidate.id === conversationState.catalogVersionId || candidate.catalogVersionRef === conversationState.catalogVersionId))
        : null;
      const version = v2Version ? null : conversationState.catalogVersionId
        ? await store.getIntentCatalogVersion(session.tenantId, conversationState.catalogVersionId)
        : await store.getPublishedIntentCatalog(session.tenantId);
      if (conversationState.catalogVersionId && !version && !v2Version) throw new HttpError(409, 'CATALOG_VERSION_UNAVAILABLE', 'This conversation uses an unavailable catalog version. Please start a new request.');
      const v2PolicyRow = v2Version?.catalog.sheets.DocumentPolicies.find((item) => item.goalKey === requestedIntentKey);
      const v2ProcessingBinding = v2Version?.catalog.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === 'anc.document.ocr.extract' && candidate.enabled);
      const settings = v2Version
        ? { enabled: Boolean(v2ProcessingBinding), requireUploadConsent: true, maxFileBytes: MAX_DOCUMENT_BYTES, allowedMimeTypes: v2PolicyRow?.mimeTypes ?? DEFAULT_DOCUMENT_MIME_TYPES, workflowKey: v2ProcessingBinding?.workflowKey ?? null }
        : version?.catalog.documentSettings;
      const binding = v2Version
        ? v2ProcessingBinding
        : settings ? version?.catalog.workflowBindings.find((candidate) => candidate.workflowKey === settings.workflowKey && candidate.active) : undefined;
      const policy = v2Version
        ? (() => {
          const candidate = v2PolicyRow;
          const tool = v2Version.catalog.sheets.ToolBindings.find((item) => ['document.ocr.extract', 'document.sf02_upload'].includes(item.toolKey) && item.goalKey === requestedIntentKey && item.enabled);
          return candidate && tool ? { enabled: candidate.enabled && tool.enabled, allowUserInitiated: true, consentRequired: tool.consent === 'purpose_specific', storeExtractedText: false, allowedDocumentTypes: [candidate.docType] } : undefined;
        })()
        : version?.catalog.documentPolicies?.find((candidate) => candidate.intentKey === requestedIntentKey) ?? version?.catalog.documentPolicies?.find((candidate) => candidate.intentKey === 'anc.document.supporting_upload');
      const journeyRequirement = v2Version
        ? (input.requirementKey && (v2Version.catalog.sheets.RequirementPolicies.some((candidate) => candidate.goalKey === requestedIntentKey && candidate.requirementKey === input.requirementKey && candidate.type === 'document') || v2PolicyRow?.policyKey === input.requirementKey) ? { requirementKey: input.requirementKey, documentType: v2PolicyRow?.docType ?? null } : null)
        : version?.catalog.journeyRequirements?.find((candidate) => candidate.intentKey === requestedIntentKey && candidate.requirementKey === input.requirementKey && candidate.requirementType === 'document') ?? null;
      const catalogVersionKey = v2Version?.catalogVersionRef ?? version?.id ?? null;
      if (input.requirementKey && (!journeyRequirement || !journeyRequirement.documentType || !policy?.allowedDocumentTypes.includes(journeyRequirement.documentType))) throw new HttpError(409, 'DOCUMENT_REQUIREMENT_NOT_ACTIVE', 'The requested document requirement is not active for this conversation.');
      const documentOpportunityId = conversationState.intentProgress?.entries[requestedIntentKey]?.journeyId ?? null;
      if (!documentOpportunityId) throw new HttpError(409, 'DOCUMENT_PACKAGE_NOT_CONFIRMED', 'A confirmed package selection is required before document upload.');
      const confirmedPackage = (await store.listPackageSelections(session.tenantId, documentOpportunityId)).find((selection) =>
        selection.status === 'confirmed' && selection.sessionId === session.id && selection.opportunityId === documentOpportunityId && selection.quoteId);
      const packageOffering = confirmedPackage ? await store.getPackageOffering(confirmedPackage.packageOfferingId, session.tenantId) : null;
      const quote = confirmedPackage?.quoteId ? await store.getQuote(confirmedPackage.quoteId, session.tenantId) : null;
      if (!confirmedPackage || !packageOffering || !quote || quote.status !== 'approved'
        || quote.opportunityId !== documentOpportunityId || quote.packageOfferingId !== packageOffering.id
        || Date.parse(quote.validUntil) <= Date.now() || packageOffering.approvalStatus !== 'approved'
        || (v2Version ? packageOffering.catalogVersionRef !== v2Version.catalogVersionRef : packageOffering.catalogVersionId !== version?.id))
        throw new HttpError(409, 'DOCUMENT_PACKAGE_NOT_CONFIRMED', 'A current approved quotation and confirmed package are required before document upload.');
      // Legacy single-document intake may omit requirementKey. Multi-document
      // packages must supply an explicit catalog requirement to avoid ambiguity.
      const expectedDocumentType = journeyRequirement?.documentType
        ?? (packageOffering.requiredDocuments.length === 1 ? packageOffering.requiredDocuments[0] ?? null : null);
      if (!expectedDocumentType || !packageOffering.requiredDocuments.includes(expectedDocumentType)
        || !policy?.allowedDocumentTypes.includes(expectedDocumentType))
        throw new HttpError(409, 'DOCUMENT_NOT_REQUIRED_BY_PACKAGE', 'The document requirement must match a required document for the confirmed package.');
      if (!settings?.enabled || !binding || !policy?.enabled || !policy.allowUserInitiated || !policy.consentRequired) throw new HttpError(409, 'DOCUMENT_WORKFLOW_NOT_AVAILABLE', 'Supporting document intake is not enabled for this tenant yet.');
      if (!settings.allowedMimeTypes.includes(input.mimeType) || !DEFAULT_DOCUMENT_MIME_TYPES.includes(input.mimeType)) throw new HttpError(422, 'DOCUMENT_TYPE_NOT_ALLOWED', 'This document type is not allowed by the published catalog.');
      if (!isValidBase64(input.contentBase64)) throw new HttpError(422, 'DOCUMENT_ENCODING_INVALID', 'The document encoding is invalid.');
      const content = Buffer.from(input.contentBase64, 'base64');
      const maxBytes = Math.min(settings.maxFileBytes, MAX_DOCUMENT_BYTES);
      if (content.length === 0 || content.length > maxBytes) throw new HttpError(413, 'DOCUMENT_TOO_LARGE', 'The document exceeds the published size limit.');
      if (!hasSupportingDocumentSignature(input.mimeType, content)) throw new HttpError(422, 'DOCUMENT_SIGNATURE_INVALID', 'The document content does not match its declared type.');
      const sha256 = documentSha256(content);
      const duplicate = (await store.listSupportingDocuments(session.tenantId, session.id)).find((candidate) => candidate.sha256 === sha256
        && (candidate.opportunityId ?? null) === documentOpportunityId
        && candidate.intentKey === requestedIntentKey
        && (candidate.catalogVersionId ?? null) === catalogVersionKey
        && (candidate.requirementKey ?? null) === (journeyRequirement?.requirementKey ?? input.requirementKey ?? null));
      if (duplicate?.status === 'failed') {
        const retryAt = new Date().toISOString();
        await documentStorage.replace(duplicate.storageKey, content);
        const queuedDocument: SupportingDocument = { ...duplicate, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, status: 'queued', extractedText: null, summary: null, errorCode: null, updatedAt: retryAt };
        const retryJob: DocumentProcessingJob = { id: randomUUID(), documentId: duplicate.id, tenantId: session.tenantId, workflowKey: binding.workflowKey, webhookPath: binding.webhookPath ?? '', status: 'queued', attempts: 0, leaseExpiresAt: null, executionReference: null, createdAt: retryAt, updatedAt: retryAt };
        const queuedJob = await store.requeueSupportingDocumentWithJob(queuedDocument, retryJob);
        await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'document.retry_queued', metadata: { documentId: duplicate.id, jobId: queuedJob.id, workflowKey: queuedJob.workflowKey }, createdAt: retryAt });
        res.status(202).json({ accepted: true, idempotent: true, retried: true, document: publicDocument(queuedDocument), jobId: queuedJob.id });
        return;
      }
      if (duplicate) { res.status(202).json({ accepted: true, idempotent: true, document: publicDocument(duplicate) }); return; }
      const documentId = randomUUID();
      const storageKey = documentStorage.key(session.tenantId, documentId, input.mimeType);
      await documentStorage.write(storageKey, content);
      const createdAt = new Date().toISOString();
      const document: SupportingDocument = { id: documentId, tenantId: session.tenantId, sessionId: session.id, leadId: existingLead?.id ?? null, opportunityId: conversationState.intentProgress?.entries[requestedIntentKey]?.journeyId ?? null, intentKey: requestedIntentKey, catalogVersionId: catalogVersionKey, requirementKey: journeyRequirement?.requirementKey ?? input.requirementKey ?? null, expectedDocumentType, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, sha256, storageKey, status: 'queued', workflowKey: binding.workflowKey, storeExtractedText: policy.storeExtractedText, extractedText: null, summary: null, errorCode: null, consentAt: createdAt, createdAt, updatedAt: createdAt };
      const job: DocumentProcessingJob = { id: randomUUID(), documentId, tenantId: session.tenantId, workflowKey: binding.workflowKey, webhookPath: binding.webhookPath ?? '', status: 'queued', attempts: 0, leaseExpiresAt: null, executionReference: null, createdAt, updatedAt: createdAt };
      try { await store.createSupportingDocumentWithJob(document, job); } catch (error) {
        await documentStorage.purge(storageKey);
        const concurrent = (error as { code?: unknown }).code === '23505'
          ? (await store.listSupportingDocuments(session.tenantId, session.id)).find((candidate) => candidate.sha256 === sha256
            && (candidate.opportunityId ?? null) === documentOpportunityId
            && candidate.intentKey === requestedIntentKey
            && (candidate.catalogVersionId ?? null) === (version?.id ?? null)
            && (candidate.requirementKey ?? null) === (journeyRequirement?.requirementKey ?? input.requirementKey ?? null))
          : null;
        if (concurrent) { res.status(202).json({ accepted: true, idempotent: true, document: publicDocument(concurrent) }); return; }
        throw error;
      }
      await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'document.uploaded', metadata: { documentId, jobId: job.id, workflowKey: job.workflowKey, bytes: content.length }, createdAt });
      res.status(202).json({ accepted: true, document: publicDocument(document), jobId: job.id });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/sessions/:id/documents', chatApi, async (req, res, next) => {
    try {
      const session = await store.getSession(routeParam(req, 'id'));
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      await authorizeChatSession(req, session);
      res.json({ items: (await store.listSupportingDocuments(session.tenantId, session.id)).map(publicDocument) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/sessions/:id/quotes/:quoteId/download', chatApi, async (req, res, next) => {
    try {
      const session = await store.getSession(routeParam(req, 'id'));
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      await authorizeChatSession(req, session);
      const quote = await store.getQuote(routeParam(req, 'quoteId'), session.tenantId);
      const document = await store.getUserIntentDocument(session.tenantId, session.id);
      if (!quote || !document || quote.opportunityId !== document.opportunityId || quote.status !== 'approved') throw new HttpError(404, 'QUOTE_NOT_FOUND', 'Quote not found.');
      const content = await documentStorage.read(documentStorage.key(session.tenantId, quote.id, 'application/pdf'));
      if (!content) throw new HttpError(404, 'QUOTE_PDF_NOT_FOUND', 'The quote PDF is not ready yet.');
      res.setHeader('content-type', 'application/pdf');
      res.setHeader('content-disposition', `attachment; filename="quote-${quote.id}.pdf"`);
      res.setHeader('cache-control', 'private, no-store');
      res.send(content);
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/crm/documents/:id/download', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const document = await store.getSupportingDocument(routeParam(req, 'id'), tenantId);
      if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
      const content = await documentStorage.read(document.storageKey);
      if (!content) throw new HttpError(404, 'DOCUMENT_INPUT_NOT_FOUND', 'Private document input not found.');
      res.setHeader('content-type', document.mimeType); res.setHeader('content-disposition', `attachment; filename="${document.fileName.replace(/["\\\r\n]/gu, '_')}"`); res.send(content);
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/sessions/:id', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const session = await store.getSession(routeParam(req, 'id')); if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); ensureLiveSession(session.lastActivityAt, session.closedAt); await authorizeSessionAccessToken(req, session); const tenant = await store.getTenant(session.tenantId); if (!tenant) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (!getAuth(req) && !channel) { if (tenant.status !== 'active' || !tenant.publicChatEnabled) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); enforcePublicOrigin(req, tenant, nodeEnv); } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.'); const { limit } = parse(historyQuerySchema, req.query); res.json({ sessionId: session.id, tenantId: session.tenantId, createdAt: session.createdAt, messages: (await store.listMessages(session.id, session.tenantId, limit)).map((message) => ({ id: message.id, role: message.role, content: message.role === 'assistant' ? rehydrateForSession(session, message.maskedContent, tokenVault) : message.maskedContent, citations: message.citations, conversational: message.response?.conversational === true, pendingIntentKey: typeof message.response?.catalogIntentKey === 'string' ? message.response.catalogIntentKey : null, pendingRequirementKey: typeof message.response?.catalogRequirementKey === 'string' ? message.response.catalogRequirementKey : null, clientMessageId: message.clientMessageId, createdAt: message.createdAt })) }); } catch (error) { next(error); } });

  app.get('/api/v1/admin/workflow-runs', protectedApi, async (req, res, next) => {
    try {
      const actions = await store.listActions(await tenantForRequest(store, req));
      res.json({ items: actions.map((action) => ({
        ...action,
        id: action.id,
        actionId: action.id,
        sessionId: action.sessionId,
        workflowKey: action.workflowKey,
        uiState: action.state === 'completed' ? 'success' : action.state === 'failed' ? 'failed' : 'running',
        lifecycleState: action.state,
      })) });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/crm/leads/:id/summarize', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => {
    try {
      parse(crmAdminSummarySchema, req.body ?? {});
      const tenantId = await tenantForRequest(store, req);
      const lead = await store.getCrmLead(routeParam(req, 'id'), tenantId);
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      const session = await store.getSession(lead.sessionId);
      if (!session || session.tenantId !== tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Lead session not found.');
      // Rebuild from current masked state so legacy OCR summaries cannot reintroduce stale privacy tokens.
      const documents = await store.listSupportingDocuments(lead.tenantId, undefined, lead.id);
      const baseSummary = composeDocumentSummary(lead, documents);
      if (!summaryModel?.summarize) throw new HttpError(503, 'CRM_SUMMARY_AI_UNAVAILABLE', 'The AI summary could not be generated. Please try again.');
      let candidate: string;
      try {
        candidate = await summaryModel.summarize({ maskedSummary: baseSummary, conversation: lead.conversation.map(({ role, content }) => ({ role, content })), intent: lead.intent, secondaryIntentKeys: lead.secondaryIntentKeys ?? [], score: lead.score, validationPass: lead.validationPass });
        assertKnownTokens(session, candidate, tokenVault);
      } catch {
        throw new HttpError(503, 'CRM_SUMMARY_AI_UNAVAILABLE', 'The AI summary could not be generated. Please try again.');
      }
      let formatted: string;
      try {
        formatted = formatCrmSummarySpec(candidate);
        assertKnownTokens(session, formatted, tokenVault);
      } catch (error) {
        if (error instanceof CrmSummaryValidationError) throw error;
        throw new HttpError(422, 'CRM_SUMMARY_PRIVACY_INVALID', 'The AI summary contained unsafe private data.');
      }
      const updated = await store.updateCrmLeadSummary(lead.id, tenantId, formatted, 'completed');
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'crm.lead.summary_formatted', metadata: { leadId: lead.id, aiGenerated: true }, createdAt: new Date().toISOString() });
      res.json({ lead: await crmLeadForAdmin(updated), aiGenerated: true });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/crm/leads', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); res.json({ items: await Promise.all((await store.listCrmLeads(tenantId)).map(crmLeadForAdmin)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/audit', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listAudit(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/intent-vocabulary', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { res.json({ items: await vocabulary.list(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/intent-vocabulary/:id/reject', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim().slice(0, 200) : undefined; res.json({ candidate: await vocabulary.reject(tenantId, routeParam(req, 'id'), reason) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/intent-vocabulary/:id/rollback', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { res.json({ candidate: await vocabulary.rollback(await tenantForRequest(store, req), routeParam(req, 'id')) }); } catch (error) { next(error); } });
  app.get('/api/v1/chat/config', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const tenantSlug = typeof req.query.tenantSlug === 'string' ? req.query.tenantSlug : ''; if (channel && tenantSlug) throw new HttpError(400, 'CHANNEL_TENANT_INPUT_FORBIDDEN', 'Channel credentials resolve the tenant from the channel key.'); const tenant = channel ? await store.getTenant(channel.tenantId) : await store.getTenantBySlug(tenantSlug); if (!tenant || tenant.status !== 'active' || (!channel && !tenant.publicChatEnabled)) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (channel && channel.tenantId !== tenant.id) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (getAuth(req) && !ensureTenant(req, tenant.id)) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv); const persona = await store.getPersona(tenant.id); res.json({ tenant: { slug: tenant.slug, name: tenant.name }, persona: persona ? { name: persona.name, greeting: persona.greeting, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages, voiceName: persona.voiceName, voiceLanguage: persona.voiceLanguage, voiceRate: persona.voiceRate, voicePitch: persona.voicePitch, voiceVolume: persona.voiceVolume } : null, documents: await documentConfig(tenant.id) }); } catch (error) { next(error); } });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as AuthedRequest).requestId ?? randomUUID();
    if (res.headersSent) { next(error); return; }
    if (errorType(error) === 'entity.too.large') { res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.', requestId } }); return; }
    if (errorType(error) === 'entity.parse.failed') { res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } }); return; }
    if (error instanceof HttpError) {
      if (error.code === 'MODEL_QUEUE_OVERLOADED' || error.code === 'MODEL_RATE_LIMITED' || error.code === 'MODEL_CIRCUIT_OPEN') {
        console.warn(JSON.stringify({ event: 'conversation.model_backpressure', requestId, code: error.code, status: error.status, message: error.message }));
      }
      res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } }); return;
    }
    if (error instanceof CrmSummaryValidationError) { res.status(422).json({ error: { code: 'CRM_SUMMARY_INVALID', message: error.message, requestId } }); return; }
    if (errorCode(error) === '23505') { res.status(409).json({ error: { code: 'RESOURCE_CONFLICT', message: 'The requested resource already exists.', requestId } }); return; }
    if (errorCode(error) === '22P02') { res.status(400).json({ error: { code: 'INVALID_DATA', message: 'The request contains invalid data.', requestId } }); return; }
    console.error(JSON.stringify({ event: 'api.unhandled_error', requestId, type: errorType(error), code: errorCode(error), message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
  });
  return { app, store, auth, gateway, workflow };
};

export const createDefaultApp = () => createApp({});

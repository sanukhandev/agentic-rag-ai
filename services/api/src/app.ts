import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ActionGateway, isSafeExternalReference, leadQuality, verifyN8nPayload, type WorkflowAdapter } from './actions.js';
import { AuthService, authMiddleware, ensureTenant, requireRoles, type AuthedRequest } from './auth.js';
import { cacheKey, createCache, type CacheStore } from './cache.js';
import { channelAuthMiddleware, ChannelSecretVault, getChannel, type StaticChannelAuth } from './channel-auth.js';
import { buildChunksWithEmbeddings, buildIngestionChunksWithEmbeddings, hasConflictingEvidence, presentKnowledgeText, rankChunksWithVector } from './knowledge.js';
import { DeterministicEmbeddingProvider, type EmbeddingProvider } from './embedding.js';
import { classifyOfferReply, conversationalIntent, conversationalReply, DeterministicGroundedModel, detectedLanguage, extractLeadData, hasLeadIntent, hasSufficientEvidence, isCatalogSlotNonAnswer, isContextualReply, isGuidedResponse, isKnowledgeQuestion, isPermittedLanguage, isSafeContinuityAnswer, leadCollectionReply, mergeLeadData, naturalAbstention, needsConversationContext, normalizeConversationQuery, openingGreeting, permittedLanguageReply, preservesNormalizationFacts, validateCitations, type ChatModel, type ModelDraft, type ModelEvidence, type QueryNormalizationInput } from './model.js';
import { assertKnownTokens, maskPiiForSession, rehydrateForSession, sanitizeKnowledgeText, TokenVault } from './privacy.js';
import { catalogIntentClarification, catalogIntentLabel, catalogNextFollowUpRequirement, catalogRequirementLabel, catalogSlotLabel, catalogSlotQuestion, isCrmWriteBinding, journeyDocumentMatchesRequirement, resolveIntent, resolveIntentContinuity, validateIntentCatalog } from './intent-catalog.js';
import { reduceIntentJourney } from './intent-journey.js';
import { exportIntentCatalogWorkbook } from './intent-catalog-xlsx.js';
import { composeConversationSummary, consentVersionForState, mergeConcurrentConversationState, mergeWorkflowCallbackState, newConversationState, phaseFor, prompt } from './conversation-state.js';
import { createOutboxEvent } from './events.js';
import { MemoryStore, contentHash } from './store-memory.js';
import { hasValidFileSignature, IngestionStaging, MAX_INGESTION_FILE_BYTES } from './ingestion-staging.js';
import { composeDocumentSummary, DEFAULT_DOCUMENT_MIME_TYPES, documentSha256, hasSupportingDocumentSignature, MAX_DOCUMENT_BYTES, PrivateDocumentStorage } from './document-intake.js';
import { contactCompletenessScore, isValidLeadEmail, isValidLeadName, isValidLeadPhone, scoreCrmLead } from './crm-scoring.js';
import { CrmSummaryValidationError, formatCrmSummarySpec } from './crm-summary.js';
import { assertPiiVaultSecret } from './runtime-security.js';
import type { ActionRequest, ActionState, ChannelCredential, CrmLead, DocumentProcessingJob, FollowUpOfferOption, IngestionJob, IngestionJobStatus, IntentCatalogQualityRule, IntentCatalogSlot, LeadData, Message, PendingFollowUpOffer, Session, SourceStatus, Store, SupportingDocument } from './types.js';
import { HttpError, parse } from './http/errors.js';
import {
  DEFAULT_CONTEXT_WINDOW_MESSAGES,
  confirmSchema,
  crmAdminSummarySchema,
  crmLeadSchema,
  crmQualitySchema,
  crmQualificationSchema,
  crmRemotePayloadSchema,
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
  intentCatalogEditSchema,
  intentCatalogResultSchema,
  intentCatalogUploadSchema,
  messageSchema,
  sessionSchema,
  sourceSchema,
  uploadSchema,
  workflowClaimSchema,
  workflowCompletionSchema,
  workflowTransitionSchema,
} from './http/schemas.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerHealthRoutes } from './routes/health.js';

type Telemetry = { requests: number; serverErrors: number; totalLatencyMs: number; lastRequestAt: string | null; chatResponses: number; groundedResponses: number; abstentions: number; actionProposals: number; estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: number | null; normalizationAttempts: number; normalizationFallbacks: number; normalizationFailures: number; normalizationLatencyMs: number };
export type RateLimitEntry = { count: number; resetAt: number };
export const pruneExpiredRateLimits = (entries: Map<string, RateLimitEntry>, now = Date.now()): void => {
  for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
};
const catalogQuality = (score: number, rule: IntentCatalogQualityRule | undefined): ReturnType<typeof leadQuality> => rule ? score >= rule.hotThreshold ? 'hot' : score >= rule.warmThreshold ? 'warm' : score >= rule.nurtureThreshold ? 'nurture' : 'new' : leadQuality(score);

const publicUser = (user: { id: string; email: string; role: string; tenantId: string | null }) => ({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });
const publicChannelCredential = (credential: ChannelCredential) => ({ id: credential.id, tenantId: credential.tenantId, channel: credential.channel, authMode: credential.authMode, keyId: credential.keyId, active: credential.active, createdAt: credential.createdAt, revokedAt: credential.revokedAt });

const errorProperty = (error: unknown, property: string): unknown => typeof error === 'object' && error !== null && property in error ? error[property as keyof typeof error] : undefined;
const errorType = (error: unknown): string | undefined => { const value = errorProperty(error, 'type'); return typeof value === 'string' ? value : undefined; };
const errorCode = (error: unknown): string | undefined => { const value = errorProperty(error, 'code'); return typeof value === 'string' ? value : undefined; };
const ingestionErrorDetail = (error: unknown): string | null => { const value = error instanceof Error ? error.message : String(error); const normalized = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim(); return normalized ? normalized.slice(0, 2_000) : null; };
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

const tenantForRequest = async (store: Store, req: Request): Promise<string> => {
  const auth = getAuth(req);
  if (auth?.role === 'platform_admin') {
    const requested = req.header('x-tenant-id') || (typeof req.query.tenantId === 'string' ? req.query.tenantId : null);
    if (requested) return requested;
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

const pendingCatalogSlotValue = (validationRule: string, rawInput: string, maskedInput: string, session: Session, tokenVault: TokenVault): string | null => {
  const tokenKind = validationRule.match(/^token:(NAME|EMAIL|PHONE)$/u)?.[1];
  if (tokenKind) {
    const existing = maskedInput.match(new RegExp(`\\[${tokenKind}_\\d+\\]`, 'u'))?.[0];
    if (existing) return existing;
    if (tokenKind !== 'NAME' || !/^\p{L}+(?:[ '\u2019-]\p{L}+){0,3}$/u.test(rawInput.trim())) return null;
    return maskPiiForSession(session, `My name is ${rawInput.trim()}`, tokenVault).match(/\[NAME_\d+\]/u)?.[0] ?? null;
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
  if (validationRule === 'enum:catalog_value') return maskedInput.trim() && !/^(?:yes|no|ok|okay|sure|confirm|nope)$/iu.test(rawInput.trim()) ? maskedInput.trim() : null;
  return null;
};

const catalogSlotTerms = (slot: IntentCatalogSlot): string[] => slot.slotKey.split(/[._-]+/u).filter((term) => term.length >= 4);

const messageMentionsCatalogSlot = (slot: IntentCatalogSlot, message: string): boolean => catalogSlotTerms(slot).some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\b`, 'iu').test(message));

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
}

export const createApp = (dependencies: AppDependencies = {}) => {
  const store = dependencies.store ?? new MemoryStore();
  const cache = dependencies.cache ?? createCache(process.env.REDIS_URL);
  const model: ChatModel = dependencies.model ?? new DeterministicGroundedModel();
  const workflow = dependencies.workflow;
  const nodeEnv = dependencies.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const jwtSecret = dependencies.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only-change-me';
  const configuredChannelCredentialKey = dependencies.channelCredentialKey ?? process.env.CHANNEL_CREDENTIAL_KEY;
  const channelCredentialKey = configuredChannelCredentialKey ?? 'local-development-channel-key';
  const staticChannelApiKey = dependencies.staticChannelApiKey || process.env.OMNI_CHANNEL_API_KEY || undefined;
  const staticChannelTenantId = dependencies.staticChannelTenantId || process.env.OMNI_CHANNEL_TENANT_ID || undefined;
  const staticChannelTenantSlug = dependencies.staticChannelTenantSlug || process.env.OMNI_CHANNEL_TENANT_SLUG || undefined;
  const staticChannelName = dependencies.staticChannelName ?? process.env.OMNI_CHANNEL_NAME ?? 'omnichannel';
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
  const chatSessionTtlMs = dependencies.chatSessionTtlMs ?? Number(process.env.CHAT_SESSION_TTL_MS ?? 10 * 60 * 1000);
  const readRate = (value: number | undefined, name: string): number | null => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return null; const parsed = Number(raw); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`); return parsed; };
  const inputCostUsdPerMillion = readRate(dependencies.inputCostUsdPerMillion, 'MODEL_INPUT_COST_USD_PER_MILLION');
  const outputCostUsdPerMillion = readRate(dependencies.outputCostUsdPerMillion, 'MODEL_OUTPUT_COST_USD_PER_MILLION');
  const readCacheTtl = (value: number | undefined, name: string, fallback: number, max: number): number => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${name} must be an integer between 0 and ${max}.`); return parsed; };
  const readRateLimit = (value: number | undefined, name: string, fallback: number, max: number): number => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${name} must be an integer between 1 and ${max}.`); return parsed; };
  const chatResponseCacheTtlSeconds = readCacheTtl(dependencies.chatResponseCacheTtlSeconds, 'CHAT_RESPONSE_CACHE_TTL_SECONDS', 60, 300);
  const catalogQueryNormalizationEnabled = dependencies.catalogQueryNormalizationEnabled ?? process.env.CATALOG_QUERY_NORMALIZATION_ENABLED === 'true';
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
  const syncWorkflowState = async (action: Pick<ActionRequest, 'id' | 'tenantId' | 'sessionId' | 'intentKey' | 'catalogVersionId'>, status: ActionState): Promise<void> => {
    const session = await store.getSession(action.sessionId);
    if (!session || session.tenantId !== action.tenantId) return;
    const currentState = session.conversationState;
    if (currentState && action.intentKey && currentState.selectedIntentKey && currentState.selectedIntentKey !== action.intentKey) return;
    if (currentState && action.catalogVersionId && currentState.catalogVersionId && currentState.catalogVersionId !== action.catalogVersionId) return;
    const workflowStatus = status === 'completed' ? 'succeeded' : status === 'reconcile_required' ? 'reconcile_required' : status === 'human_review' ? 'human_review' : status === 'failed' ? 'failed' : status === 'awaiting_customer' ? 'awaiting_customer' : 'processing';
    const phase = status === 'completed' ? 'SUCCEEDED' : status === 'reconcile_required' ? 'RECONCILE_REQUIRED' : status === 'human_review' ? 'HUMAN_REVIEW' : status === 'failed' ? 'FAILED' : status === 'awaiting_customer' ? 'SLOT_COLLECTION' : 'QUEUED';
    await updateSessionSafely({ ...session, conversationState: { ...(currentState ?? newConversationState()), workflowStatus, phase, pendingPrompt: null } }, true, 'workflow');
  };
  const assertWorkflowExecution = async (action: ActionRequest, executionReference: string | undefined, eventId: string | undefined, correlationId: string | undefined, attempt: number | undefined, requireReference: boolean): Promise<void> => {
    if (!eventId || !correlationId || attempt === undefined || (requireReference && !executionReference)) throw new HttpError(409, 'WORKFLOW_CORRELATION_REQUIRED', 'A verified workflow event, correlation, attempt and execution reference are required.');
    const execution = await store.getActionExecution(action.id, action.tenantId);
    if (!execution || execution.eventId !== eventId || execution.correlationId !== correlationId || execution.attempt !== attempt || (execution.n8nExecutionRef && executionReference && execution.n8nExecutionRef !== executionReference)) throw new HttpError(409, 'WORKFLOW_CORRELATION_MISMATCH', 'The workflow completion does not match the current execution claim.');
  };
  const transitionWorkflowAction = async (action: ActionRequest, status: ActionState, externalReference: string | undefined, actorId: string | null, executionReference?: string, eventId?: string, correlationId?: string, attempt?: number): Promise<ActionRequest> => {
    const resolvingReconciliation = action.state === 'reconcile_required' && status === 'completed';
    const providerTerminal = actorId === null && ['completed', 'failed'].includes(status);
    if (providerTerminal) await assertWorkflowExecution(action, executionReference, eventId, correlationId, attempt, true);
    else if (eventId || correlationId || executionReference) await assertWorkflowExecution(action, executionReference, eventId, correlationId, attempt, false);
    const resolvesReconciliation = resolvingReconciliation;
    const allowed = action.state === status
      || (['approved', 'processing'].includes(action.state) && ['processing', 'completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review'].includes(status))
      || (action.state === 'human_review' && ['completed', 'failed', 'reconcile_required'].includes(status))
      || (action.state === 'awaiting_customer' && ['processing', 'completed', 'failed', 'reconcile_required'].includes(status))
      || resolvesReconciliation;
    if (!allowed) throw new HttpError(409, 'WORKFLOW_TRANSITION_FORBIDDEN', `Workflow action cannot transition from ${action.state} to ${status}.`);
    if (providerTerminal) {
      const committed = await store.transitionActionWithExecution({ actionId: action.id, tenantId: action.tenantId, fromState: action.state, toState: status, result: externalReference ? { externalReference } : action.result, providerStatus: status, n8nExecutionRef: executionReference!, eventId: eventId!, correlationId: correlationId!, expectedAttempt: attempt!, resolveReconciliation: resolvesReconciliation, outcome: externalReference ? { externalReference } : null });
      if (!committed) throw new HttpError(409, 'WORKFLOW_TRANSITION_CONFLICT', 'The workflow action and execution changed before this transition was committed.');
      await syncWorkflowState(committed.action, status);
      await store.addAudit({ id: randomUUID(), tenantId: committed.action.tenantId, actorId, eventName: `workflow.transition.${action.state}.${status}`, metadata: { actionId: committed.action.id, fromState: action.state, toState: status }, createdAt: new Date().toISOString() });
      return committed.action;
    }
    const executionContext = { ...(eventId ? { eventId } : {}), ...(correlationId ? { correlationId } : {}), ...(attempt !== undefined ? { expectedAttempt: attempt } : {}) };
    if (action.state === status) { await syncWorkflowState(action, status); await store.updateActionExecution({ actionId: action.id, tenantId: action.tenantId, providerStatus: status, n8nExecutionRef: executionReference ?? null, outcome: externalReference ? { externalReference } : null, resolveReconciliation: resolvesReconciliation, ...executionContext }); return action; }
    const updated = await store.transitionAction(action.id, action.tenantId, action.state, status, externalReference ? { externalReference } : action.result);
    if (!updated) {
      const current = await store.getAction(action.id);
      if (current?.state === status) { await syncWorkflowState(current, status); return current; }
      throw new HttpError(409, 'WORKFLOW_TRANSITION_CONFLICT', 'The workflow action changed before this transition was committed.');
    }
    await syncWorkflowState(updated, status);
    await store.updateActionExecution({ actionId: updated.id, tenantId: updated.tenantId, providerStatus: status, n8nExecutionRef: executionReference ?? null, outcome: externalReference ? { externalReference } : null, resolveReconciliation: resolvesReconciliation, ...executionContext });
    await store.addAudit({ id: randomUUID(), tenantId: updated.tenantId, actorId, eventName: `workflow.transition.${action.state}.${status}`, metadata: { actionId: updated.id, fromState: action.state, toState: status }, createdAt: new Date().toISOString() });
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
    if (!model.normalizeQuery || !catalogQueryNormalizationEnabled || Date.now() < health.blockedUntil) return { value: fallback, usedFallback: true, failed: Date.now() < health.blockedUntil };
    const contextDigest = contentHash(JSON.stringify((input.conversation ?? []).slice(-8).map((turn) => ({ role: turn.role, content: turn.content.slice(-1_000) }))));
    const key = cacheKey('catalog-normalized-query-v3', tenantId, catalogVersionId, input.selectedIntentKey ?? '', contextDigest, input.maskedMessage);
    const cached = await cache.get<string>(key);
    if (cached) return { value: cached, usedFallback: false, failed: false };
    try {
      const normalized = await model.normalizeQuery(input);
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
  };
  const rateLimitMax = readRateLimit(dependencies.rateLimitMax, 'API_RATE_LIMIT_MAX', nodeEnv === 'development' ? 600 : 120, 100_000);
  const rateLimitWindowMs = readRateLimit(dependencies.rateLimitWindowMs, 'API_RATE_LIMIT_WINDOW_MS', 60_000, 3_600_000);
  if (nodeEnv === 'production' && (!dependencies.model || !dependencies.embedding || !n8nCallbackSecret || !ingestionWorkerSecret)) throw new Error('Production Azure, embedding, n8n polling and ingestion adapters are required.');
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
    if (origin && allowed.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-headers', 'content-type,authorization,x-request-id,x-tenant-id,x-agentic-key-id,x-agentic-timestamp,x-agentic-nonce,x-agentic-signature'); res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.status(origin && allowed.has(origin) ? 204 : 403).end(); return; }
    next();
  });
  // shortcut: one bounded JSON parser supports local 20 MiB base64 uploads; replace with streaming/object storage before production.
  app.use(express.json({ limit: '30mb' }));
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
    const version = lead.catalogVersionId ? await store.getIntentCatalogVersion(lead.tenantId, lead.catalogVersionId) : null;
    const qualityRule = version?.catalog.qualityRules?.find((rule) => rule.intentKey === lead.intent);
    const quality = catalogQuality(lead.score, qualityRule);
    const session = await store.getSession(lead.sessionId);
    const documents = await store.listSupportingDocuments(lead.tenantId, undefined, lead.id);
    if (!session) return { ...lead, quality, documents };
    const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault, 'admin_crm');
    const summary = lead.summary ? (() => { try { return formatCrmSummarySpec(lead.summary); } catch { return lead.summary; } })() : null;
    return { ...lead, quality, leadData: { ...(lead.leadData.name ? { name: rehydrate(lead.leadData.name) } : {}), ...(lead.leadData.email ? { email: rehydrate(lead.leadData.email) } : {}), ...(lead.leadData.phone ? { phone: rehydrate(lead.leadData.phone) } : {}), ...(lead.leadData.interest ? { interest: lead.leadData.interest } : {}), ...(lead.leadData.slotValues ? { slotValues: Object.fromEntries(Object.entries(lead.leadData.slotValues).map(([key, value]) => [key, rehydrate(value)])) } : {}) }, conversation: lead.conversation.map((message) => ({ ...message, content: rehydrate(message.content) })), summary: summary ? rehydrate(summary) : null, documents: documents.map((document) => ({ ...document, extractedText: document.extractedText ? rehydrate(document.extractedText) : null, summary: document.summary ? rehydrate(document.summary) : null })) };
  };

  const publicDocument = (document: SupportingDocument) => ({ id: document.id, sessionId: document.sessionId, leadId: document.leadId, requirementKey: document.requirementKey ?? null, expectedDocumentType: document.expectedDocumentType ?? null, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, status: document.status, summary: null, errorCode: document.errorCode, createdAt: document.createdAt, updatedAt: document.updatedAt });
  const documentConfig = async (tenantId: string) => {
    const version = await store.getPublishedIntentCatalog(tenantId);
    const settings = version?.catalog.documentSettings;
    const policies = version?.catalog.documentPolicies ?? [];
    const binding = settings ? version?.catalog.workflowBindings.find((candidate) => candidate.workflowKey === settings.workflowKey && candidate.active) : undefined;
    return { enabled: Boolean(settings?.enabled && binding), requireUploadConsent: settings?.requireUploadConsent ?? true, maxFileBytes: Math.min(settings?.maxFileBytes ?? MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES), maxFilesPerRequest: settings?.maxFilesPerRequest ?? 1, maxPdfPages: settings?.maxPdfPages ?? 20, allowedMimeTypes: settings?.allowedMimeTypes ?? [], policies: policies.filter((policy) => policy.enabled && policy.allowUserInitiated).map((policy) => ({ intentKey: policy.intentKey, requestMode: policy.requestMode, allowedDocumentTypes: policy.allowedDocumentTypes, consentRequired: policy.consentRequired })), workflowKey: settings?.workflowKey ?? null, binding: binding ? { webhookPath: binding.webhookPath, payloadContract: binding.payloadContract } : null };
  };
  const protectedApi = authMiddleware(auth);
  const optionalApi = authMiddleware(auth, false);
  const staticChannelAuth: StaticChannelAuth | undefined = staticChannelApiKey
    ? { apiKey: staticChannelApiKey, channel: staticChannelName, ...(staticChannelTenantId ? { tenantId: staticChannelTenantId } : { tenantSlug: staticChannelTenantSlug! }) }
    : undefined;
  const channelApi = channelAuthMiddleware(store, channelVault, staticChannelAuth);
  const chatApi = (req: Request, res: Response, next: NextFunction): void => {
    optionalApi(req, res, () => {
      if (getAuth(req)) { next(); return; }
      void channelApi(req, res, next).catch(next);
    });
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
    modelConfigured: Boolean(dependencies.model),
    embeddingConfigured: Boolean(dependencies.embedding),
  });

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
      const input = parse(z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid() }), req.body);
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
      const extractedText = document.storeExtractedText && input.extractedText ? maskPiiForSession(session, input.extractedText, tokenVault) : null;
      const summary = input.summary ? maskPiiForSession(session, input.summary, tokenVault) : null;
      const completedDocument = await store.updateSupportingDocument({ ...document, status: 'completed', extractedText, summary, errorCode: null, updatedAt: new Date().toISOString() });
      const completedJob = await store.updateDocumentProcessingJob({ ...job, status: 'completed', leaseExpiresAt: null, executionReference: input.executionReference ?? job.executionReference, updatedAt: new Date().toISOString() });
      if (document.leadId) { const lead = await store.getCrmLead(document.leadId, input.tenantId); if (lead) { const documents = await store.listSupportingDocuments(lead.tenantId, undefined, lead.id); const composed = [lead.summary, composeDocumentSummary(lead, documents)].filter(Boolean).join('\n').slice(0, 20_000); await store.updateCrmLeadSummary(lead.id, lead.tenantId, composed, 'completed'); } }
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: 'document.completed', metadata: { documentId: document.id, jobId: job.id, status: 'completed' }, createdAt: new Date().toISOString() });
      res.json({ document: publicDocument(completedDocument), job: completedJob });
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
      res.status(201).json({ sessionId: session.id, tenantId: tenant.id, createdAt: session.createdAt });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/messages', chatApi, async (req, res, next) => {
    let pendingMessage: Message | null = null;
    try {
      const input = parse(messageSchema, req.body);
      const inputText = (input.type === 'postback' ? input.postbackValue ?? input.message : input.message) ?? '';
      const channel = getChannel(req);
      const session = await store.getSession(input.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      enforcePublicChatEnabled(req, tenant);
      if ((channel && channel.tenantId !== session.tenantId) || (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin')) throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
      // Allocate input tokens against the session so assistant persona names cannot collide with visitor PII.
      const masked = { masked: maskPiiForSession(session, inputText, tokenVault) };
      const messageHash = contentHash(masked.masked);
      const responseCacheKey = cacheKey('chat-response', session.tenantId, session.id, contentHash(input.clientMessageId));
      const cachedEntry = await cache.get<{ messageHash?: unknown; response?: Record<string, unknown> }>(responseCacheKey);
      if (cachedEntry?.response && typeof cachedEntry.response.answer === 'string') {
        if (cachedEntry.messageHash !== messageHash) throw new HttpError(409, 'MESSAGE_ID_REUSED', 'clientMessageId is already bound to different message content. Generate a new clientMessageId for each new turn.');
        res.json(rehydrateStoredResponse(session, cachedEntry.response)); return;
      }
      const durableDuplicate = await store.getMessageByClientId(session.id, input.clientMessageId);
      const retryableDuplicate = durableDuplicate?.response?.retryable === true;
      if (durableDuplicate && durableDuplicate.maskedContent !== masked.masked) throw new HttpError(409, 'MESSAGE_ID_REUSED', 'clientMessageId is already bound to different message content. Generate a new clientMessageId for each new turn.');
      if (durableDuplicate?.response && !retryableDuplicate) { res.json(rehydrateStoredResponse(session, durableDuplicate.response)); return; }
      if (durableDuplicate && !retryableDuplicate) throw new HttpError(409, 'MESSAGE_IN_PROGRESS', 'A request with this client message ID is already being processed.');
      session.lastActivityAt = new Date().toISOString();
      await updateSessionSafely(session, false);
      let userMessage = durableDuplicate ?? await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: session.tenantId, role: 'user', maskedContent: masked.masked, citations: [], clientMessageId: input.clientMessageId, response: null, createdAt: new Date().toISOString() });
      pendingMessage = userMessage;
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
      const contextWindowMessages = persona?.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES;
      const modelContextWindow = Math.min(Math.max(contextWindowMessages, 2), 8);
      let evidence: ModelEvidence[] = [];
      let draft: ModelDraft;
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
      const reopeningIntentKey = publishedCatalog && /^(?:i|we)\s+(?:want|need|would\s+like|am\s+looking|need\s+help)\b/iu.test(masked.masked)
        ? Object.entries(state.intentProgress?.entries ?? {}).find(([intentKey, entry]) => entry.status === 'fulfilled' && publishedCatalog.catalog.signals.some((signal) => signal.intentKey === intentKey && signal.signalType === 'phrase' && signal.value && masked.masked.toLocaleLowerCase('en-US').includes(signal.value.toLocaleLowerCase('en-US'))))?.[0] ?? null
        : null;
      const reopeningOpportunity = Boolean(reopeningIntentKey);
      const currentOpportunityId = state.intentProgress?.entries[activeIntentForTurn ?? '']?.journeyId ?? null;
      const actionMatchesOpportunity = (action: ActionRequest): boolean => currentOpportunityId
        ? action.opportunityId === currentOpportunityId
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
      const pendingSlotKey = state.pendingPrompt?.slotKey
        ?? (postCaptureSlotRequirement?.requirementType === 'slot' ? postCaptureSlotRequirement.slotKey : null)
        ?? lastCatalogAssistant?.response?.catalogSlotKey;
      const pendingSlotIntent = pendingCatalogIntent ?? (postCaptureFollowUp ? activeCatalogIntent : null);
      const pendingSlot = publishedCatalog && pendingSlotIntent && typeof pendingSlotKey === 'string' ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === pendingSlotIntent && slot.slotKey === pendingSlotKey) : null;
      const pendingConsentSlot = pendingSlot?.validationRule === 'boolean:explicit_opt_in' || pendingSlot?.slotKey === 'contact_consent';
      const pendingNameIsIntentPhrase = pendingSlot?.slotKey === 'name' && publishedCatalog
        ? publishedCatalog.catalog.signals.some((signal) => signal.intentKey === pendingSlotIntent && signal.signalType === 'phrase' && signal.value && masked.masked.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').includes(signal.value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()))
        : false;
      const pendingContactKind = pendingSlot?.alternativeGroup === 'contact' ? masked.masked.match(/\[(EMAIL|PHONE)_\d+\]/u)?.[1] ?? null : null;
      const pendingTextRedirected = Boolean(pendingSlot && publishedCatalog && /^text:/u.test(pendingSlot.validationRule) && publishedCatalog.catalog.slots.some((slot) => slot.intentKey === pendingSlotIntent && slot.slotKey !== pendingSlot.slotKey && messageMentionsCatalogSlot(slot, inputText)));
      const pendingValue = pendingSlot && !pendingConsentSlot && !knowledgeQuestion && !pendingNameIsIntentPhrase && !pendingTextRedirected ? pendingCatalogSlotValue(pendingContactKind ? `token:${pendingContactKind}` : pendingSlot.validationRule, inputText, masked.masked, session, tokenVault) : null;
      const pendingConsentValue = state.pendingPrompt?.type === 'consent' && (!pendingSlot || pendingConsentSlot) && !knowledgeQuestion && (!activeFollowUpOffer || promptScopedReply)
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
      const inferredCatalogIntentKey = currentCatalogResolution?.intentKey ?? (postCaptureFollowUp ? activeCatalogIntent : null);
      const inferredCatalogValueData = (Boolean(state.selectedIntentKey) || !publishedCatalog?.catalog.journeyRequirements?.length) && !knowledgeQuestion && !conversational && inferredCatalogIntentKey && !pendingValue
        ? (() => {
          const inferred: Record<string, string> = {};
          const isIntentPhrase = publishedCatalog?.catalog.signals.some((signal) => {
            if (signal.intentKey !== inferredCatalogIntentKey || signal.signalType !== 'phrase' || !signal.value) return false;
            const phrase = normalizeConversationQuery(signal.value).toLocaleLowerCase('en-US');
            const message = deterministicMessage.toLocaleLowerCase('en-US');
            return message.includes(phrase) && message.length <= phrase.length + 16;
          }) ?? false;
          for (const slot of publishedCatalog?.catalog.slots.filter((candidate) => candidate.intentKey === inferredCatalogIntentKey && candidate.slotKey !== pendingSlot?.slotKey && !candidate.validationRule.startsWith('token:') && candidate.validationRule !== 'boolean:explicit_opt_in') ?? []) {
            if (isIntentPhrase && slot.validationRule.startsWith('text:')) continue;
            if (!messageMentionsCatalogSlot(slot, inputText)) continue;
            const value = pendingCatalogSlotValue(slot.validationRule, inputText, maskedMessage, session, tokenVault);
            if (value) inferred[slot.slotKey] = value;
          }
          const interestSlot = publishedCatalog?.catalog.slots.find((slot) => slot.intentKey === inferredCatalogIntentKey && slot.validationRule.startsWith('text:') && slot.required && !pendingCatalogValues[slot.slotKey]);
          if (interestSlot && interestSlot.slotKey !== pendingSlot?.slotKey && !isIntentPhrase && maskedMessage.trim().length >= 12) inferred[interestSlot.slotKey] = maskedMessage.trim();
          return inferred;
        })()
        : {};
      const currentLeadData = mergeLeadData(pendingCatalogValues as LeadData, extractLeadData(maskedMessage), pendingValueData);
      const currentCatalogSlotValues: Record<string, string> = { ...baseCatalogSlotValues, ...inferredCatalogValueData };
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
        /\b(?:steps?|process|procedure|how)\b/i.test(maskedMessage) ? 'setup procedure steps' : '',
        /\b(?:package|packages|price|prices|cost|costs|fee|fees)\b/i.test(maskedMessage) ? 'package pricing fees' : '',
        ...(acceptedOfferOption?.retrievalHints ?? []),
      ].filter(Boolean).slice(0, 8) : [];
      const knowledgeSlotContext = knowledgeQuestion && publishedCatalog && state.selectedIntentKey
        ? publishedCatalog.catalog.slots
          .filter((slot) => slot.intentKey === state.selectedIntentKey && !/(?:pii|contact|consent)/iu.test(slot.retentionClass) && !/(?:^|[._-])(?:name|email|phone|mobile|contact)(?:$|[._-])/iu.test(slot.slotKey))
          .map((slot) => currentCatalogSlotValues[slot.slotKey] ? `${slot.slotKey}=${currentCatalogSlotValues[slot.slotKey]}` : '')
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
        ? [acceptedOfferOption && activeFollowUpOffer ? activeFollowUpOffer.sourceQuery : normalizedMessage, acceptedOfferOption?.label ?? '', ...knowledgeQueryHints, knowledgeIntentLabel, ...knowledgeSlotContext].filter(Boolean).join('\n').slice(0, 2_000)
        : retrievalQuery;
      const textSearchTerms = [knowledgeRetrievalQuery, ...knowledgeQueryHints].join(' ').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{4,}/gu) ?? [];
      const retrievalTextQuery = [...new Set(textSearchTerms.filter((term) => !['about', 'all', 'are', 'does', 'have', 'how', 'please', 'tell', 'that', 'the', 'this', 'what', 'which', 'with', 'your'].includes(term)))].slice(0, 40).join(' | ');
      const intentContextQuery = [normalizedMessage, ...intentContext].join('\n');
      const leadData = mergeLeadData(pendingCatalogValues as LeadData, currentLeadData);
      const catalogSlotValues: Record<string, string> = { ...pendingCatalogValues, ...(extractLeadData(maskedMessage) as Record<string, string>), ...inferredCatalogValueData, ...pendingCatalogValueData };
      const pendingTransitionPrompt = state.pendingPrompt?.type === 'confirmation' && state.pendingPrompt.requirementKey?.startsWith('transition:') ? state.pendingPrompt : null;
      const transitionApproval = Boolean(pendingTransitionPrompt?.intentKey && !knowledgeQuestion && !offerReplyOwnsTurn && /^(?:yes|yeah|yep|sure|okay|ok|confirm|confirmed|approve|approved|proceed|go ahead)\b/iu.test(maskedMessage));
      const transitionDenied = Boolean(pendingTransitionPrompt && !knowledgeQuestion && /^(?:no|nope|not now|later|decline|reject|stop)\b/iu.test(maskedMessage));
      const intentContinuity = publishedCatalog && !offerOwnsConversationState ? resolveIntentContinuity(publishedCatalog, { currentText: normalizedMessage, contextText: intentContextQuery, slotValues: catalogSlotValues, selectedIntentKey: transitionDenied ? state.selectedIntentKey : state.activeFollowUpIntentKey ?? state.selectedIntentKey, pendingPromptType: state.pendingPrompt?.type ?? null }) : null;
      let catalogResolution = intentContinuity?.primary ?? null;
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
      const distinctIntent = Boolean(distinctIntentKey && (!pendingValue || explicitIntentSwitch));
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
          currentIntentKey: transitionApproval ? pendingTransitionPrompt?.intentKey ?? journeyCurrentIntentKey : journeyCurrentIntentKey,
          selectedIntentKey: transitionApproval ? pendingTransitionPrompt?.intentKey ?? journeyResolvedIntentKey ?? null : transitionDenied ? state.selectedIntentKey ?? state.intentProgress?.activeIntentKey ?? null : journeyResolvedIntentKey ?? state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey ?? null,
          transitionApproval,
          newOpportunity: reopeningOpportunity && journeyResolvedIntentKey === reopeningIntentKey,
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
      const journeySlotKey = journeyRequirement && ['slot', 'consent'].includes(journeyRequirement.requirementType) ? journeyRequirement.slotKey : null;
      const currentIntentKey = intentContinuity && ['matched', 'missing_slots'].includes(intentContinuity.current.reason) ? intentContinuity.current.intentKey : null;
      const detectedSecondaryIntentKey = currentIntentKey && currentIntentKey !== state.selectedIntentKey ? currentIntentKey : null;
      const slotCorrectionPrefix = /^(?:actually|my|our|the|now|still|please keep|update|change|i have|we have)\b/iu;
      const structuredSlotCorrection = Boolean(publishedCatalog?.catalog.slots.some((slot) => {
        const terms = slot.slotKey.split(/[._-]+/u).filter((term) => term.length >= 4);
        return terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'iu').test(maskedMessage)) && slotCorrectionPrefix.test(maskedMessage);
      }));
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
       if (!languageAllowed && !conversational) draft = { answer: permittedLanguageReply(language, persona?.permittedLanguages ?? []), citationIds: [], proposedIntent: null };
       else if (offerNeedsClarification && activeFollowUpOffer) draft = await composeGuidedDraft({ answer: `Which would you like to explore: ${activeFollowUpOffer.options.map((option) => option.label).join(' or ')}?`, citationIds: [], proposedIntent: null }, 'offer_clarification');
       else if (!postCaptureFollowUp && !knowledgeQuestion && catalogResolution?.ambiguous) draft = await composeGuidedDraft({ answer: 'I can help with that. Could you tell me a little more about what you need?', citationIds: [], proposedIntent: null }, 'intent_clarification');
       else if (!postCaptureFollowUp && !knowledgeQuestion && publishedCatalog && catalogResolution?.intentKey && catalogResolution.reason === 'below_threshold') draft = await composeGuidedDraft({ answer: catalogIntentClarification(publishedCatalog, catalogResolution.intentKey), citationIds: [], proposedIntent: null }, 'intent_clarification');
       else if (!postCaptureFollowUp && !knowledgeQuestion && publishedCatalog && catalogResolution?.intentKey && catalogResolution.reason === 'intent_inactive') draft = { answer: 'I can note that request, but the matching workflow is not currently enabled.', citationIds: [], proposedIntent: null };
      else if (conversational && intent === 'farewell') draft = { answer: conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else if (!postCaptureFollowUp && conversational && intent !== 'greeting' && !pendingValue && !acceptedOfferOption) draft = { answer: conversationalReply(intent ?? 'acknowledgement', persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else if (!postCaptureFollowUp && !knowledgeQuestion && consentDenied && isContactWorkflow) draft = { answer: 'Understood. I will not register or share your contact details without consent. I can still answer your questions.', citationIds: [], proposedIntent: null };
        else if (crmContactMissing) draft = await composeGuidedDraft({ answer: leadCollectionReply(leadData, crmContactMissing), citationIds: [], proposedIntent: null }, 'slot_collection', crmContactMissing);
        else if (consentActionReady) draft = await composeGuidedDraft({ answer: 'I have the details needed. Please approve the consent action below to register your request.', citationIds: [], proposedIntent: catalogResolution?.intentKey ?? null }, 'consent');
        else if (!knowledgeQuestion && journeyDocumentAwaiting) draft = await composeGuidedDraft({ answer: 'I’ve received the requested document and it is being reviewed. While that is checked, what else would you like to clarify about your setup?', citationIds: [], proposedIntent: null }, 'document_processing');
        else if (!knowledgeQuestion && journeyOfferPending) draft = await composeGuidedDraft({ answer: `Would you like to continue with ${journeyOfferLabel ?? 'the related request'} as well?`, citationIds: [], proposedIntent: null }, 'confirmation');
        else if (!knowledgeQuestion && journeyConfirmationPending) draft = await composeGuidedDraft({ answer: `Before I continue, could you confirm ${journeyConfirmationLabel ?? 'this requirement'}?`, citationIds: [], proposedIntent: null }, 'confirmation');
        else if (!knowledgeQuestion && journeyDocumentPending) draft = await composeGuidedDraft({ answer: 'To continue, could you share the requested document?', citationIds: [], proposedIntent: null }, 'document_collection');
        else if (postCaptureFollowUp && catalogSlotNonAnswer) draft = await composeGuidedDraft({ answer: 'Thanks, I’ve noted that from earlier. If anything has changed, tell me what to update; otherwise we can continue with the remaining details?', citationIds: [], proposedIntent: null }, 'follow_up', journeySlotKey);
        else if (!knowledgeQuestion && journeyRequirement && journeySlotKey && publishedCatalog) draft = await composeGuidedDraft({ answer: catalogSlotQuestion(publishedCatalog, journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? '', journeySlotKey, catalogSlotValues), citationIds: [], proposedIntent: null }, 'slot_collection', journeySlotKey);
        else if (!postCaptureFollowUp && !knowledgeQuestion && publishedCatalog && catalogResolution?.intentKey && catalogResolution.missingSlots.length > 0) draft = await composeGuidedDraft({ answer: catalogSlotQuestion(publishedCatalog, catalogResolution.intentKey, catalogResolution.missingSlots[0] ?? '', catalogSlotValues), citationIds: [], proposedIntent: null }, 'slot_collection', catalogResolution.missingSlots[0] ?? null);
       else if (!postCaptureFollowUp && leadIntent && !catalogSlotsReady) draft = await composeGuidedDraft({ answer: leadCollectionReply(leadData), citationIds: [], proposedIntent: null }, 'slot_collection', invalidLeadField);
       else if (!postCaptureFollowUp && ((leadIntent && validatedLeadReady) || (catalogResolution?.actionAllowed && (!isContactWorkflow || validatedLeadReady)))) draft = await composeGuidedDraft({ answer: leadCollectionReply(leadData), citationIds: [], proposedIntent: catalogResolution?.intentKey ?? 'lead.capture' }, 'consent');
      else if (!postCaptureFollowUp && conversational && intent === 'identity') draft = { answer: conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else {
        let queryEmbedding: number[];
        try { queryEmbedding = await embedding.embed(knowledgeRetrievalQuery); } catch { throw new HttpError(503, 'EMBEDDING_UNAVAILABLE', 'The assistant is currently unable to search approved knowledge.'); }
        const rows = await store.searchSearchableChunks(session.tenantId, internal ? 'internal' : 'public', queryEmbedding, 24, retrievalTextQuery);
        const ranked = rankChunksWithVector(knowledgeRetrievalQuery, rows, queryEmbedding, 4);
        evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: presentKnowledgeText(chunk.content) })).filter((item) => item.content.length > 0);
        if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null };
        else if (!postCaptureFollowUp && conversational && evidence.length === 0) draft = { answer: intent === 'greeting' && language !== 'ar' ? openingGreeting(persona?.greeting, persona?.name ?? 'Sales assistant') : conversationalReply(intent ?? 'identity', persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
        else try {
          const documents = postCaptureFollowUp ? await store.listSupportingDocuments(session.tenantId, session.id) : [];
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
          };
          const modelInput = { maskedMessage, evidence, personaName: persona?.name ?? 'Sales assistant', ownerName: tenant.name, conversation, followUpContext };
          draft = await model.draft(persona ? { ...modelInput, persona } : modelInput);
        } catch {
          if (knowledgeQuestion && evidence.length === 0) draft = { answer: naturalAbstention(language), citationIds: [], proposedIntent: null };
          else throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The assistant is currently unable to verify an answer.');
        }
      }
      if (!knowledgeQuestion && journeyRequirement && journeySlotKey && publishedCatalog && !consentDenied && !catalogSlotNonAnswer && !isGuidedResponse(draft.answer, 'slot_collection', journeySlotKey)) draft = { answer: catalogSlotQuestion(publishedCatalog, journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? '', journeySlotKey, catalogSlotValues), citationIds: [], proposedIntent: null };
      try { assertKnownTokens(session, draft.answer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      const citations = validateCitations(draft, evidence);
      const casualFallback = conversational && (evidence.length === 0 || intent === 'identity');
      const continuityAnswer = continuityTurn && isSafeContinuityAnswer(draft.answer, citations);
      const grounded = !casualFallback && !leadCollection && evidence.length > 0 && hasSufficientEvidence(draft.answer, evidence, citations);
      const continuityFallback = continuityTurn && !continuityAnswer;
      const safeGrounded = grounded && !continuityFallback;
      const safeCitations = safeGrounded ? citations : [];
      const offerClarificationAnswer = offerNeedsClarification && Boolean(activeFollowUpOffer);
      const leadAnswer = !postCaptureFollowUp && !knowledgeQuestion && (leadCollection || (leadIntent && validatedLeadReady) || consentActionReady || catalogClarification || Boolean(catalogResolution?.actionAllowed)) || journeyDocumentPending || journeyDocumentAwaiting || journeyConfirmationPending || journeyOfferPending || Boolean(!knowledgeQuestion && journeyRequirement && journeySlotKey);
       const answer = !languageAllowed ? draft.answer : casualFallback || leadAnswer || continuityAnswer ? draft.answer : grounded ? draft.answer : naturalAbstention(language);
      let safeAnswer = casualFallback || leadAnswer || continuityAnswer || offerClarificationAnswer ? draft.answer : continuityTurn ? conversationalReply('acknowledgement', persona?.name ?? 'Sales assistant', language, tenant.name) : answer;
      if (intent === 'farewell') session.closedAt = new Date().toISOString();
      const nextMissingSlot = crmContactMissing ?? journeySlotKey ?? catalogResolution?.missingSlots[0] ?? null;
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
          ? prompt(consentActionReady ? 'consent' : 'slot', journeyResult?.activeIntentKey ?? catalogResolution?.intentKey ?? pendingCatalogIntent ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey, nextMissingSlot, journeyRequirement?.requirementKey ?? null)
          : consentActionReady ? prompt('consent', catalogResolution?.intentKey ?? journeyResult?.activeIntentKey ?? state.selectedIntentKey, null, journeyRequirement?.requirementKey ?? null)
            : catalogResolution?.actionAllowed && !consentDenied && !journeyOfferPending && !declinedTransitionHold ? prompt('confirmation', catalogResolution.intentKey, null) : null;
      state.catalogVersionId = catalogResolution?.catalogVersionId ?? state.catalogVersionId;
      if (journeyResult && !offerOwnsConversationState) state.intentProgress = journeyResult.progress;
      if (!offerOwnsConversationState) {
        state.selectedIntentKey = transitionApproval ? journeyResult?.activeIntentKey ?? pendingTransitionPrompt?.intentKey ?? state.selectedIntentKey : postCaptureFollowUp || knowledgeOnlyTurn || journeyOfferPending ? state.selectedIntentKey : catalogResolution?.intentKey ?? state.selectedIntentKey;
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
      const previousSlotValues = state.slotValues ?? {};
      state.slotValues = catalogSlotValues;
      state.slotProvenance = { ...(state.slotProvenance ?? {}) };
      const changedVisitorSlots = new Set([...Object.keys(extractLeadData(maskedMessage)), ...Object.keys(inferredCatalogValueData), ...Object.keys(pendingCatalogValueData)]);
      for (const slotKey of changedVisitorSlots) {
        const value = catalogSlotValues[slotKey];
        if (value) state.slotProvenance[slotKey] = { source: 'visitor', messageSequence: state.messageSequence + 1, capturedAt: new Date().toISOString(), corrected: Boolean(previousSlotValues[slotKey] && previousSlotValues[slotKey] !== value) };
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
      const untrackedKnowledgeOffer = safeGrounded && !activeFollowUpOffer && !crmContactMissing && !consentActionReady && !journeyRequirement && !journeyOfferPending && !journeyConfirmationPending && !journeyDocumentPending && !journeyDocumentAwaiting && !catalogClarification && presentsUntrackedOffer(safeAnswer) && validFollowUpOptions.length === 0;
      if (untrackedKnowledgeOffer) {
        // Do not show a yes/no or multi-choice question that has no persisted state.
        const safeFallback = 'I can help with the next step. What would you like to focus on first?';
        const composedContinuation = await composeGuidedDraft({ answer: safeFallback, citationIds: [], proposedIntent: null }, 'intent_clarification');
        safeAnswer = presentsUntrackedOffer(composedContinuation.answer) ? safeFallback : composedContinuation.answer;
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
      state.contactConsent = nextContactConsent;
      state.summaryRevision += 1;
      state.messageSequence += 1;
      state.lastTurnAt = userMessage.createdAt;
      if (!offerOwnsConversationState) state.phase = endedConversation || knowledgeOnlyTurn ? state.phase : journeyDocumentPending ? 'DOCUMENT_COLLECTION' : journeyRequirement?.requirementType === 'slot' ? 'SLOT_COLLECTION' : postCaptureFollowUp ? state.phase : phaseFor({ intentKey: catalogResolution?.intentKey ?? pendingCatalogIntent, missingSlot: nextMissingSlot, consentPending: consentActionReady, actionPending: Boolean(catalogResolution?.actionAllowed && !consentDenied) });
      state.rollingSummary = composeConversationSummary(state, maskedMessage).slice(-4000);
      session.conversationState = state;
      await updateSessionSafely(session, true);
      const collectedSlotValues = Object.fromEntries(Object.entries(catalogSlotValues).filter(([key]) => !['name', 'email', 'phone', 'contact_consent'].includes(key)));
      const actionLeadData = { ...leadData, ...(Object.keys(collectedSlotValues).length ? { slotValues: collectedSlotValues } : {}), ...(catalogResolution?.interest ? { interest: catalogResolution.interest } : {}), ...(consentActionReady ? { contactConsent: false } : catalogSlotValues.contact_consent === 'true' ? { contactConsent: true } : !catalogResolution ? { contactConsent: false } : {}) };
      const actionAlreadySubmitted = Boolean(pendingConsentAction && ['approved', 'processing', 'completed'].includes(pendingConsentAction.state));
      const resumableAction = !reopeningOpportunity && catalogResolution?.intentKey ? sessionActions.find((candidate) => candidate.state === 'awaiting_customer' && candidate.catalogVersionId === catalogResolution.catalogVersionId && candidate.intentKey === catalogResolution.intentKey && actionMatchesOpportunity(candidate) && candidate.payload.contactConsent === true) : null;
      const shouldResumeAction = Boolean(resumableAction && state.contactConsent === 'granted' && !consentDenied && !crmContactMissing && !journeyRequirement?.required && catalogSlotsReady && catalogResolution?.actionAllowed);
      const resumedAction = shouldResumeAction && resumableAction ? await store.approveAction({ ...resumableAction, state: 'approved', payload: { ...resumableAction.payload, ...actionLeadData }, result: null }) : null;
      if (resumedAction) {
        state.workflowStatus = 'queued';
        state.phase = 'QUEUED';
        state.pendingPrompt = null;
        session.conversationState = state;
        await updateSessionSafely(session, true);
      }
      const opportunityIntentKey = journeyResult?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.intentProgress?.activeIntentKey ?? state.selectedIntentKey ?? '';
      const opportunityIdForAction = state.intentProgress?.entries[opportunityIntentKey]?.journeyId ?? currentOpportunityId;
      const actionKeyForProposal = catalogResolution?.intentKey ?? catalogResolution?.workflowKey ?? 'lead.capture';
      const priorRevisions = opportunityIdForAction ? sessionActions.filter((candidate) => candidate.opportunityId === opportunityIdForAction && (candidate.actionKey ?? candidate.intentKey ?? candidate.workflowKey) === actionKeyForProposal).map((candidate) => candidate.actionRevision ?? 1) : [];
      const actionRevisionForProposal = priorRevisions.length ? Math.max(...priorRevisions) + 1 : 1;
      const intentActionAlreadySubmitted = Boolean(catalogResolution?.intentKey && sessionActions.some((candidate) => actionMatchesOpportunity(candidate) && (candidate.intentKey ?? candidate.workflowKey) === catalogResolution.intentKey && ['awaiting_confirmation', 'awaiting_customer', 'approved', 'processing', 'completed'].includes(candidate.state)));
      const sameWorkflowOpportunityExists = Boolean(opportunityIdForAction && catalogResolution?.workflowKey && sessionActions.some((candidate) => candidate.opportunityId === opportunityIdForAction && candidate.workflowKey === catalogResolution.workflowKey && ['awaiting_confirmation', 'awaiting_customer', 'approved', 'processing', 'completed'].includes(candidate.state)));
      const shouldProposeAction = !resumedAction && !sameWorkflowOpportunityExists && !postCaptureFollowUp && !knowledgeQuestion && !offerReplyOwnsTurn && !journeyOfferPending && !transitionDenied && !declinedTransitionHold && (catalogResolution ? catalogSlotsReady && !intentActionAlreadySubmitted && !actionAlreadySubmitted && !consentDenied && !crmContactMissing && (catalogResolution.actionAllowed || consentActionReady) : draft.proposedIntent === 'lead.capture' && leadIntent && validatedLeadReady);
      const action = resumedAction ?? (shouldProposeAction ? await gateway.propose(session.tenantId, session.id, input.clientMessageId, actionLeadData, catalogResolution ? { workflowKey: catalogResolution.workflowKey ?? 'lead.capture', intentKey: catalogResolution.intentKey ?? 'lead.capture', actionKey: actionKeyForProposal, actionRevision: actionRevisionForProposal, opportunityId: opportunityIdForAction, intentScore: catalogResolution.score, intentConfidence: catalogResolution.confidence, catalogVersionId: catalogResolution.catalogVersionId, webhookPath: publishedCatalog?.catalog.workflowBindings.find((binding) => binding.workflowKey === catalogResolution.workflowKey)?.webhookPath ?? 'lead-capture' } : undefined) : null);
      const awaitingConfirmationAction = sessionActions.find((candidate) => candidate.state === 'awaiting_confirmation'
        && candidate.payload.contactConsent !== true
        && !consentDenied
        && (publishedCatalog
          ? candidate.catalogVersionId === publishedCatalog.id && candidate.intentKey === (pendingCatalogIntent ?? state.pendingPrompt?.intentKey) && actionMatchesOpportunity(candidate)
          : !candidate.catalogVersionId));
      const actionForResponse = action ?? ((!offerReplyOwnsTurn && (knowledgeQuestion || state.pendingPrompt?.type === 'consent' || awaitingConfirmationAction)) ? awaitingConfirmationAction ?? null : null);
      const finalAnswer = resumedAction ? 'Thanks — I have the remaining details and your request is back in processing.' : safeAnswer;
      const finalMaskedAnswer = resumedAction ? maskPiiForSession(session, finalAnswer, tokenVault) : maskedAnswer;
      const pendingCatalogState = publishedCatalog && (catalogResolution?.intentKey || journeyResult?.activeIntentKey) && (catalogResolution?.missingSlots.length || nextPrompt || journeyDocumentPending) ? { catalogIntentKey: catalogResolution?.intentKey ?? journeyResult?.activeIntentKey ?? null, catalogVersionId: catalogResolution?.catalogVersionId ?? publishedCatalog.id, catalogOpportunityId: opportunityIdForAction, catalogSlotKey: nextPrompt && (nextPrompt.type === 'slot' || nextPrompt.type === 'consent') ? nextMissingSlot : null, catalogRequirementKey: nextPrompt?.requirementKey ?? journeyRequirement?.requirementKey ?? null, catalogSlotValues, pendingPromptId: nextPrompt?.id ?? null } : null;
      const response = { messageId: responseMessageId, sessionId: session.id, answer: rehydrateForSession(session, finalMaskedAnswer, tokenVault), grounded: safeGrounded, conversational: casualFallback || leadCollection || catalogClarification || continuityAnswer || continuityTurn || offerClarificationAnswer || endedConversation, citations: safeCitations, actionProposal: actionForResponse && !resumedAction ? { id: actionForResponse.id, intent: actionForResponse.workflowKey, consentRequired: actionForResponse.payload.contactConsent !== true, confirmation: actionForResponse.payload.contactConsent !== true ? 'I consent to the use of my contact details to register this request.' : 'Your contact request is ready to submit.', expiresAt: new Date(Date.parse(actionForResponse.createdAt) + 15 * 60_000).toISOString() } : null, pendingPromptId: nextPrompt?.id ?? null, pendingRequirementKey: nextPrompt?.requirementKey ?? null, requestId: (req as AuthedRequest).requestId ?? randomUUID() };
      const persistedResponse = { ...response, answer: finalMaskedAnswer };
      const estimatedInputTokens = estimateTokens([maskedMessage, ...evidence.map((item) => item.content), persona?.name ?? '', persona?.personality ?? '', persona?.tone ?? '', persona?.speakingStyle ?? ''].join('\n'));
      const estimatedOutputTokens = estimateTokens(finalMaskedAnswer);
      await store.addMessage({ id: response.messageId, sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: finalMaskedAnswer, citations: safeCitations, clientMessageId: null, response: { conversational, ...(pendingCatalogState ?? {}) }, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: persistedResponse });
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
      await activeTenant(store, action.tenantId);
      if (session.conversationState?.contactConsent === 'denied' && action.payload.contactConsent !== true) throw new HttpError(422, 'CONSENT_DECLINED', 'The contact request was declined.');
      if (action.catalogVersionId && action.payload.contactConsent === false
        && (session.conversationState?.pendingPrompt?.type !== 'consent'
          || session.conversationState.pendingPrompt.intentKey !== action.intentKey
          || session.conversationState.catalogVersionId !== action.catalogVersionId)) {
        throw new HttpError(422, 'CONSENT_PROMPT_REQUIRED', 'Consent must be given for the active, purpose-scoped request.');
      }
      if (action.state === 'failed') throw new HttpError(409, 'ACTION_NOT_ACCEPTED', 'This request is no longer confirmable. Please start a new request.');
      const confirmedState = session.conversationState ?? newConversationState();
      const consentGranted = action.payload.contactConsent === true || action.payload.contactConsent === false;
      const sessionForApproval: Session = { ...session, lastActivityAt: new Date().toISOString(), tokenMap: new Map(session.tokenMap), conversationState: { ...confirmedState, ...(consentGranted ? { contactConsent: 'granted' as const, consentCapturedAt: new Date().toISOString(), consentVersion: consentVersionForState({ catalogVersionId: action.catalogVersionId ?? confirmedState.catalogVersionId, selectedIntentKey: action.intentKey ?? confirmedState.selectedIntentKey }) } : {}), workflowStatus: 'queued', phase: 'QUEUED', pendingPrompt: null } };
      const confirmed = await gateway.confirm(action.id, action.tenantId, sessionForApproval);
      if (!['approved', 'processing', 'completed'].includes(confirmed.state)) throw new HttpError(409, 'ACTION_NOT_ACCEPTED', 'This request was not accepted. Please start a new request.');
      Object.assign(session, sessionForApproval);
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
        tenantId: z.string().uuid(), sessionId: z.string().uuid(),
        actionId: z.string().uuid(),
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
  app.post('/api/v1/internal/workflow-events/complete', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(workflowCompletionSchema, req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(403, 'WORKFLOW_FORBIDDEN', 'Workflow completion does not match the authorized action.');
      const updated = await transitionWorkflowAction(action, input.state, input.externalReference, null, input.executionReference, input.eventId, input.correlationId, input.attempt);
      res.json({ action: updated });
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
        if (input.completeAction && action.state !== 'completed') await store.updateAction({ ...action, state: 'completed', result: { externalReference: `crm-lead-${existing.id}` } });
        res.json({ lead: existing, externalReference: `crm-lead-${existing.id}` }); return;
      }
      const lead: CrmLead = { id: randomUUID(), tenantId: input.tenantId, actionId: input.actionId, sessionId: input.sessionId, intent: authorizedIntent, secondaryIntentKeys: (session.conversationState?.candidateIntentKeys ?? []).filter((key) => key !== authorizedIntent), intentScore: action.intentScore ?? 0, intentConfidence: action.intentConfidence ?? 0, catalogVersionId: action.catalogVersionId ?? null, score, contactCompletenessScore: contactCompletenessScore({ validName, validEmail: Boolean(rehydratedEmail && isValidLeadEmail(rehydratedEmail)), validPhone: Boolean(rehydratedPhone && isValidLeadPhone(rehydratedPhone)) }), validationPass, leadData, conversation, summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const created = await store.upsertCrmLead(lead, crmDedupeKey(input.tenantId, leadData, session, tokenVault, vaultSecret));
      await store.linkSessionDocuments(created.sessionId, created.tenantId, created.id);
      if (input.completeAction) await store.updateAction({ ...action, state: 'completed', result: { externalReference: `crm-lead-${created.id}` } });
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
      const updated = scored ? await store.updateCrmLeadSummary(scored.id, input.tenantId, composed, 'completed') : null;
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
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
      if (lead.actionId !== input.actionId || lead.leadId || lead.remoteCrm) throw new HttpError(409, 'LEAD_ALREADY_LINKED', 'This lead is already linked to a remote CRM or the action does not match.');
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
  app.post('/api/v1/internal/n8n/callback', async (req, res, next) => {
    try {
      if (!n8nCallbackSecret) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      const timestamp = req.header('x-agentic-timestamp') ?? '';
      const nonce = req.header('x-agentic-nonce') ?? '';
      const signature = req.header('x-agentic-signature') ?? '';
      const body = JSON.stringify(req.body);
      if (!verifyN8nPayload(n8nCallbackSecret, timestamp, nonce, body, signature)) throw new HttpError(401, 'INVALID_CALLBACK', 'Callback authentication failed.');
      if (!(await store.claimCallbackNonce(nonce, new Date(Date.now() + 300_000).toISOString()))) throw new HttpError(401, 'REPLAYED_CALLBACK', 'Callback replay rejected.');
      const input = parse(z.object({ actionId: z.string().uuid(), tenantId: z.string().uuid(), state: z.enum(['completed', 'failed']), externalReference: z.string().refine(isSafeExternalReference, 'An opaque external reference is required.'), executionReference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u), eventId: z.string().uuid(), correlationId: z.string().uuid(), attempt: z.number().int().min(1).max(100_000) }), req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const updated = await transitionWorkflowAction(action, input.state, input.externalReference, null, input.executionReference, input.eventId, input.correlationId, input.attempt);
      await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: `workflow.callback.${input.state}`, metadata: { actionId: action.id, executionReference: input.executionReference ?? null, eventId: input.eventId ?? null, correlationId: input.correlationId ?? null, attempt: input.attempt ?? null }, createdAt: new Date().toISOString() });
      res.json({ action: updated });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/chat/sessions/:id/documents/config', chatApi, async (req, res, next) => {
    try {
      const session = await store.getSession(routeParam(req, 'id'));
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      const channel = getChannel(req);
      if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      res.json(await documentConfig(session.tenantId));
    } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/documents', chatApi, async (req, res, next) => {
    try {
      const session = await store.getSession(routeParam(req, 'id'));
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      const channel = getChannel(req);
      if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      const input = parse(documentUploadSchema, req.body);
      const existingLead = await store.getCrmLeadBySessionId(session.id, session.tenantId);
      const conversationState = session.conversationState ?? newConversationState();
      const activeIntentKeys = new Set([conversationState.selectedIntentKey, conversationState.activeFollowUpIntentKey, ...conversationState.candidateIntentKeys].filter((value): value is string => Boolean(value)));
      const requestedIntentKey = input.primaryIntentKey ?? conversationState.activeFollowUpIntentKey ?? conversationState.selectedIntentKey ?? existingLead?.intent ?? null;
      if (!requestedIntentKey || (!activeIntentKeys.has(requestedIntentKey) && existingLead?.intent !== requestedIntentKey)) throw new HttpError(409, 'DOCUMENT_INTENT_NOT_ACTIVE', 'The document must belong to the active conversation request.');
      const version = conversationState.catalogVersionId
        ? await store.getIntentCatalogVersion(session.tenantId, conversationState.catalogVersionId)
        : await store.getPublishedIntentCatalog(session.tenantId);
      if (conversationState.catalogVersionId && !version) throw new HttpError(409, 'CATALOG_VERSION_UNAVAILABLE', 'This conversation uses an unavailable catalog version. Please start a new request.');
      const settings = version?.catalog.documentSettings;
      const binding = settings ? version.catalog.workflowBindings.find((candidate) => candidate.workflowKey === settings.workflowKey && candidate.active) : undefined;
      const policy = version?.catalog.documentPolicies?.find((candidate) => candidate.intentKey === requestedIntentKey) ?? version?.catalog.documentPolicies?.find((candidate) => candidate.intentKey === 'anc.document.supporting_upload');
      const journeyRequirement = version?.catalog.journeyRequirements?.find((candidate) => candidate.intentKey === requestedIntentKey && candidate.requirementKey === input.requirementKey && candidate.requirementType === 'document') ?? null;
      if (input.requirementKey && (!journeyRequirement || !journeyRequirement.documentType || !policy?.allowedDocumentTypes.includes(journeyRequirement.documentType))) throw new HttpError(409, 'DOCUMENT_REQUIREMENT_NOT_ACTIVE', 'The requested document requirement is not active for this conversation.');
      if (!settings?.enabled || !binding || !policy?.enabled || !policy.allowUserInitiated || !policy.consentRequired) throw new HttpError(409, 'DOCUMENT_WORKFLOW_NOT_AVAILABLE', 'Supporting document intake is not enabled for this tenant yet.');
      if (!settings.allowedMimeTypes.includes(input.mimeType) || !DEFAULT_DOCUMENT_MIME_TYPES.includes(input.mimeType)) throw new HttpError(422, 'DOCUMENT_TYPE_NOT_ALLOWED', 'This document type is not allowed by the published catalog.');
      if (!isValidBase64(input.contentBase64)) throw new HttpError(422, 'DOCUMENT_ENCODING_INVALID', 'The document encoding is invalid.');
      const content = Buffer.from(input.contentBase64, 'base64');
      const maxBytes = Math.min(settings.maxFileBytes, MAX_DOCUMENT_BYTES);
      if (content.length === 0 || content.length > maxBytes) throw new HttpError(413, 'DOCUMENT_TOO_LARGE', 'The document exceeds the published size limit.');
      if (!hasSupportingDocumentSignature(input.mimeType, content)) throw new HttpError(422, 'DOCUMENT_SIGNATURE_INVALID', 'The document content does not match its declared type.');
      const sha256 = documentSha256(content);
      const documentOpportunityId = conversationState.intentProgress?.entries[requestedIntentKey]?.journeyId ?? null;
      const duplicate = (await store.listSupportingDocuments(session.tenantId, session.id)).find((candidate) => candidate.sha256 === sha256
        && (candidate.opportunityId ?? null) === documentOpportunityId
        && candidate.intentKey === requestedIntentKey
        && (candidate.catalogVersionId ?? null) === (version?.id ?? null)
        && (candidate.requirementKey ?? null) === (journeyRequirement?.requirementKey ?? input.requirementKey ?? null));
      if (duplicate?.status === 'failed') {
        const retryAt = new Date().toISOString();
        await documentStorage.replace(duplicate.storageKey, content);
        const queuedDocument: SupportingDocument = { ...duplicate, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, status: 'queued', extractedText: null, summary: null, errorCode: null, updatedAt: retryAt };
        const retryJob: DocumentProcessingJob = { id: randomUUID(), documentId: duplicate.id, tenantId: session.tenantId, workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, status: 'queued', attempts: 0, leaseExpiresAt: null, executionReference: null, createdAt: retryAt, updatedAt: retryAt };
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
      const document: SupportingDocument = { id: documentId, tenantId: session.tenantId, sessionId: session.id, leadId: existingLead?.id ?? null, opportunityId: conversationState.intentProgress?.entries[requestedIntentKey]?.journeyId ?? null, intentKey: requestedIntentKey, catalogVersionId: version?.id ?? null, requirementKey: journeyRequirement?.requirementKey ?? input.requirementKey ?? null, expectedDocumentType: journeyRequirement?.documentType ?? null, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, sha256, storageKey, status: 'queued', workflowKey: binding.workflowKey, storeExtractedText: policy.storeExtractedText, extractedText: null, summary: null, errorCode: null, consentAt: createdAt, createdAt, updatedAt: createdAt };
      const job: DocumentProcessingJob = { id: randomUUID(), documentId, tenantId: session.tenantId, workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, status: 'queued', attempts: 0, leaseExpiresAt: null, executionReference: null, createdAt, updatedAt: createdAt };
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
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      const channel = getChannel(req);
      if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      res.json({ items: (await store.listSupportingDocuments(session.tenantId, session.id)).map(publicDocument) });
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
  app.get('/api/v1/chat/sessions/:id', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const session = await store.getSession(routeParam(req, 'id')); if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); ensureLiveSession(session.lastActivityAt, session.closedAt); const tenant = await store.getTenant(session.tenantId); if (!tenant) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (!getAuth(req) && !channel) { if (tenant.status !== 'active' || !tenant.publicChatEnabled) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); enforcePublicOrigin(req, tenant, nodeEnv); } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.'); const { limit } = parse(historyQuerySchema, req.query); res.json({ sessionId: session.id, tenantId: session.tenantId, createdAt: session.createdAt, messages: (await store.listMessages(session.id, session.tenantId, limit)).map((message) => ({ id: message.id, role: message.role, content: message.role === 'assistant' ? rehydrateForSession(session, message.maskedContent, tokenVault) : message.maskedContent, citations: message.citations, conversational: message.response?.conversational === true, pendingRequirementKey: typeof message.response?.catalogRequirementKey === 'string' ? message.response.catalogRequirementKey : null, clientMessageId: message.clientMessageId, createdAt: message.createdAt })) }); } catch (error) { next(error); } });

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
      const baseSummary = lead.summary ?? [`Intent: ${lead.intent}`, `Score: ${lead.score}`, `Validation: ${lead.validationPass ? 'passed' : 'failed'}`, `Engagement: ${lead.conversation.length} conversation turns`].join('\n');
      let candidate = baseSummary;
      if (model.summarize) {
        try {
          candidate = await model.summarize({ maskedSummary: baseSummary, conversation: lead.conversation.map(({ role, content }) => ({ role, content })), intent: lead.intent, secondaryIntentKeys: lead.secondaryIntentKeys ?? [], score: lead.score, validationPass: lead.validationPass });
          assertKnownTokens(session, candidate, tokenVault);
        } catch {
          throw new HttpError(503, 'CRM_SUMMARY_AI_UNAVAILABLE', 'The AI summary could not be generated. Please try again.');
        }
      }
      const formatted = formatCrmSummarySpec(candidate);
      assertKnownTokens(session, formatted, tokenVault);
      const updated = await store.updateCrmLeadSummary(lead.id, tenantId, formatted, 'completed');
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'crm.lead.summary_formatted', metadata: { leadId: lead.id, aiGenerated: Boolean(model.summarize) }, createdAt: new Date().toISOString() });
      res.json({ lead: await crmLeadForAdmin(updated), aiGenerated: Boolean(model.summarize) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/crm/leads', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); res.json({ items: await Promise.all((await store.listCrmLeads(tenantId)).map(crmLeadForAdmin)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/audit', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listAudit(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/chat/config', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const tenantSlug = typeof req.query.tenantSlug === 'string' ? req.query.tenantSlug : ''; if (channel && tenantSlug) throw new HttpError(400, 'CHANNEL_TENANT_INPUT_FORBIDDEN', 'Channel credentials resolve the tenant from the channel key.'); const tenant = channel ? await store.getTenant(channel.tenantId) : await store.getTenantBySlug(tenantSlug); if (!tenant || tenant.status !== 'active' || (!channel && !tenant.publicChatEnabled)) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (channel && channel.tenantId !== tenant.id) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (getAuth(req) && !ensureTenant(req, tenant.id)) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv); const persona = await store.getPersona(tenant.id); res.json({ tenant: { slug: tenant.slug, name: tenant.name }, persona: persona ? { name: persona.name, greeting: persona.greeting, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages, voiceName: persona.voiceName, voiceLanguage: persona.voiceLanguage, voiceRate: persona.voiceRate, voicePitch: persona.voicePitch, voiceVolume: persona.voiceVolume } : null, documents: await documentConfig(tenant.id) }); } catch (error) { next(error); } });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as AuthedRequest).requestId ?? randomUUID();
    if (res.headersSent) { next(error); return; }
    if (errorType(error) === 'entity.too.large') { res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.', requestId } }); return; }
    if (errorType(error) === 'entity.parse.failed') { res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } }); return; }
    if (error instanceof CrmSummaryValidationError) { res.status(422).json({ error: { code: 'CRM_SUMMARY_INVALID', message: error.message, requestId } }); return; }
    if (errorCode(error) === '23505') { res.status(409).json({ error: { code: 'RESOURCE_CONFLICT', message: 'The requested resource already exists.', requestId } }); return; }
    if (errorCode(error) === '22P02') { res.status(400).json({ error: { code: 'INVALID_DATA', message: 'The request contains invalid data.', requestId } }); return; }
    console.error(JSON.stringify({ event: 'api.unhandled_error', requestId, type: errorType(error), code: errorCode(error), message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
  });
  return { app, store, auth, gateway, workflow };
};

export const createDefaultApp = () => createApp({});

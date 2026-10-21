import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ActionGateway, isSafeExternalReference, leadQuality, verifyN8nPayload, type WorkflowAdapter } from './actions.js';
import { AuthService, authMiddleware, ensureTenant, requireRoles, type AuthedRequest } from './auth.js';
import { cacheKey, createCache, type CacheStore } from './cache.js';
import { channelAuthMiddleware, ChannelSecretVault, generateChannelApiKey, generateChannelKeyId, generateChannelSecret, getChannel, type StaticChannelAuth } from './channel-auth.js';
import { buildChunksWithEmbeddings, buildIngestionChunksWithEmbeddings, hasConflictingEvidence, rankChunksWithVector } from './knowledge.js';
import { DeterministicEmbeddingProvider, type EmbeddingProvider } from './embedding.js';
import { conversationalIntent, conversationalReply, DeterministicGroundedModel, detectedLanguage, extractLeadData, hasLeadIntent, hasSufficientEvidence, isPermittedLanguage, leadCollectionReply, mergeLeadData, naturalAbstention, needsConversationContext, permittedLanguageReply, validateCitations, type ChatModel, type ModelDraft, type ModelEvidence } from './model.js';
import { assertKnownTokens, maskPii, maskPiiForSession, rehydrateForSession, sanitizeKnowledgeText, saveTokens, TokenVault } from './privacy.js';
import { catalogIntentClarification, catalogSlotQuestion, resolveIntent, validateIntentCatalog } from './intent-catalog.js';
import { MemoryStore, contentHash } from './store-memory.js';
import { hasValidFileSignature, IngestionStaging, MAX_INGESTION_FILE_BYTES } from './ingestion-staging.js';
import { composeDocumentSummary, DEFAULT_DOCUMENT_MIME_TYPES, documentSha256, hasSupportingDocumentSignature, MAX_DOCUMENT_BYTES, PrivateDocumentStorage } from './document-intake.js';
import type { ChannelCredential, CrmLead, DocumentProcessingJob, IntentCatalogQualityRule, LeadData, Message, Session, SourceStatus, Store, SupportingDocument, TenantStatus } from './types.js';

type Telemetry = { requests: number; serverErrors: number; totalLatencyMs: number; lastRequestAt: string | null; chatResponses: number; groundedResponses: number; abstentions: number; actionProposals: number; estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: number | null };
export type RateLimitEntry = { count: number; resetAt: number };
export const pruneExpiredRateLimits = (entries: Map<string, RateLimitEntry>, now = Date.now()): void => {
  for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
};
const catalogQuality = (score: number, rule: IntentCatalogQualityRule | undefined): ReturnType<typeof leadQuality> => rule ? score >= rule.hotThreshold ? 'hot' : score >= rule.warmThreshold ? 'warm' : score >= rule.nurtureThreshold ? 'nurture' : 'new' : leadQuality(score);

const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/\d/, 'Password must contain a number.');
const tenantSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(80), adminEmail: z.string().email(), adminPassword: passwordSchema });
const memberSchema = z.object({ email: z.string().email(), password: passwordSchema, role: z.enum(['tenant_editor', 'tenant_viewer', 'tenant_agent']) });
const domainSchema = z.object({ hostname: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'A valid hostname is required.') });
const channelSchema = z.object({ publicOrigin: z.union([z.literal(''), z.string().url().refine((value) => { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.hash; }, 'A public origin must be an HTTP(S) origin without a path.')]), publicChatEnabled: z.boolean().optional() });
const channelCredentialSchema = z.object({ channel: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,31}$/, 'Channel must be 2-32 lowercase characters, digits, underscores or hyphens.'), authMode: z.enum(['hmac', 'api_key']).default('hmac') });
const safePersonaText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/\b(ignore (?:all )?rules|system prompt|search the web|reveal secrets|bypass security)\b/i.test(value), 'Persona contains an unsafe instruction.');
const DEFAULT_CONTEXT_WINDOW_MESSAGES = 10;
const MAX_KNOWLEDGE_CONTENT_CHARS = 1_000_000;
const MAX_INGESTION_BASE64_CHARS = Math.ceil(MAX_INGESTION_FILE_BYTES / 3) * 4;
const MAX_DOCUMENT_BASE64_CHARS = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;
const personaSchema = z.object({
  name: safePersonaText(80),
  greeting: safePersonaText(500),
  personality: safePersonaText(500),
  tone: safePersonaText(200),
  speakingStyle: safePersonaText(200),
  permittedLanguages: z.array(z.string().min(2).max(12)).min(1).max(10),
  contextWindowMessages: z.coerce.number().int().min(1).max(DEFAULT_CONTEXT_WINDOW_MESSAGES).default(DEFAULT_CONTEXT_WINDOW_MESSAGES),
  voiceName: z.string().trim().max(200).default(''),
  voiceLanguage: z.string().trim().regex(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i).default('en-US'),
  voiceRate: z.coerce.number().min(0.5).max(2).default(1),
  voicePitch: z.coerce.number().min(0).max(2).default(1),
  voiceVolume: z.coerce.number().min(0).max(1).default(1)
});
const personaPreviewSchema = personaSchema.extend({ message: z.string().trim().min(1).max(4000) });
const sourceSchema = z.object({ title: z.string().trim().min(1).max(200), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson', 'text/html', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']), sourceUrl: z.string().url().optional(), audience: z.enum(['public', 'internal']).default('public'), content: z.string().trim().min(1).max(MAX_KNOWLEDGE_CONTENT_CHARS) });
const uploadSchema = z.object({ title: z.string().trim().min(1).max(200), fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']), audience: z.enum(['public', 'internal']).default('public'), contentBase64: z.string().min(1).max(MAX_INGESTION_BASE64_CHARS) });
const intentCatalogUploadSchema = z.object({ fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/i).refine((value) => value.toLowerCase().endsWith('.xlsx'), 'An .xlsx workbook is required.'), contentBase64: z.string().min(1).max(MAX_INGESTION_BASE64_CHARS) });
const intentCatalogEditSchema = z.object({ catalog: z.unknown() });
const intentCatalogResultSchema = z.object({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), parserVersion: z.string().trim().min(1).max(120), catalog: z.unknown() });
const ingestionRequestSchema = sourceSchema.omit({ content: true });
const ingestionResultSchema = z.object({
  normalizedContent: z.string().min(1).max(MAX_KNOWLEDGE_CONTENT_CHARS),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string().trim().min(1).max(120),
  chunks: z.array(z.object({ ordinal: z.number().int().nonnegative(), locator: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(20_000), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(2_000),
});
const ingestionFailureSchema = z.object({ errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,80}$/).default('INGESTION_FAILED') });
const sessionSchema = z.object({ tenantId: z.string().uuid().optional(), tenantSlug: z.string().regex(/^[a-z0-9-]+$/).optional() });
const messageSchema = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(4000), clientMessageId: z.string().trim().min(1).max(128) });
const confirmSchema = z.object({ sessionId: z.string().uuid(), confirmed: z.literal(true) });
const retentionSchema = z.object({ before: z.string().datetime() });
const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const leadTokenSchema = z.string().regex(/^\[(?:NAME|EMAIL|PHONE)_\d+\]$/);
const crmLeadSchema = z.object({
  actionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  leadData: z.object({ name: leadTokenSchema.optional(), email: leadTokenSchema.optional(), phone: leadTokenSchema.optional(), interest: z.string().trim().min(1).max(200).optional(), contactConsent: z.boolean().optional() }).strict(),
  intent: z.string().trim().min(1).max(80),
  intentScore: z.number().int().min(0).max(100).optional(),
  intentConfidence: z.number().min(0).max(1).optional(),
  catalogVersionId: z.string().uuid().nullable().optional(),
  score: z.number().int().min(0).max(100),
  validationPass: z.boolean(),
  conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000), createdAt: z.string().datetime() })).min(1).max(200),
  completeAction: z.boolean().default(true)
});
const crmSummarySchema = z.object({ tenantId: z.string().uuid(), summary: z.string().trim().min(1).max(20_000), status: z.enum(['completed', 'failed']) });
const crmQualificationSchema = z.object({ tenantId: z.string().uuid(), score: z.number().int().min(0).max(100), summary: z.string().trim().min(1).max(20_000) });
const crmRemoteSchema = z.object({ tenantId: z.string().uuid(), leadId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/u), remoteCrm: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/u) });
const crmRemotePayloadSchema = z.object({ tenantId: z.string().uuid(), actionId: z.string().uuid() });
const workflowClaimSchema = z.object({ workflowKey: z.string().trim().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9_-]+)+$/i), contract: z.string().trim().min(1).max(120).optional(), limit: z.number().int().min(1).max(50).default(10) });
const workflowCompletionSchema = z.object({ actionId: z.string().uuid(), tenantId: z.string().uuid(), state: z.enum(['completed', 'failed']), externalReference: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u).optional() });
const crmQualitySchema = z.object({ tenantId: z.string().uuid(), score: z.number().int().min(0).max(100), qualityWorkflowKey: z.string().trim().min(1).max(80), catalogVersionId: z.string().uuid(), intentKey: z.string().trim().min(1).max(80) });
const documentUploadSchema = z.object({ fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/), mimeType: z.string().trim().min(1).max(160), contentBase64: z.string().min(1).max(MAX_DOCUMENT_BASE64_CHARS), processingConsent: z.literal(true), primaryIntentKey: z.string().trim().min(1).max(80).optional() });
const documentResultSchema = z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid(), extractedText: z.string().max(100_000).default(''), summary: z.string().max(20_000).default(''), executionReference: z.string().trim().max(200).regex(/^[A-Za-z0-9._:-]+$/u).optional() });
const documentFailureSchema = z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid(), errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,80}$/).default('DOCUMENT_OCR_FAILED') });
const documentRenewSchema = z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid(), leaseMs: z.number().int().min(60_000).max(900_000).default(120_000) });

const publicUser = (user: { id: string; email: string; role: string; tenantId: string | null }) => ({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });
const publicChannelCredential = (credential: ChannelCredential) => ({ id: credential.id, tenantId: credential.tenantId, channel: credential.channel, authMode: credential.authMode, keyId: credential.keyId, active: credential.active, createdAt: credential.createdAt, revokedAt: credential.revokedAt });

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'HttpError'; }
}

const errorProperty = (error: unknown, property: string): unknown => typeof error === 'object' && error !== null && property in error ? error[property as keyof typeof error] : undefined;
const errorType = (error: unknown): string | undefined => { const value = errorProperty(error, 'type'); return typeof value === 'string' ? value : undefined; };
const errorCode = (error: unknown): string | undefined => { const value = errorProperty(error, 'code'); return typeof value === 'string' ? value : undefined; };
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

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(422, 'VALIDATION_ERROR', result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join(' '));
  return result.data;
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
  const identity = leadData.email ? `email:${rehydrate(leadData.email).trim().toLowerCase()}` : leadData.phone ? `phone:${rehydrate(leadData.phone).replace(/\D/g, '')}` : '';
  if (!identity) throw new HttpError(422, 'LEAD_IDENTITY_REQUIRED', 'A lead requires an email address or phone number.');
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
    return /^(?:yes|y|yeah|yep|yes\s*,?\s+i\s+(?:(?:do|explicitly)\s+)?consent(?:\s+to\s+.*)?|i\s+(?:(?:do|explicitly)\s+)?consent(?:\s+to\s+.*)?|i\s+agree(?:\s+to\s+.*)?|i\s+authorize(?:\s+.*)?|go\s+ahead|you\s+may\s+contact\s+me)[.!\s]*$/iu.test(rawInput.trim()) ? 'true' : null;
  }
  return validationRule === 'text:nonempty' && maskedInput.trim() ? maskedInput.trim() : null;
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
}

export const createApp = (dependencies: AppDependencies = {}) => {
  const store = dependencies.store ?? new MemoryStore();
  const cache = dependencies.cache ?? createCache(process.env.REDIS_URL);
  const model = dependencies.model ?? new DeterministicGroundedModel();
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
  const tokenVault = dependencies.tokenVault ?? new TokenVault(vaultSecret);
  const channelVault = new ChannelSecretVault(channelCredentialKey);
  const embedding = dependencies.embedding ?? new DeterministicEmbeddingProvider();
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
  const newTelemetry = (): Telemetry => ({ requests: 0, serverErrors: 0, totalLatencyMs: 0, lastRequestAt: null, chatResponses: 0, groundedResponses: 0, abstentions: 0, actionProposals: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: inputCostUsdPerMillion !== null && outputCostUsdPerMillion !== null ? 0 : null });
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
  const observedTelemetry = (value: Telemetry) => ({ requests: value.requests, serverErrors: value.serverErrors, averageLatencyMs: value.requests ? Math.round(value.totalLatencyMs / value.requests) : 0, lastRequestAt: value.lastRequestAt, chatResponses: value.chatResponses, groundedResponses: value.groundedResponses, abstentions: value.abstentions, actionProposals: value.actionProposals, groundingRate: value.chatResponses ? value.groundedResponses / value.chatResponses : 0, abstentionRate: value.chatResponses ? value.abstentions / value.chatResponses : 0, estimatedInputTokens: value.estimatedInputTokens, estimatedOutputTokens: value.estimatedOutputTokens, estimatedCostUsd: value.estimatedCostUsd });

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
    return { ...lead, quality, leadData: { ...(lead.leadData.name ? { name: rehydrate(lead.leadData.name) } : {}), ...(lead.leadData.email ? { email: rehydrate(lead.leadData.email) } : {}), ...(lead.leadData.phone ? { phone: rehydrate(lead.leadData.phone) } : {}), ...(lead.leadData.interest ? { interest: lead.leadData.interest } : {}) }, conversation: lead.conversation.map((message) => ({ ...message, content: rehydrate(message.content) })), summary: lead.summary ? rehydrate(lead.summary) : null, documents: documents.map((document) => ({ ...document, extractedText: document.extractedText ? rehydrate(document.extractedText) : null, summary: document.summary ? rehydrate(document.summary) : null })) };
  };

  const publicDocument = (document: SupportingDocument) => ({ id: document.id, sessionId: document.sessionId, leadId: document.leadId, fileName: document.fileName, mimeType: document.mimeType, sizeBytes: document.sizeBytes, status: document.status, summary: null, errorCode: document.errorCode, createdAt: document.createdAt, updatedAt: document.updatedAt });
  const documentConfig = async (tenantId: string) => {
    const version = await store.getPublishedIntentCatalog(tenantId);
    const settings = version?.catalog.documentSettings;
    const policies = version?.catalog.documentPolicies ?? [];
    const binding = settings ? version?.catalog.workflowBindings.find((candidate) => candidate.workflowKey === settings.workflowKey && candidate.active) : undefined;
    return { enabled: Boolean(settings?.enabled && binding), requireUploadConsent: settings?.requireUploadConsent ?? true, maxFileBytes: Math.min(settings?.maxFileBytes ?? MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES), maxFilesPerRequest: settings?.maxFilesPerRequest ?? 1, maxPdfPages: settings?.maxPdfPages ?? 20, allowedMimeTypes: settings?.allowedMimeTypes ?? [], policies: policies.filter((policy) => policy.enabled && policy.allowUserInitiated).map((policy) => ({ intentKey: policy.intentKey, requestMode: policy.requestMode, allowedDocumentTypes: policy.allowedDocumentTypes, consentRequired: policy.consentRequired })), workflowKey: settings?.workflowKey ?? null, binding: binding ? { webhookPath: binding.webhookPath, payloadContract: binding.payloadContract } : null };
  };
  const dispatchDocumentWorkflow = async (job: DocumentProcessingJob, contract: string): Promise<void> => {
    const baseUrl = process.env.N8N_INTERNAL_URL?.trim();
    if (!baseUrl) return;
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/u, '')}/webhook/${job.webhookPath.replace(/^\/+/, '')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-internal-secret': n8nCallbackSecret }, body: JSON.stringify({ documentId: job.documentId, jobId: job.id, tenantId: job.tenantId, workflowKey: job.workflowKey, contract }) , signal: AbortSignal.timeout(5000) });
      if (!response.ok) await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'document.workflow_dispatch_failed', metadata: { jobId: job.id, status: response.status }, createdAt: new Date().toISOString() });
    } catch { await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'document.workflow_dispatch_failed', metadata: { jobId: job.id, status: 'network_error' }, createdAt: new Date().toISOString() }); }
  };

  app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_req, res) => {
    try { await store.countUsers(); res.json({ status: 'ready', store: 'available', cache: (await cache.ping()) ? 'available' : 'degraded' }); } catch { res.status(503).json({ status: 'not_ready' }); }
  });

  app.post('/api/v1/auth/register-platform', async (req, res, next) => {
    try {
       if (nodeEnv === 'production') throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      if (await store.countUsers() > 0) throw new HttpError(409, 'BOOTSTRAP_COMPLETE', 'Platform bootstrap is already complete.');
      const input = parse(z.object({ email: z.string().email(), password: passwordSchema }), req.body);
      const user = await store.createUser({ email: input.email, passwordHash: await auth.hashPassword(input.password), role: 'platform_admin', tenantId: null });
      res.status(201).json({ token: await auth.issue(user), user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/auth/login', async (req, res, next) => {
    try {
      const input = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
      const user = await store.getUserByEmail(input.email);
      if (!user || !(await auth.verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      res.json({ token: await auth.issue(user), user: publicUser(user) });
    } catch (error) { next(error); }
  });

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

  app.post('/api/v1/auth/logout', protectedApi, async (req, res) => { const token = req.header('authorization')?.slice(7); if (token) await auth.revoke(token); res.status(204).send(); });
  app.get('/api/v1/auth/me', protectedApi, (req, res) => { const current = getAuth(req); if (!current) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }); return; } res.json({ user: current }); });

  app.post('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try {
      const input = parse(tenantSchema, req.body);
      if (await store.getTenantBySlug(input.slug)) throw new HttpError(409, 'TENANT_EXISTS', 'Tenant slug already exists.');
      if (await store.getUserByEmail(input.adminEmail)) throw new HttpError(409, 'USER_EXISTS', 'Admin email already exists.');
      const tenant = await store.createTenant({ name: input.name, slug: input.slug });
      const user = await store.createUser({ email: input.adminEmail, passwordHash: await auth.hashPassword(input.adminPassword), role: 'tenant_admin', tenantId: tenant.id });
      await store.setPersona({ tenantId: tenant.id, name: 'Sales assistant', greeting: 'How can I help?', personality: 'Helpful and precise.', tone: 'Clear', speakingStyle: 'Concise', permittedLanguages: ['en'], contextWindowMessages: DEFAULT_CONTEXT_WINDOW_MESSAGES, voiceName: '', voiceLanguage: 'en-US', voiceRate: 1, voicePitch: 1, voiceVolume: 1 });
      await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: 'tenant.created', metadata: { slug: tenant.slug }, createdAt: new Date().toISOString() });
      res.status(201).json({ tenant, admin: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), async (_req, res, next) => { try { res.json({ items: await store.listTenants() }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/platform/overview', protectedApi, requireRoles('platform_admin'), async (_req, res, next) => { try { const tenants = await store.listTenants(); const stats = await Promise.all(tenants.map(async (tenant) => ({ tenantId: tenant.id, metrics: await store.getTenantStats(tenant.id) }))); res.json({ tenants: { total: tenants.length, active: tenants.filter((tenant) => tenant.status === 'active').length, suspended: tenants.filter((tenant) => tenant.status === 'suspended').length, archived: tenants.filter((tenant) => tenant.status === 'archived').length }, metrics: stats }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/tenants/:id/status', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const status = parse(z.object({ status: z.enum(['active', 'suspended', 'archived']) }), req.body).status as TenantStatus; const tenant = await store.setTenantStatus(routeParam(req, 'id'), status); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: `tenant.${status}`, metadata: {}, createdAt: new Date().toISOString() }); res.json({ tenant }); } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/tenant', protectedApi, async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const tenant = await store.getTenant(tenantId); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); res.json({ tenant }); } catch (error) { next(error); } });

  app.get('/api/v1/admin/members', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: (await store.listUsers(await tenantForRequest(store, req))).map(publicUser) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/members', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(memberSchema, req.body); if (await store.getUserByEmail(input.email)) throw new HttpError(409, 'USER_EXISTS', 'Member email already exists.'); const user = await store.createUser({ email: input.email, passwordHash: await auth.hashPassword(input.password), role: input.role, tenantId }); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'member.created', metadata: { memberId: user.id, role: user.role }, createdAt: new Date().toISOString() }); res.status(201).json({ user: publicUser(user) }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/members/:id', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const role = parse(z.object({ role: z.enum(['tenant_editor', 'tenant_viewer', 'tenant_agent']) }), req.body).role; const user = await store.updateUserRole(routeParam(req, 'id'), tenantId, role); if (!user) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Member not found or not eligible for role changes.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'member.role_updated', metadata: { memberId: user.id, role }, createdAt: new Date().toISOString() }); res.json({ user: publicUser(user) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/domains', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: await store.listDomains(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/domains', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(domainSchema, req.body); if ((await store.listDomains(tenantId)).some((domain) => domain.hostname === input.hostname)) throw new HttpError(409, 'DOMAIN_EXISTS', 'Domain already exists.'); const domain = await store.addDomain({ tenantId, hostname: input.hostname }); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'domain.created', metadata: { hostname: domain.hostname }, createdAt: new Date().toISOString() }); res.status(201).json({ domain }); } catch (error) { next(error); } });
  app.delete('/api/v1/admin/domains/:id', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const id = routeParam(req, 'id'); if (!(await store.removeDomain(id, tenantId))) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'Domain not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'domain.deleted', metadata: { domainId: id }, createdAt: new Date().toISOString() }); res.status(204).send(); } catch (error) { next(error); } });
  app.get('/api/v1/admin/channel', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenant = await activeTenant(store, await tenantForRequest(store, req)); res.json({ publicOrigin: tenant.publicOrigin, publicChatEnabled: tenant.publicChatEnabled }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/channel', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(channelSchema, req.body); let tenant = await store.setTenantPublicOrigin(tenantId, input.publicOrigin ? new URL(input.publicOrigin).origin : null); if (tenant && input.publicChatEnabled !== undefined) tenant = await store.setTenantPublicChatEnabled(tenantId, input.publicChatEnabled); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'tenant.channel_updated', metadata: { publicOrigin: tenant.publicOrigin, publicChatEnabled: tenant.publicChatEnabled }, createdAt: new Date().toISOString() }); res.json({ publicOrigin: tenant.publicOrigin, publicChatEnabled: tenant.publicChatEnabled }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/channels', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: (await store.listChannelCredentials(await tenantForRequest(store, req))).map(publicChannelCredential) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/channels', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(channelCredentialSchema, req.body);
      if ((await store.listChannelCredentials(tenantId)).some((credential) => credential.channel === input.channel && credential.active)) throw new HttpError(409, 'CHANNEL_EXISTS', 'An active credential already exists for this channel.');
      const authMode = input.authMode ?? 'hmac';
      const tenant = await store.getTenant(tenantId);
      if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
      const secret = authMode === 'api_key' ? generateChannelApiKey(tenant.slug) : generateChannelSecret();
      const credential = await store.createChannelCredential({ id: randomUUID(), tenantId, channel: input.channel, authMode, keyId: generateChannelKeyId(), secretCiphertext: channelVault.encrypt(secret), apiKeyHash: authMode === 'api_key' ? channelVault.hashApiKey(secret) : null, active: true });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'channel.credential_created', metadata: { channel: credential.channel, credentialId: credential.id }, createdAt: new Date().toISOString() });
      res.status(201).json({ credential: publicChannelCredential(credential), secret, warning: 'Store this secret now. It is shown only once.' });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/channels/:id/revoke', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const credential = await store.revokeChannelCredential(routeParam(req, 'id'), tenantId); if (!credential) throw new HttpError(404, 'CHANNEL_NOT_FOUND', 'Channel credential not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'channel.credential_revoked', metadata: { channel: credential.channel, credentialId: credential.id }, createdAt: new Date().toISOString() }); res.json({ credential: publicChannelCredential(credential) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/dashboard/overview', protectedApi, async (req, res, next) => { try { res.json({ tenantId: await tenantForRequest(store, req), metrics: await store.getTenantStats(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/retention/purge-sessions', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const before = parse(retentionSchema, req.body).before;
      if (Date.parse(before) > Date.now()) throw new HttpError(422, 'INVALID_RETENTION_CUTOFF', 'Retention cutoff must be in the past.');
      const expiredDocuments = await store.listExpiredSupportingDocuments(tenantId, before);
      for (const document of expiredDocuments) await documentStorage.purge(document.storageKey);
      const purged = await store.purgeExpiredSessions(tenantId, before);
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'retention.sessions_purged', metadata: { purged, before }, createdAt: new Date().toISOString() });
      res.json({ purged, before });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/services/health', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, _next) => {
    const checkedAt = new Date().toISOString();
    const auth = getAuth(req);
    const observed = observedTelemetry(auth?.role === 'platform_admin' ? telemetry : tenantTelemetry.get(auth?.tenantId ?? '') ?? newTelemetry());
    try {
      await store.countUsers();
      const isCacheOk = (await cache.ping()) ? 'ok' : 'degraded';
      res.json({
        checkedAt,
        telemetry: observed,
        checks: {
          api: { status: 'ok' },
          store: { status: 'ok' },
          cache: { status: isCacheOk },
          model: { status: dependencies.model ? 'ok' : 'adapter' },
          embedding: { status: dependencies.embedding ? 'ok' : 'adapter' },
          workflow: { status: 'catalog-polling' },
          ingestion: { status: ingestionWorkerSecret ? 'ok' : 'ready' }
        }
      });
    } catch {
      res.status(503).json({
        checkedAt,
        telemetry: observed,
        checks: {
          api: { status: 'ok' },
          store: { status: 'down' },
          cache: { status: 'down' },
          model: { status: dependencies.model ? 'ok' : 'adapter' },
          embedding: { status: dependencies.embedding ? 'ok' : 'adapter' },
          workflow: { status: 'catalog-polling' },
          ingestion: { status: ingestionWorkerSecret ? 'ok' : 'ready' }
        }
      });
    }
  });

  app.put('/api/v1/admin/persona', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); const version = await store.createPersonaVersion({ tenantId, ...input, contextWindowMessages: input.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, voiceName: input.voiceName ?? '', voiceLanguage: input.voiceLanguage ?? 'en-US', voiceRate: input.voiceRate ?? 1, voicePitch: input.voicePitch ?? 1, voiceVolume: input.voiceVolume ?? 1, status: 'draft' }); await store.publishPersonaVersion(tenantId, version.id); const persona = await store.getPersona(tenantId); res.json({ persona }); } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/tenants/:tenantId/persona', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const tenant = await store.getTenant(routeParam(req, 'tenantId')); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (tenant.status === 'archived') throw new HttpError(423, 'TENANT_ARCHIVED', 'Archived tenants cannot be managed.'); res.json({ persona: await store.getPersona(tenant.id) }); } catch (error) { next(error); }
  });
  app.put('/api/v1/admin/tenants/:tenantId/persona', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const tenant = await store.getTenant(routeParam(req, 'tenantId')); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (tenant.status === 'archived') throw new HttpError(423, 'TENANT_ARCHIVED', 'Archived tenants cannot be managed.'); const input = parse(personaSchema, req.body); const version = await store.createPersonaVersion({ tenantId: tenant.id, ...input, contextWindowMessages: input.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, voiceName: input.voiceName ?? '', voiceLanguage: input.voiceLanguage ?? 'en-US', voiceRate: input.voiceRate ?? 1, voicePitch: input.voicePitch ?? 1, voiceVolume: input.voiceVolume ?? 1, status: 'draft' }); await store.publishPersonaVersion(tenant.id, version.id); const persona = await store.getPersona(tenant.id); await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: 'persona.platform_updated', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() }); res.json({ persona }); } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/persona', protectedApi, async (req, res, next) => { try { res.json({ persona: await store.getPersona(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/drafts', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); res.status(201).json({ version: await store.createPersonaVersion({ tenantId, ...input, contextWindowMessages: input.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, voiceName: input.voiceName ?? '', voiceLanguage: input.voiceLanguage ?? 'en-US', voiceRate: input.voiceRate ?? 1, voicePitch: input.voicePitch ?? 1, voiceVolume: input.voiceVolume ?? 1, status: 'draft' }) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/persona/versions', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listPersonaVersions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/versions/:id/publish', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const version = await store.publishPersonaVersion(tenantId, routeParam(req, 'id')); if (!version) throw new HttpError(404, 'PERSONA_VERSION_NOT_FOUND', 'Persona version not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'persona.published', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() }); res.json({ version }); } catch (error) { next(error); } });

  app.post('/api/v1/admin/persona/preview', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const tenant = await activeTenant(store, tenantId);
      const input = parse(personaPreviewSchema, req.body);
      const masked = maskPii(input.message);
      const previewSession = { id: randomUUID(), tenantId, createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
      saveTokens(previewSession, masked.tokens, tokenVault);
      const queryEmbedding = await embedding.embed(masked.masked);
      const ranked = rankChunksWithVector(masked.masked, await store.searchSearchableChunks(tenantId, 'internal', queryEmbedding, 4), queryEmbedding, 4);
      const evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: chunk.content }));
      const language = detectedLanguage(masked.masked);
      const languageAllowed = isPermittedLanguage(masked.masked, input.permittedLanguages);
      const intent = conversationalIntent(masked.masked);
      const conversational = intent !== null && (languageAllowed || language === 'ar');
      let draft: ModelDraft;
      if (!languageAllowed && !conversational) draft = { answer: permittedLanguageReply(language, input.permittedLanguages), citationIds: [], proposedIntent: null };
      else if (conversational && intent === 'identity') draft = { answer: conversationalReply(intent, input.name, language, tenant.name), citationIds: [], proposedIntent: null };
      else if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null };
      else if (conversational && evidence.length === 0) draft = { answer: intent === 'greeting' && language !== 'ar' ? input.greeting : conversationalReply(intent ?? 'identity', input.name, language, tenant.name), citationIds: [], proposedIntent: null };
      else draft = await model.draft({ maskedMessage: masked.masked, evidence, personaName: input.name, ownerName: tenant.name, persona: input });
      assertKnownTokens(previewSession, draft.answer, tokenVault);
      const citations = validateCitations(draft, evidence);
      const grounded = languageAllowed && hasSufficientEvidence(draft.answer, evidence, citations);
      const safeCitations = grounded ? citations : [];
      const casualFallback = conversational && (evidence.length === 0 || intent === 'identity');
      const answer = !languageAllowed ? draft.answer : casualFallback ? draft.answer : grounded ? draft.answer : naturalAbstention(language);
      res.json({ preview: { answer: rehydrateForSession(previewSession, answer, tokenVault), grounded, citations: safeCitations, persona: { name: input.name, permittedLanguages: input.permittedLanguages } } });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/admin/ingestion-jobs', protectedApi, requireRoles('tenant_admin', 'tenant_editor'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(ingestionRequestSchema, req.body);
      await validateSourceUrl(store, tenantId, input.sourceUrl);
      const job = await store.createIngestionJob({ id: randomUUID(), tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public' });
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
      const job = await store.claimIngestionJob(createdJob.id, 60_000);
      if (!job) throw new HttpError(409, 'INGESTION_BUSY', 'The ingestion job could not be claimed.');
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
        const source = await store.createSource({ id: sourceId, tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public', status: 'awaiting_review', versionId, contentHash: safeContentHash, chunks });
        await store.updateIngestionJob({ ...job, sourceId: source.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.staged', metadata: { sourceId, chunks: chunks.length, jobId }, createdAt: new Date().toISOString() });
        res.status(201).json({ source, ingestion: { jobId, status: 'completed', sourceStatus: 'awaiting_review', chunks: chunks.length } });
      } catch (error) {
        const errorCode = error instanceof HttpError ? error.code : 'INGESTION_FAILED';
        await store.updateIngestionJob({ ...job, status: 'failed', errorCode, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
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
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'intent_catalog.queued', metadata: { jobId, bytes: content.length }, createdAt: new Date().toISOString() });
        res.status(202).json({ job });
      } catch (error) {
        await ingestionStaging.purge(jobId, 'application/vnd.agentic.intent-catalog+excel');
        throw error;
      }
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/intent-catalog/versions', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listIntentCatalogVersions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
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
    try { const tenantId = await tenantForRequest(store, req); await activeTenant(store, tenantId); const source = await store.setSourceStatus(routeParam(req, 'id'), tenantId, status); if (!source) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: `source.${status}`, metadata: { sourceId: source.id }, createdAt: new Date().toISOString() }); res.json({ source }); } catch (error) { next(error); }
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
      const job = await store.claimIngestionJob(createdJob.id, 60_000);
      if (!job) throw new HttpError(409, 'INGESTION_BUSY', 'The reindex job could not be claimed.');
      try {
        const versionId = randomUUID();
        const chunks = await buildIngestionChunksWithEmbeddings({ id: source.id, tenantId, versionId }, currentChunks.map((chunk) => ({ ordinal: chunk.ordinal, locator: chunk.locator, content: chunk.content, contentHash: chunk.contentHash })), embedding);
        const updated = await store.replaceSourceVersion({ sourceId: source.id, tenantId, versionId, contentHash: source.contentHash, chunks });
        if (!updated) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.');
        const completed = await store.updateIngestionJob({ ...job, sourceId: updated.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.reindexed', metadata: { sourceId: source.id, jobId: job.id, versionId }, createdAt: new Date().toISOString() });
        res.json({ job: completed, source: updated, ingestion: { status: 'awaiting_review', chunks: chunks.length } });
      } catch (error) {
        const errorCode = error instanceof HttpError ? error.code : 'INGESTION_FAILED';
        await store.updateIngestionJob({ ...job, status: 'failed', errorCode, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
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
      const queued = await store.updateIngestionJob({ ...job, status: 'queued', errorCode: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'ingestion.retried', metadata: { jobId: job.id }, createdAt: new Date().toISOString() });
      res.json({ job: queued });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/:id/claim', workerApi, async (req, res, next) => {
    try {
      const job = await store.getIngestionJob(routeParam(req, 'id'));
      if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
      const claimed = await store.claimIngestionJob(job.id, 60_000);
      if (!claimed) throw new HttpError(409, 'INGESTION_BUSY', 'The ingestion job is already claimed or complete.');
      res.json({ job: claimed });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/ingestion-jobs/claim-next', workerApi, async (_req, res, next) => {
    try { res.json({ job: await store.claimNextIngestionJob(60_000) }); } catch (error) { next(error); }
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
      const failed = await store.updateIngestionJob({ ...job, status: 'failed', errorCode, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      await ingestionStaging.purge(job.id, job.mimeType);
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
            const completed = await store.updateIngestionJob({ ...job, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
            await ingestionStaging.purge(job.id, job.mimeType);
            res.status(200).json({ job: completed, version: existing, idempotent: true });
            return;
          }
          const version = await store.createIntentCatalogVersion({ tenantId: job.tenantId, status: 'draft', sourceFileName: job.title, sourceHash: input.sourceHash, parserVersion: input.parserVersion, catalog: validation.catalog });
          const completed = await store.updateIngestionJob({ ...job, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
          await ingestionStaging.purge(job.id, job.mimeType);
          await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'intent_catalog.imported', metadata: { versionId: version.id, version: version.version, jobId: job.id }, createdAt: new Date().toISOString() });
          res.status(201).json({ job: completed, version });
          return;
        } catch (error) {
          const current = await store.getIngestionJob(job.id);
          if (current?.status === 'processing') await store.updateIngestionJob({ ...current, status: 'failed', errorCode: error instanceof HttpError ? error.code : 'CATALOG_IMPORT_FAILED', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
          await ingestionStaging.purge(job.id, job.mimeType);
          throw error;
        }
      }
      const input = parse(ingestionResultSchema, req.body);
      const normalizedContent = canonicalKnowledgeText(input.normalizedContent);
      if (contentHash(normalizedContent) !== input.contentHash) throw new HttpError(422, 'CONTENT_HASH_MISMATCH', 'The normalized content hash does not match the worker result.');
      const chunks = [...input.chunks].sort((left, right) => left.ordinal - right.ordinal);
      if (chunks.some((chunk, index) => chunk.ordinal !== index)) throw new HttpError(422, 'INVALID_CHUNK_ORDER', 'Worker chunks must use contiguous ordinals.');
      const safeChunks = chunks.map((chunk) => ({ ...chunk, content: sanitizeKnowledgeText(chunk.content) }));
      if (safeChunks.some((chunk) => contentHash(chunk.content) !== chunk.contentHash)) throw new HttpError(422, 'CHUNK_HASH_MISMATCH', 'A worker chunk hash does not match sanitized content.');
      const existing = await store.findSourceByHash(job.tenantId, input.contentHash);
      if (existing) {
        const completed = await store.updateIngestionJob({ ...job, sourceId: existing.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await ingestionStaging.purge(job.id, job.mimeType);
        res.status(200).json({ job: completed, source: existing, idempotent: true });
        return;
      }
      try {
        const sourceId = randomUUID();
        const versionId = randomUUID();
        const embeddedChunks = await buildIngestionChunksWithEmbeddings({ id: sourceId, tenantId: job.tenantId, versionId }, safeChunks, embedding);
        const source = await store.createSource({ id: sourceId, tenantId: job.tenantId, title: job.title, mimeType: job.mimeType, sourceUrl: job.sourceUrl, audience: job.audience, status: 'awaiting_review', versionId, contentHash: input.contentHash, chunks: embeddedChunks });
        const completed = await store.updateIngestionJob({ ...job, sourceId: source.id, status: 'completed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
        await ingestionStaging.purge(job.id, job.mimeType);
        await store.addAudit({ id: randomUUID(), tenantId: job.tenantId, actorId: null, eventName: 'source.ingested', metadata: { sourceId, jobId: job.id, parserVersion: input.parserVersion, chunks: embeddedChunks.length }, createdAt: new Date().toISOString() });
        res.status(201).json({ job: completed, source, ingestion: { status: 'awaiting_review', chunks: embeddedChunks.length } });
      } catch (error) {
        const errorCode = error instanceof HttpError ? error.code : 'INGESTION_FAILED';
        await store.updateIngestionJob({ ...job, status: 'failed', errorCode, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
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
      const channel = getChannel(req);
      const session = await store.getSession(input.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv);
      enforcePublicChatEnabled(req, tenant);
      if ((channel && channel.tenantId !== session.tenantId) || (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin')) throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
      const masked = maskPii(input.message);
      const messageHash = contentHash(masked.masked);
      const responseCacheKey = cacheKey('chat-response', session.tenantId, session.id, input.clientMessageId);
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
      saveTokens(session, masked.tokens, tokenVault);
      session.lastActivityAt = new Date().toISOString();
      await store.updateSession(session);
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
      const leadDataRequested = leadRequestedNow || /\[(?:NAME|EMAIL|PHONE)_\d+\]/u.test(masked.masked) || /\b(?:my name is|i am|i'm)\b/i.test(input.message);
      const contextWindowMessages = persona?.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES;
      let evidence: ModelEvidence[] = [];
      let draft: ModelDraft;
      const publishedCatalog = await store.getPublishedIntentCatalog(session.tenantId);
      const catalogHistory = publishedCatalog ? await store.listMessages(session.id, session.tenantId, contextWindowMessages + 1) : [];
      const lastCatalogAssistant = [...catalogHistory].reverse().find((message) => message.role === 'assistant');
      const pendingCatalogIntent = typeof lastCatalogAssistant?.response?.catalogIntentKey === 'string' && typeof lastCatalogAssistant.response.catalogVersionId === 'string' && lastCatalogAssistant.response.catalogVersionId === publishedCatalog?.id ? lastCatalogAssistant.response.catalogIntentKey : null;
      const pendingConsentAction = publishedCatalog && pendingCatalogIntent ? (await store.listActions(session.tenantId)).find((action) => action.sessionId === session.id && action.catalogVersionId === publishedCatalog.id && action.intentKey === pendingCatalogIntent && action.payload.contactConsent === true) : null;
      const pendingCatalogValues: Record<string, string> = { ...(lastCatalogAssistant?.response?.catalogSlotValues && typeof lastCatalogAssistant.response.catalogSlotValues === 'object' && !Array.isArray(lastCatalogAssistant.response.catalogSlotValues) ? Object.fromEntries(Object.entries(lastCatalogAssistant.response.catalogSlotValues).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}), ...(pendingConsentAction ? { contact_consent: 'true' } : {}) };
      const pendingSlot = publishedCatalog && pendingCatalogIntent ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === pendingCatalogIntent && slot.slotKey === (lastCatalogAssistant?.response?.catalogSlotKey ?? '')) : null;
      const pendingNameIsIntentPhrase = pendingSlot?.slotKey === 'name' && publishedCatalog
        ? publishedCatalog.catalog.signals.some((signal) => signal.intentKey === pendingCatalogIntent && signal.signalType === 'phrase' && signal.value && masked.masked.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').includes(signal.value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim()))
        : false;
      const pendingValue = pendingSlot && !pendingNameIsIntentPhrase ? pendingCatalogSlotValue(pendingSlot.validationRule, input.message, masked.masked, session, tokenVault) : null;
      const maskedMessage = pendingSlot?.slotKey === 'name' && pendingValue && masked.masked.trim() === input.message.trim() ? pendingValue : masked.masked;
      if (maskedMessage !== userMessage.maskedContent) {
        userMessage = await store.updateMessage({ ...userMessage, maskedContent: maskedMessage });
      }
      const pendingValueData = pendingSlot?.slotKey === 'name' && pendingValue ? { name: pendingValue } : pendingSlot?.slotKey === 'email' && pendingValue ? { email: pendingValue } : pendingSlot?.slotKey === 'phone' && pendingValue ? { phone: pendingValue } : {};
      const pendingCatalogValueData = pendingSlot && pendingValue ? { [pendingSlot.slotKey]: pendingValue } : {};
      const currentLeadData = mergeLeadData(pendingCatalogValues as LeadData, extractLeadData(maskedMessage), pendingValueData);
      const currentCatalogSlotValues = { ...pendingCatalogValues, ...extractLeadData(maskedMessage), ...pendingCatalogValueData };
      const currentCatalogResolution = publishedCatalog ? resolveIntent(publishedCatalog, maskedMessage, currentCatalogSlotValues) : null;
      const useCatalogContext = Boolean(publishedCatalog && (pendingCatalogIntent || (!currentCatalogResolution?.intentKey && (needsConversationContext(maskedMessage) || leadDataRequested))));
      const recentMessages = intent === null && (needsConversationContext(maskedMessage) || leadDataRequested || useCatalogContext) ? (publishedCatalog ? catalogHistory : await store.listMessages(session.id, session.tenantId, contextWindowMessages + 1)).filter((message) => message.id !== userMessage.id).slice(-contextWindowMessages) : [];
      const conversation = recentMessages.map((message) => ({ role: message.role, content: message.maskedContent }));
      const retrievalQuery = [maskedMessage, ...recentMessages.filter((message) => message.role === 'user').map((message) => message.maskedContent)].join('\n');
      const leadData = mergeLeadData(pendingCatalogValues as LeadData, ...recentMessages.filter((message) => message.role === 'user').map((message) => extractLeadData(message.maskedContent)), currentLeadData);
      const catalogSlotValues = { ...pendingCatalogValues, ...Object.fromEntries(recentMessages.filter((message) => message.role === 'user').flatMap((message) => Object.entries(extractLeadData(message.maskedContent)))), ...extractLeadData(maskedMessage), ...pendingCatalogValueData };
      const leadReady = Boolean(leadData.name && (leadData.email || leadData.phone));
      const catalogResolution = publishedCatalog
        ? useCatalogContext
          ? resolveIntent(publishedCatalog, retrievalQuery, catalogSlotValues)
          : currentCatalogResolution
        : null;
      const consentSlot = publishedCatalog && catalogResolution?.intentKey && catalogResolution.missingSlots.length === 1
        ? publishedCatalog.catalog.slots.find((slot) => slot.intentKey === catalogResolution.intentKey && slot.slotKey === catalogResolution.missingSlots[0])
        : null;
      const consentActionReady = consentSlot?.validationRule === 'boolean:explicit_opt_in' && catalogResolution?.reason === 'missing_slots';
      const legacyLeadIntent = leadRequestedNow || recentMessages.some((message) => message.role === 'user' && hasLeadIntent(message.maskedContent));
      const leadIntent = languageAllowed && (publishedCatalog ? Boolean(catalogResolution?.intentKey) : legacyLeadIntent);
      const catalogSlotsReady = catalogResolution ? catalogResolution.missingSlots.length === 0 : leadReady;
      const leadCollection = leadIntent && !catalogSlotsReady;
       if (!languageAllowed && !conversational) draft = { answer: permittedLanguageReply(language, persona?.permittedLanguages ?? []), citationIds: [], proposedIntent: null };
       else if (catalogResolution?.ambiguous) draft = { answer: 'I can help with that. Are you looking to request a service or arrange a meeting?', citationIds: [], proposedIntent: null };
       else if (publishedCatalog && catalogResolution?.intentKey && catalogResolution.reason === 'below_threshold') draft = { answer: catalogIntentClarification(publishedCatalog, catalogResolution.intentKey), citationIds: [], proposedIntent: null };
       else if (publishedCatalog && catalogResolution?.intentKey && catalogResolution.reason === 'intent_inactive') draft = { answer: 'I can note that request, but the matching workflow is not currently enabled.', citationIds: [], proposedIntent: null };
      else if (consentActionReady) draft = { answer: 'I have the details needed. Please approve the consent action below to register your request.', citationIds: [], proposedIntent: catalogResolution?.intentKey ?? null };
      else if (publishedCatalog && catalogResolution?.intentKey && catalogResolution.missingSlots.length > 0) draft = { answer: catalogSlotQuestion(publishedCatalog, catalogResolution.intentKey, catalogResolution.missingSlots[0] ?? ''), citationIds: [], proposedIntent: null };
      else if (leadIntent && !catalogSlotsReady) draft = { answer: leadCollectionReply(leadData), citationIds: [], proposedIntent: null };
      else if (leadReady || catalogResolution?.actionAllowed) draft = { answer: leadCollectionReply(leadData), citationIds: [], proposedIntent: catalogResolution?.intentKey ?? 'lead.capture' };
      else if (conversational && intent === 'identity') draft = { answer: conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
      else {
        let queryEmbedding: number[];
        try { queryEmbedding = await embedding.embed(retrievalQuery); } catch { throw new HttpError(503, 'EMBEDDING_UNAVAILABLE', 'The assistant is currently unable to search approved knowledge.'); }
        const rows = await store.searchSearchableChunks(session.tenantId, internal ? 'internal' : 'public', queryEmbedding, 24);
        const ranked = rankChunksWithVector(retrievalQuery, rows, queryEmbedding, 4);
        evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: chunk.content }));
        if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null };
        else if (conversational && evidence.length === 0) draft = { answer: intent === 'greeting' && language !== 'ar' ? persona?.greeting ?? conversationalReply(intent, persona?.name ?? 'Sales assistant', language, tenant.name) : conversationalReply(intent ?? 'identity', persona?.name ?? 'Sales assistant', language, tenant.name), citationIds: [], proposedIntent: null };
        else try { const modelInput = { maskedMessage, evidence, personaName: persona?.name ?? 'Sales assistant', ownerName: tenant.name, conversation }; draft = await model.draft(persona ? { ...modelInput, persona } : modelInput); } catch { throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The assistant is currently unable to verify an answer.'); }
      }
      try { assertKnownTokens(session, draft.answer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      const citations = validateCitations(draft, evidence);
      const casualFallback = conversational && (evidence.length === 0 || intent === 'identity');
      const grounded = !casualFallback && !leadCollection && evidence.length > 0 && hasSufficientEvidence(draft.answer, evidence, citations);
       const safeCitations = grounded ? citations : [];
       const leadAnswer = leadCollection || leadReady || consentActionReady || Boolean(catalogResolution?.actionAllowed);
       const answer = !languageAllowed ? draft.answer : casualFallback || leadAnswer ? draft.answer : grounded ? draft.answer : naturalAbstention(language);
       const safeAnswer = casualFallback || leadAnswer ? draft.answer : answer;
      const maskedAnswer = maskPiiForSession(session, safeAnswer, tokenVault);
      try { assertKnownTokens(session, maskedAnswer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      if (intent === 'farewell') session.closedAt = new Date().toISOString();
      await store.updateSession(session);
      const actionLeadData = { ...leadData, ...(catalogResolution?.interest ? { interest: catalogResolution.interest } : {}), ...(consentActionReady ? { contactConsent: false } : (catalogSlotValues as Record<string, string>).contact_consent === 'true' ? { contactConsent: true } : {}) };
      const actionAlreadySubmitted = Boolean(pendingConsentAction && ['approved', 'processing', 'completed'].includes(pendingConsentAction.state));
      const shouldProposeAction = catalogResolution ? !actionAlreadySubmitted && (catalogResolution.actionAllowed || consentActionReady) : draft.proposedIntent === 'lead.capture' && leadIntent && leadReady;
      const action = shouldProposeAction ? await gateway.propose(session.tenantId, session.id, input.clientMessageId, actionLeadData, catalogResolution ? { workflowKey: catalogResolution.workflowKey ?? 'lead.capture', intentKey: catalogResolution.intentKey ?? 'lead.capture', intentScore: catalogResolution.score, intentConfidence: catalogResolution.confidence, catalogVersionId: catalogResolution.catalogVersionId, webhookPath: publishedCatalog?.catalog.workflowBindings.find((binding) => binding.workflowKey === catalogResolution.workflowKey)?.webhookPath ?? 'lead-capture' } : undefined) : null;
      const pendingCatalogState = publishedCatalog && catalogResolution?.intentKey && catalogResolution.missingSlots.length > 0 ? { catalogIntentKey: catalogResolution.intentKey, catalogVersionId: catalogResolution.catalogVersionId, catalogSlotKey: catalogResolution.missingSlots[0], catalogSlotValues } : null;
      const response = { messageId: randomUUID(), sessionId: session.id, answer: rehydrateForSession(session, maskedAnswer, tokenVault), grounded, conversational: casualFallback || leadCollection, citations: safeCitations, actionProposal: action ? { id: action.id, intent: action.workflowKey, consentRequired: consentActionReady, confirmation: consentActionReady ? 'Consent to contact you and register this request.' : 'Your contact request is ready to submit.', expiresAt: new Date(Date.parse(action.createdAt) + 15 * 60_000).toISOString() } : null, requestId: (req as AuthedRequest).requestId ?? randomUUID() };
      const persistedResponse = { ...response, answer: maskedAnswer };
      const estimatedInputTokens = estimateTokens([maskedMessage, ...evidence.map((item) => item.content), persona?.name ?? '', persona?.personality ?? '', persona?.tone ?? '', persona?.speakingStyle ?? ''].join('\n'));
      const estimatedOutputTokens = estimateTokens(maskedAnswer);
      await store.addMessage({ id: response.messageId, sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: maskedAnswer, citations: safeCitations, clientMessageId: null, response: { conversational, ...(pendingCatalogState ?? {}) }, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: persistedResponse });
      await cache.set(responseCacheKey, { messageHash, response: persistedResponse }, chatResponseCacheTtlSeconds);
      recordChatOutcome(session.tenantId, grounded, Boolean(action), estimatedInputTokens, estimatedOutputTokens);
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
      res.json({ action: await gateway.confirm(action.id, action.tenantId) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/actions/:id', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const action = await store.getAction(routeParam(req, 'id')); if (!action) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); const sessionId = req.query.sessionId; if (typeof sessionId !== 'string' || sessionId !== action.sessionId) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.'); const session = await store.getSession(action.sessionId); const tenant = await store.getTenant(action.tenantId); if (!session || session.tenantId !== action.tenantId || !tenant || (channel && channel.tenantId !== action.tenantId)) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); ensureLiveSession(session.lastActivityAt, session.closedAt); if (!getAuth(req) && !channel) { if (!tenant.publicChatEnabled) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); enforcePublicOrigin(req, tenant, nodeEnv); } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== action.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.'); res.json({ action }); } catch (error) { next(error); } });

  app.post('/api/v1/internal/workflow-events/claim', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(workflowClaimSchema, req.body);
      const actions = await store.claimApprovedActions(input.workflowKey, input.limit ?? 10);
      const items = [];
      for (const action of actions) {
        const session = await store.getSession(action.sessionId);
        const version = action.catalogVersionId ? await store.getIntentCatalogVersion(action.tenantId, action.catalogVersionId) : null;
        const intent = version?.catalog.intents.find((item) => item.intentKey === action.intentKey);
        const binding = version?.catalog.workflowBindings.find((item) => item.workflowKey === action.workflowKey);
        const qualityRule = version?.catalog.qualityRules?.find((item) => item.intentKey === action.intentKey);
        const qualityBinding = qualityRule ? version?.catalog.workflowBindings.find((item) => item.workflowKey === qualityRule.qualityWorkflowKey) : null;
        if (!session || !version || !intent || !binding?.active || (qualityRule && !qualityBinding?.active)) {
          const failed = { ...action, state: 'failed' as const, result: null };
          await store.updateAction(failed);
          await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.failed', metadata: { actionId: action.id, workflowKey: action.workflowKey, reason: 'catalog_binding_invalid' }, createdAt: new Date().toISOString() });
          continue;
        }
        const conversation = (await store.listMessages(action.sessionId, action.tenantId)).map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt }));
        items.push({ actionId: action.id, tenantId: action.tenantId, sessionId: action.sessionId, workflowKey: action.workflowKey, contract: input.contract ?? binding.payloadContract, intent: intent.intentKey, intentSummary: `${intent.displayName}: ${intent.description}`, intentScore: action.intentScore ?? 0, intentConfidence: action.intentConfidence ?? 0, catalogVersionId: version.id, qualityWorkflowKey: qualityRule?.qualityWorkflowKey ?? null, idempotencyKey: action.idempotencyKey, opaqueReference: action.opaqueReference, leadData: action.payload, conversation, catalog: version.catalog });
      }
      res.json({ items });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/internal/workflow-events/complete', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(workflowCompletionSchema, req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId || !['approved', 'processing'].includes(action.state)) throw new HttpError(403, 'WORKFLOW_FORBIDDEN', 'Workflow completion does not match the authorized action.');
      const updated = await store.updateAction({ ...action, state: input.state, result: input.state === 'completed' && input.externalReference ? { externalReference: input.externalReference } : null });
      await store.addAudit({ id: randomUUID(), tenantId: input.tenantId, actorId: null, eventName: `workflow.completed.${input.state}`, metadata: { actionId: input.actionId }, createdAt: new Date().toISOString() });
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
      const leadData = { ...(action.payload.name ? { name: action.payload.name } : {}), ...(action.payload.email ? { email: action.payload.email } : {}), ...(action.payload.phone ? { phone: action.payload.phone } : {}), ...(action.payload.interest ? { interest: action.payload.interest } : {}) };
      const consentRequired = Boolean(catalog?.catalog.slots.some((slot) => slot.intentKey === authorizedIntent && slot.required && slot.validationRule === 'boolean:explicit_opt_in'));
      if (consentRequired && action.payload.contactConsent !== true) throw new HttpError(422, 'LEAD_CONSENT_REQUIRED', 'Explicit contact consent is required before creating this lead.');
      const score = (action.payload.name ? 30 : 0) + (action.payload.email ? 40 : 0) + (action.payload.phone ? 40 : 0);
      const validationPass = Boolean(action.payload.name && (action.payload.email || action.payload.phone));
      if (!validationPass || score < 70) throw new HttpError(422, 'LEAD_VALIDATION_FAILED', 'The lead did not pass the completeness threshold.');
      const conversation = messages.map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt }));
      assertKnownTokens(session, JSON.stringify({ leadData, conversation }), tokenVault);
      const existing = await store.getCrmLeadByActionId(input.actionId, input.tenantId);
      if (existing) {
        if (input.completeAction && action.state !== 'completed') await store.updateAction({ ...action, state: 'completed', result: { externalReference: `crm-lead-${existing.id}` } });
        res.json({ lead: existing, externalReference: `crm-lead-${existing.id}` }); return;
      }
      const lead: CrmLead = { id: randomUUID(), tenantId: input.tenantId, actionId: input.actionId, sessionId: input.sessionId, intent: authorizedIntent, intentScore: action.intentScore ?? 0, intentConfidence: action.intentConfidence ?? 0, catalogVersionId: action.catalogVersionId ?? null, score, validationPass, leadData, conversation, summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const created = await store.upsertCrmLead(lead, crmDedupeKey(input.tenantId, leadData, session, tokenVault, vaultSecret));
      await store.linkSessionDocuments(created.sessionId, created.tenantId, created.id);
      if (input.completeAction) await store.updateAction({ ...action, state: 'completed', result: { externalReference: `crm-lead-${created.id}` } });
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
      if (!lead.validationPass || !lead.leadData.name || (!lead.leadData.email && !lead.leadData.phone)) throw new HttpError(422, 'REMOTE_CONTACT_INCOMPLETE', 'The lead has no valid contact data for remote CRM sync.');
      const payload = { name: rehydrate(lead.leadData.name), email: lead.leadData.email ? rehydrate(lead.leadData.email) : '', phone: lead.leadData.phone ? rehydrate(lead.leadData.phone) : '', description: rehydrate(lead.summary ?? `Intent: ${lead.intent}`) };
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
      const input = parse(z.object({ actionId: z.string().uuid(), tenantId: z.string().uuid(), state: z.enum(['completed', 'failed']), externalReference: z.string().refine(isSafeExternalReference, 'An opaque external reference is required.') }), req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const updated = await store.updateAction({ ...action, state: input.state, result: input.state === 'completed' ? { externalReference: input.externalReference } : null });
      await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: `workflow.callback.${input.state}`, metadata: { actionId: action.id }, createdAt: new Date().toISOString() });
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
      const version = await store.getPublishedIntentCatalog(session.tenantId);
      const settings = version?.catalog.documentSettings;
      const binding = settings ? version.catalog.workflowBindings.find((candidate) => candidate.workflowKey === settings.workflowKey && candidate.active) : undefined;
      const policy = version?.catalog.documentPolicies?.find((candidate) => candidate.intentKey === input.primaryIntentKey) ?? version?.catalog.documentPolicies?.find((candidate) => candidate.intentKey === 'anc.document.supporting_upload');
      if (!settings?.enabled || !binding || !policy?.enabled || !policy.allowUserInitiated || !policy.consentRequired) throw new HttpError(409, 'DOCUMENT_WORKFLOW_NOT_AVAILABLE', 'Supporting document intake is not enabled for this tenant yet.');
      if (!settings.allowedMimeTypes.includes(input.mimeType) || !DEFAULT_DOCUMENT_MIME_TYPES.includes(input.mimeType)) throw new HttpError(422, 'DOCUMENT_TYPE_NOT_ALLOWED', 'This document type is not allowed by the published catalog.');
      if (!isValidBase64(input.contentBase64)) throw new HttpError(422, 'DOCUMENT_ENCODING_INVALID', 'The document encoding is invalid.');
      const content = Buffer.from(input.contentBase64, 'base64');
      const maxBytes = Math.min(settings.maxFileBytes, MAX_DOCUMENT_BYTES);
      if (content.length === 0 || content.length > maxBytes) throw new HttpError(413, 'DOCUMENT_TOO_LARGE', 'The document exceeds the published size limit.');
      if (!hasSupportingDocumentSignature(input.mimeType, content)) throw new HttpError(422, 'DOCUMENT_SIGNATURE_INVALID', 'The document content does not match its declared type.');
      const sha256 = documentSha256(content);
      const duplicate = (await store.listSupportingDocuments(session.tenantId, session.id)).find((candidate) => candidate.sha256 === sha256);
      if (duplicate) { res.status(202).json({ accepted: true, idempotent: true, document: publicDocument(duplicate) }); return; }
      const existingLead = await store.getCrmLeadBySessionId(session.id, session.tenantId);
      const documentId = randomUUID();
      const storageKey = documentStorage.key(session.tenantId, documentId, input.mimeType);
      await documentStorage.write(storageKey, content);
      const createdAt = new Date().toISOString();
      const document: SupportingDocument = { id: documentId, tenantId: session.tenantId, sessionId: session.id, leadId: existingLead?.id ?? null, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: content.length, sha256, storageKey, status: 'queued', workflowKey: binding.workflowKey, storeExtractedText: policy.storeExtractedText, extractedText: null, summary: null, errorCode: null, consentAt: createdAt, createdAt, updatedAt: createdAt };
      const job: DocumentProcessingJob = { id: randomUUID(), documentId, tenantId: session.tenantId, workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, status: 'queued', attempts: 0, leaseExpiresAt: null, executionReference: null, createdAt, updatedAt: createdAt };
      try { await store.createSupportingDocumentWithJob(document, job); } catch (error) { await documentStorage.purge(storageKey); throw error; }
      await store.addAudit({ id: randomUUID(), tenantId: session.tenantId, actorId: null, eventName: 'document.uploaded', metadata: { documentId, jobId: job.id, workflowKey: job.workflowKey, bytes: content.length }, createdAt });
      void dispatchDocumentWorkflow(job, binding.payloadContract);
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
  app.get('/api/v1/chat/sessions/:id', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const session = await store.getSession(routeParam(req, 'id')); if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); ensureLiveSession(session.lastActivityAt, session.closedAt); const tenant = await store.getTenant(session.tenantId); if (!tenant) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (channel && channel.tenantId !== session.tenantId) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (!getAuth(req) && !channel) { if (tenant.status !== 'active' || !tenant.publicChatEnabled) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); enforcePublicOrigin(req, tenant, nodeEnv); } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.'); const { limit } = parse(historyQuerySchema, req.query); res.json({ sessionId: session.id, tenantId: session.tenantId, createdAt: session.createdAt, messages: (await store.listMessages(session.id, session.tenantId, limit)).map((message) => ({ id: message.id, role: message.role, content: message.role === 'assistant' ? rehydrateForSession(session, message.maskedContent, tokenVault) : message.maskedContent, citations: message.citations, conversational: message.response?.conversational === true, clientMessageId: message.clientMessageId, createdAt: message.createdAt })) }); } catch (error) { next(error); } });

  app.get('/api/v1/admin/workflow-runs', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listActions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/crm/leads', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); res.json({ items: await Promise.all((await store.listCrmLeads(tenantId)).map(crmLeadForAdmin)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/audit', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listAudit(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/chat/config', chatApi, async (req, res, next) => { try { const channel = getChannel(req); const tenantSlug = typeof req.query.tenantSlug === 'string' ? req.query.tenantSlug : ''; if (channel && tenantSlug) throw new HttpError(400, 'CHANNEL_TENANT_INPUT_FORBIDDEN', 'Channel credentials resolve the tenant from the channel key.'); const tenant = channel ? await store.getTenant(channel.tenantId) : await store.getTenantBySlug(tenantSlug); if (!tenant || tenant.status !== 'active' || (!channel && !tenant.publicChatEnabled)) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (channel && channel.tenantId !== tenant.id) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (getAuth(req) && !ensureTenant(req, tenant.id)) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (!getAuth(req) && !channel) enforcePublicOrigin(req, tenant, nodeEnv); const persona = await store.getPersona(tenant.id); res.json({ tenant: { slug: tenant.slug, name: tenant.name }, persona: persona ? { name: persona.name, greeting: persona.greeting, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages, voiceName: persona.voiceName, voiceLanguage: persona.voiceLanguage, voiceRate: persona.voiceRate, voicePitch: persona.voicePitch, voiceVolume: persona.voiceVolume } : null, documents: await documentConfig(tenant.id) }); } catch (error) { next(error); } });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as AuthedRequest).requestId ?? randomUUID();
    if (res.headersSent) { next(error); return; }
    if (errorType(error) === 'entity.too.large') { res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.', requestId } }); return; }
    if (errorType(error) === 'entity.parse.failed') { res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } }); return; }
    if (errorCode(error) === '23505') { res.status(409).json({ error: { code: 'RESOURCE_CONFLICT', message: 'The requested resource already exists.', requestId } }); return; }
    if (errorCode(error) === '22P02') { res.status(400).json({ error: { code: 'INVALID_DATA', message: 'The request contains invalid data.', requestId } }); return; }
    console.error(JSON.stringify({ event: 'api.unhandled_error', requestId, type: errorType(error), code: errorCode(error), message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
  });
  return { app, store, auth, gateway, workflow };
};

export const createDefaultApp = () => createApp({});

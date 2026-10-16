import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { ActionGateway, MockWorkflowAdapter, isSafeExternalReference, leadQuality, verifyN8nPayload, type WorkflowAdapter } from './actions.js';
import { AuthService, authMiddleware, ensureTenant, requireRoles, type AuthedRequest } from './auth.js';
import { cacheKey, createCache, type CacheStore } from './cache.js';
import { buildChunksWithEmbeddings, buildIngestionChunksWithEmbeddings, hasConflictingEvidence, rankChunksWithVector } from './knowledge.js';
import { DeterministicEmbeddingProvider, type EmbeddingProvider } from './embedding.js';
import { conversationalIntent, conversationalReply, DeterministicGroundedModel, extractLeadData, hasLeadIntent, hasSufficientEvidence, isPermittedLanguage, leadCollectionReply, mergeLeadData, naturalAbstention, needsConversationContext, validateCitations, type ChatModel, type ModelDraft, type ModelEvidence } from './model.js';
import { assertKnownTokens, maskPii, maskPiiForSession, rehydrateForSession, sanitizeKnowledgeText, saveTokens, TokenVault } from './privacy.js';
import { MemoryStore, contentHash } from './store-memory.js';
import { hasValidFileSignature, IngestionStaging, MAX_INGESTION_FILE_BYTES } from './ingestion-staging.js';
import type { CrmLead, Message, Session, SourceStatus, Store, TenantStatus } from './types.js';

type Telemetry = { requests: number; serverErrors: number; totalLatencyMs: number; lastRequestAt: string | null; chatResponses: number; groundedResponses: number; abstentions: number; actionProposals: number; estimatedInputTokens: number; estimatedOutputTokens: number; estimatedCostUsd: number | null };
export type RateLimitEntry = { count: number; resetAt: number };
export const pruneExpiredRateLimits = (entries: Map<string, RateLimitEntry>, now = Date.now()): void => {
  for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
};

const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/\d/, 'Password must contain a number.');
const tenantSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(80), adminEmail: z.string().email(), adminPassword: passwordSchema });
const memberSchema = z.object({ email: z.string().email(), password: passwordSchema, role: z.enum(['tenant_editor', 'tenant_viewer', 'tenant_agent']) });
const domainSchema = z.object({ hostname: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'A valid hostname is required.') });
const channelSchema = z.object({ publicOrigin: z.union([z.literal(''), z.string().url().refine((value) => { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.hash; }, 'A public origin must be an HTTP(S) origin without a path.')]), publicChatEnabled: z.boolean().optional() });
const safePersonaText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/\b(ignore (?:all )?rules|system prompt|search the web|reveal secrets|bypass security)\b/i.test(value), 'Persona contains an unsafe instruction.');
const DEFAULT_CONTEXT_WINDOW_MESSAGES = 10;
const personaSchema = z.object({ name: safePersonaText(80), greeting: safePersonaText(500), personality: safePersonaText(500), tone: safePersonaText(200), speakingStyle: safePersonaText(200), permittedLanguages: z.array(z.string().min(2).max(12)).min(1).max(10), contextWindowMessages: z.coerce.number().int().min(1).max(DEFAULT_CONTEXT_WINDOW_MESSAGES).default(DEFAULT_CONTEXT_WINDOW_MESSAGES) });
const personaPreviewSchema = personaSchema.extend({ message: z.string().trim().min(1).max(4000) });
const sourceSchema = z.object({ title: z.string().trim().min(1).max(200), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']), sourceUrl: z.string().url().optional(), audience: z.enum(['public', 'internal']).default('public'), content: z.string().trim().min(1).max(200_000) });
const uploadSchema = z.object({ title: z.string().trim().min(1).max(200), fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']), audience: z.enum(['public', 'internal']).default('public'), contentBase64: z.string().min(1).max(7_000_000) });
const ingestionRequestSchema = sourceSchema.omit({ content: true });
const ingestionResultSchema = z.object({
  normalizedContent: z.string().min(1).max(200_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string().trim().min(1).max(120),
  chunks: z.array(z.object({ ordinal: z.number().int().nonnegative(), locator: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(20_000), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(2_000),
});
const ingestionFailureSchema = z.object({ errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,80}$/).default('INGESTION_FAILED') });
const sessionSchema = z.object({ tenantId: z.string().uuid().optional(), tenantSlug: z.string().regex(/^[a-z0-9-]+$/).optional() }).refine((value) => Boolean(value.tenantId || value.tenantSlug), 'tenantId or tenantSlug is required.');
const messageSchema = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(4000), clientMessageId: z.string().trim().min(1).max(128) });
const confirmSchema = z.object({ sessionId: z.string().uuid(), confirmed: z.literal(true) });
const retentionSchema = z.object({ before: z.string().datetime() });
const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const leadTokenSchema = z.string().regex(/^\[(?:NAME|EMAIL|PHONE)_\d+\]$/);
const crmLeadSchema = z.object({
  actionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  leadData: z.object({ name: leadTokenSchema.optional(), email: leadTokenSchema.optional(), phone: leadTokenSchema.optional() }).strict(),
  intent: z.string().trim().min(1).max(80),
  score: z.number().int().min(0).max(100),
  validationPass: z.boolean(),
  conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000), createdAt: z.string().datetime() })).min(1).max(200)
});
const crmSummarySchema = z.object({ tenantId: z.string().uuid(), summary: z.string().trim().min(1).max(20_000), status: z.enum(['completed', 'failed']) });

const publicUser = (user: { id: string; email: string; role: string; tenantId: string | null }) => ({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = 'HttpError'; }
}

const errorProperty = (error: unknown, property: string): unknown => typeof error === 'object' && error !== null && property in error ? error[property as keyof typeof error] : undefined;
const errorType = (error: unknown): string | undefined => { const value = errorProperty(error, 'type'); return typeof value === 'string' ? value : undefined; };
const errorCode = (error: unknown): string | undefined => { const value = errorProperty(error, 'code'); return typeof value === 'string' ? value : undefined; };

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
  if (!getAuth(req) && !tenant.publicChatEnabled) throw new HttpError(423, 'TENANT_UNAVAILABLE', 'This tenant is not accepting public chat.');
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

export interface AppDependencies {
  store?: Store;
  model?: ChatModel;
  workflow?: WorkflowAdapter;
  jwtSecret?: string;
  nodeEnv?: string;
  tokenVault?: TokenVault;
  embedding?: EmbeddingProvider;
  n8nCallbackSecret?: string;
  ingestionWorkerSecret?: string;
  ingestionStagingRoot?: string;
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
  const workflow = dependencies.workflow ?? new MockWorkflowAdapter();
  const nodeEnv = dependencies.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const jwtSecret = dependencies.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only-change-me';
  const vaultSecret = process.env.PII_VAULT_KEY ?? 'local-development-pii-vault-key';
  if (nodeEnv === 'production' && ((!dependencies.jwtSecret && !process.env.JWT_SECRET) || (!dependencies.tokenVault && !process.env.PII_VAULT_KEY))) throw new Error('Production JWT_SECRET and PII_VAULT_KEY are required.');
  const tokenVault = dependencies.tokenVault ?? new TokenVault(vaultSecret);
  const embedding = dependencies.embedding ?? new DeterministicEmbeddingProvider();
  const n8nCallbackSecret = dependencies.n8nCallbackSecret ?? process.env.N8N_WEBHOOK_SECRET ?? '';
  const ingestionWorkerSecret = dependencies.ingestionWorkerSecret ?? process.env.INGESTION_WORKER_SECRET ?? '';
  const ingestionStaging = new IngestionStaging(dependencies.ingestionStagingRoot ?? process.env.INGESTION_STAGING_ROOT ?? join(process.cwd(), 'data', 'ingestion-staging'));
  const chatSessionTtlMs = dependencies.chatSessionTtlMs ?? Number(process.env.CHAT_SESSION_TTL_MS ?? 10 * 60 * 1000);
  const readRate = (value: number | undefined, name: string): number | null => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return null; const parsed = Number(raw); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number.`); return parsed; };
  const inputCostUsdPerMillion = readRate(dependencies.inputCostUsdPerMillion, 'MODEL_INPUT_COST_USD_PER_MILLION');
  const outputCostUsdPerMillion = readRate(dependencies.outputCostUsdPerMillion, 'MODEL_OUTPUT_COST_USD_PER_MILLION');
  const readCacheTtl = (value: number | undefined, name: string, fallback: number, max: number): number => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${name} must be an integer between 0 and ${max}.`); return parsed; };
  const readRateLimit = (value: number | undefined, name: string, fallback: number, max: number): number => { const raw = value ?? process.env[name]; if (raw === undefined || raw === '') return fallback; const parsed = Number(raw); if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${name} must be an integer between 1 and ${max}.`); return parsed; };
  const chatResponseCacheTtlSeconds = readCacheTtl(dependencies.chatResponseCacheTtlSeconds, 'CHAT_RESPONSE_CACHE_TTL_SECONDS', 60, 300);
  const rateLimitMax = readRateLimit(dependencies.rateLimitMax, 'API_RATE_LIMIT_MAX', nodeEnv === 'development' ? 600 : 120, 100_000);
  const rateLimitWindowMs = readRateLimit(dependencies.rateLimitWindowMs, 'API_RATE_LIMIT_WINDOW_MS', 60_000, 3_600_000);
  if (nodeEnv === 'production' && (!dependencies.model || !dependencies.embedding || !dependencies.workflow || !n8nCallbackSecret || !ingestionWorkerSecret)) throw new Error('Production Azure, embedding, workflow, callback and ingestion adapters are required.');
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
    if (origin && allowed.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('access-control-allow-headers', 'content-type,authorization,x-request-id,x-tenant-id'); res.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS'); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') { res.status(origin && allowed.has(origin) ? 204 : 403).end(); return; }
    next();
  });
  // shortcut: one bounded JSON parser supports local 5 MiB base64 uploads; replace with streaming/object storage before production.
  app.use(express.json({ limit: '8mb' }));
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

  const crmLeadForAdmin = async (lead: CrmLead): Promise<CrmLead & { quality: ReturnType<typeof leadQuality> }> => {
    const session = await store.getSession(lead.sessionId);
    if (!session) return { ...lead, quality: leadQuality(lead.score) };
    const rehydrate = (value: string): string => rehydrateForSession(session, value, tokenVault);
    return { ...lead, quality: leadQuality(lead.score), leadData: { ...(lead.leadData.name ? { name: rehydrate(lead.leadData.name) } : {}), ...(lead.leadData.email ? { email: rehydrate(lead.leadData.email) } : {}), ...(lead.leadData.phone ? { phone: rehydrate(lead.leadData.phone) } : {}) }, conversation: lead.conversation.map((message) => ({ ...message, content: rehydrate(message.content) })), summary: lead.summary ? rehydrate(lead.summary) : null };
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

  app.post('/api/v1/auth/logout', protectedApi, async (req, res) => { const token = req.header('authorization')?.slice(7); if (token) await auth.revoke(token); res.status(204).send(); });
  app.get('/api/v1/auth/me', protectedApi, (req, res) => { const current = getAuth(req); if (!current) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }); return; } res.json({ user: current }); });

  app.post('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try {
      const input = parse(tenantSchema, req.body);
      if (await store.getTenantBySlug(input.slug)) throw new HttpError(409, 'TENANT_EXISTS', 'Tenant slug already exists.');
      if (await store.getUserByEmail(input.adminEmail)) throw new HttpError(409, 'USER_EXISTS', 'Admin email already exists.');
      const tenant = await store.createTenant({ name: input.name, slug: input.slug });
      const user = await store.createUser({ email: input.adminEmail, passwordHash: await auth.hashPassword(input.adminPassword), role: 'tenant_admin', tenantId: tenant.id });
      await store.setPersona({ tenantId: tenant.id, name: 'Sales assistant', greeting: 'How can I help?', personality: 'Helpful and precise.', tone: 'Clear', speakingStyle: 'Concise', permittedLanguages: ['en'], contextWindowMessages: DEFAULT_CONTEXT_WINDOW_MESSAGES });
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
  app.get('/api/v1/admin/dashboard/overview', protectedApi, async (req, res, next) => { try { res.json({ tenantId: await tenantForRequest(store, req), metrics: await store.getTenantStats(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/retention/purge-sessions', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      const before = parse(retentionSchema, req.body).before;
      if (Date.parse(before) > Date.now()) throw new HttpError(422, 'INVALID_RETENTION_CUTOFF', 'Retention cutoff must be in the past.');
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
          workflow: { status: dependencies.workflow ? 'ok' : 'adapter' },
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
          workflow: { status: dependencies.workflow ? 'ok' : 'adapter' },
          ingestion: { status: ingestionWorkerSecret ? 'ok' : 'ready' }
        }
      });
    }
  });

  app.put('/api/v1/admin/persona', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); const version = await store.createPersonaVersion({ tenantId, ...input, contextWindowMessages: input.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, status: 'draft' }); await store.publishPersonaVersion(tenantId, version.id); const persona = await store.getPersona(tenantId); res.json({ persona }); } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/tenants/:tenantId/persona', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const tenant = await store.getTenant(routeParam(req, 'tenantId')); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (tenant.status === 'archived') throw new HttpError(423, 'TENANT_ARCHIVED', 'Archived tenants cannot be managed.'); res.json({ persona: await store.getPersona(tenant.id) }); } catch (error) { next(error); }
  });
  app.put('/api/v1/admin/tenants/:tenantId/persona', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const tenant = await store.getTenant(routeParam(req, 'tenantId')); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (tenant.status === 'archived') throw new HttpError(423, 'TENANT_ARCHIVED', 'Archived tenants cannot be managed.'); const input = parse(personaSchema, req.body); const version = await store.createPersonaVersion({ tenantId: tenant.id, ...input, contextWindowMessages: input.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, status: 'draft' }); await store.publishPersonaVersion(tenant.id, version.id); const persona = await store.getPersona(tenant.id); await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: 'persona.platform_updated', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() }); res.json({ persona }); } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/persona', protectedApi, async (req, res, next) => { try { res.json({ persona: await store.getPersona(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/drafts', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); res.status(201).json({ version: await store.createPersonaVersion({ tenantId, ...input, contextWindowMessages: input.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES, status: 'draft' }) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/persona/versions', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listPersonaVersions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/versions/:id/publish', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const version = await store.publishPersonaVersion(tenantId, routeParam(req, 'id')); if (!version) throw new HttpError(404, 'PERSONA_VERSION_NOT_FOUND', 'Persona version not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'persona.published', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() }); res.json({ version }); } catch (error) { next(error); } });

  app.post('/api/v1/admin/persona/preview', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(personaPreviewSchema, req.body);
      const masked = maskPii(input.message);
      const previewSession = { id: randomUUID(), tenantId, createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
      saveTokens(previewSession, masked.tokens, tokenVault);
      const queryEmbedding = await embedding.embed(masked.masked);
      const ranked = rankChunksWithVector(masked.masked, await store.searchSearchableChunks(tenantId, 'internal', queryEmbedding, 4), queryEmbedding, 4);
      const evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: chunk.content }));
      const languageAllowed = isPermittedLanguage(masked.masked, input.permittedLanguages);
      let draft: ModelDraft;
      if (!languageAllowed) draft = { answer: `I can only answer in the permitted languages: ${input.permittedLanguages.join(', ')}.`, citationIds: [], proposedIntent: null };
      else if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null };
      else draft = await model.draft({ maskedMessage: masked.masked, evidence, personaName: input.name, persona: input });
      assertKnownTokens(previewSession, draft.answer, tokenVault);
      const citations = validateCitations(draft, evidence);
      const grounded = languageAllowed && hasSufficientEvidence(draft.answer, evidence, citations);
      const safeCitations = grounded ? citations : [];
      const answer = !languageAllowed ? draft.answer : grounded ? draft.answer : naturalAbstention();
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
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) throw new HttpError(422, 'INVALID_FILE_ENCODING', 'The file content must be valid base64.');
      const content = Buffer.from(input.contentBase64, 'base64');
      if (content.length === 0 || content.length > MAX_INGESTION_FILE_BYTES || content.toString('base64').replace(/=+$/, '') !== input.contentBase64.replace(/=+$/, '')) throw new HttpError(422, 'INVALID_FILE_CONTENT', 'The file is empty, malformed or exceeds the 5 MiB limit.');
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

  app.post('/api/v1/chat/sessions', optionalApi, async (req, res, next) => {
    try {
      const input = parse(sessionSchema, req.body);
      if (input.tenantId && !getAuth(req)) throw new HttpError(403, 'TENANT_REQUIRED', 'Public sessions must use an approved tenant slug.');
      const tenant = input.tenantId ? await store.getTenant(input.tenantId) : await store.getTenantBySlug(input.tenantSlug ?? '');
      if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
      if (!ensureTenant(req, tenant.id) && getAuth(req)?.role !== undefined) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.');
      if (!getAuth(req)) enforcePublicOrigin(req, tenant, nodeEnv);
      if (tenant.status !== 'active') throw new HttpError(423, 'TENANT_UNAVAILABLE', 'This tenant is not accepting public chat.');
      enforcePublicChatEnabled(req, tenant);
      const publishedPersona = (await store.listPersonaVersions(tenant.id)).find((version) => version.status === 'published');
      const session = await store.createSession(tenant.id, publishedPersona?.id ?? null);
      res.status(201).json({ sessionId: session.id, tenantId: tenant.id, createdAt: session.createdAt });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/messages', optionalApi, async (req, res, next) => {
    let pendingMessage: Message | null = null;
    try {
      const input = parse(messageSchema, req.body);
      const session = await store.getSession(input.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      const tenant = await activeTenant(store, session.tenantId);
      if (!getAuth(req)) enforcePublicOrigin(req, tenant, nodeEnv);
      enforcePublicChatEnabled(req, tenant);
      if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
      const masked = maskPii(input.message);
      const responseCacheKey = cacheKey('chat-response', session.tenantId, session.id, input.clientMessageId);
      const cachedResponse = await cache.get<Record<string, unknown>>(responseCacheKey);
      if (cachedResponse && typeof cachedResponse.answer === 'string') { res.json(rehydrateStoredResponse(session, cachedResponse)); return; }
      const durableDuplicate = await store.getMessageByClientId(session.id, input.clientMessageId);
      const retryableDuplicate = durableDuplicate?.response?.retryable === true;
      if (durableDuplicate?.response && !retryableDuplicate) { res.json(rehydrateStoredResponse(session, durableDuplicate.response)); return; }
      if (durableDuplicate && !retryableDuplicate) throw new HttpError(409, 'MESSAGE_IN_PROGRESS', 'A request with this client message ID is already being processed.');
      if (durableDuplicate && durableDuplicate.maskedContent !== masked.masked) throw new HttpError(409, 'MESSAGE_RETRY_MISMATCH', 'Retry must use the original message content.');
      saveTokens(session, masked.tokens, tokenVault);
      session.lastActivityAt = new Date().toISOString();
      await store.updateSession(session);
      const userMessage = durableDuplicate ?? await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: session.tenantId, role: 'user', maskedContent: masked.masked, citations: [], clientMessageId: input.clientMessageId, response: null, createdAt: new Date().toISOString() });
      pendingMessage = userMessage;
      const internal = ensureTenant(req, session.tenantId) && getAuth(req)?.role !== undefined;
      const persona = session.personaVersionId
        ? await store.getPersonaVersion(session.tenantId, session.personaVersionId)
        : await store.getPersona(session.tenantId);
      const languageAllowed = !persona || isPermittedLanguage(masked.masked, persona.permittedLanguages);
      const intent = conversationalIntent(masked.masked);
      const conversational = intent !== null && languageAllowed;
      const leadRequestedNow = hasLeadIntent(masked.masked);
      const leadDataRequested = leadRequestedNow || /\[(?:NAME|EMAIL|PHONE)_\d+\]/u.test(masked.masked) || /\b(?:my name is|i am|i'm)\b/i.test(input.message);
      const contextWindowMessages = persona?.contextWindowMessages ?? DEFAULT_CONTEXT_WINDOW_MESSAGES;
      let evidence: ModelEvidence[] = [];
      let draft: ModelDraft;
      const recentMessages = intent === null && (needsConversationContext(masked.masked) || leadDataRequested) ? (await store.listMessages(session.id, session.tenantId, contextWindowMessages + 1)).filter((message) => message.id !== userMessage.id).slice(-contextWindowMessages) : [];
      const conversation = recentMessages.map((message) => ({ role: message.role, content: message.maskedContent }));
      const retrievalQuery = [masked.masked, ...recentMessages.filter((message) => message.role === 'user').map((message) => message.maskedContent)].join('\n');
      const leadIntent = languageAllowed && (leadRequestedNow || recentMessages.some((message) => message.role === 'user' && hasLeadIntent(message.maskedContent)));
      const leadData = mergeLeadData(...recentMessages.filter((message) => message.role === 'user').map((message) => extractLeadData(message.maskedContent)), extractLeadData(masked.masked));
      const leadReady = Boolean(leadData.name && (leadData.email || leadData.phone));
      const leadCollection = leadIntent;
      if (conversational) draft = { answer: intent === 'greeting' ? persona?.greeting ?? conversationalReply(intent, persona?.name ?? 'Sales assistant') : conversationalReply(intent ?? 'identity', persona?.name ?? 'Sales assistant'), citationIds: [], proposedIntent: null };
      else if (!languageAllowed) draft = { answer: `I can only answer in the permitted languages: ${persona?.permittedLanguages.join(', ')}.`, citationIds: [], proposedIntent: null };
      else if (leadIntent && !leadReady) draft = { answer: leadCollectionReply(leadData), citationIds: [], proposedIntent: null };
      else if (leadReady) draft = { answer: leadCollectionReply(leadData), citationIds: [], proposedIntent: 'lead.capture' };
      else {
        let queryEmbedding: number[];
        try { queryEmbedding = await embedding.embed(retrievalQuery); } catch { throw new HttpError(503, 'EMBEDDING_UNAVAILABLE', 'The assistant is currently unable to search approved knowledge.'); }
        const rows = await store.searchSearchableChunks(session.tenantId, internal ? 'internal' : 'public', queryEmbedding, 24);
        const ranked = rankChunksWithVector(retrievalQuery, rows, queryEmbedding, 4);
        evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: chunk.content }));
        if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null };
        else try { const modelInput = { maskedMessage: masked.masked, evidence, personaName: persona?.name ?? 'Sales assistant', conversation }; draft = await model.draft(persona ? { ...modelInput, persona } : modelInput); } catch { throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The assistant is currently unable to verify an answer.'); }
      }
      try { assertKnownTokens(session, draft.answer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      const citations = validateCitations(draft, evidence);
      const grounded = !conversational && !leadCollection && evidence.length > 0 && hasSufficientEvidence(draft.answer, evidence, citations);
      const safeCitations = grounded ? citations : [];
      const answer = !languageAllowed ? draft.answer : conversational || leadCollection ? draft.answer : grounded ? draft.answer : naturalAbstention();
      const safeAnswer = conversational || leadCollection ? draft.answer : answer;
      const maskedAnswer = maskPiiForSession(session, safeAnswer, tokenVault);
      try { assertKnownTokens(session, maskedAnswer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      if (intent === 'farewell') session.closedAt = new Date().toISOString();
      await store.updateSession(session);
      const action = draft.proposedIntent === 'lead.capture' && leadIntent && leadReady ? await gateway.propose(session.tenantId, session.id, input.clientMessageId, leadData) : null;
      const response = { messageId: randomUUID(), sessionId: session.id, answer: rehydrateForSession(session, maskedAnswer, tokenVault), grounded, conversational: conversational || leadCollection, citations: safeCitations, actionProposal: action ? { id: action.id, intent: action.workflowKey, confirmation: 'I have the details I need. Would you like me to submit this contact request?', expiresAt: new Date(Date.parse(action.createdAt) + 15 * 60_000).toISOString() } : null, requestId: (req as AuthedRequest).requestId ?? randomUUID() };
      const persistedResponse = { ...response, answer: maskedAnswer };
      const estimatedInputTokens = estimateTokens([masked.masked, ...evidence.map((item) => item.content), persona?.name ?? '', persona?.personality ?? '', persona?.tone ?? '', persona?.speakingStyle ?? ''].join('\n'));
      const estimatedOutputTokens = estimateTokens(maskedAnswer);
      await store.addMessage({ id: response.messageId, sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: maskedAnswer, citations: safeCitations, clientMessageId: null, response: { conversational }, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: persistedResponse });
      await cache.set(responseCacheKey, persistedResponse, chatResponseCacheTtlSeconds);
      recordChatOutcome(session.tenantId, grounded, Boolean(action), estimatedInputTokens, estimatedOutputTokens);
      res.json(response);
    } catch (error) {
      if (pendingMessage && !pendingMessage.response) {
        try { await store.updateMessage({ ...pendingMessage, response: { retryable: true } }); } catch { /* preserve the original failure response */ }
      }
      next(error);
    }
  });

  app.post('/api/v1/chat/actions/:id/confirm', optionalApi, async (req, res, next) => {
    try {
      const input = parse(confirmSchema, req.body);
      const action = await store.getAction(routeParam(req, 'id'));
      if (!action || action.sessionId !== input.sessionId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const session = await store.getSession(input.sessionId);
      const tenant = await store.getTenant(action.tenantId);
      if (!session || session.tenantId !== action.tenantId || !tenant || (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== action.tenantId)) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.');
      if (!getAuth(req)) { enforcePublicOrigin(req, tenant, nodeEnv); enforcePublicChatEnabled(req, tenant); }
      ensureLiveSession(session.lastActivityAt, session.closedAt);
      await activeTenant(store, action.tenantId);
      res.json({ action: await gateway.confirm(action.id, action.tenantId) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/actions/:id', optionalApi, async (req, res, next) => { try { const action = await store.getAction(routeParam(req, 'id')); if (!action) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); const sessionId = req.query.sessionId; if (typeof sessionId !== 'string' || sessionId !== action.sessionId) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.'); const session = await store.getSession(action.sessionId); const tenant = await store.getTenant(action.tenantId); if (!session || session.tenantId !== action.tenantId || !tenant) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); ensureLiveSession(session.lastActivityAt, session.closedAt); if (!getAuth(req)) { if (!tenant.publicChatEnabled) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); enforcePublicOrigin(req, tenant, nodeEnv); } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== action.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.'); res.json({ action }); } catch (error) { next(error); } });

  app.post('/api/v1/internal/crm/leads', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmLeadSchema, req.body);
      if (!input.validationPass || input.score < 70) throw new HttpError(422, 'LEAD_VALIDATION_FAILED', 'The lead did not pass the completeness threshold.');
      const action = await store.getAction(input.actionId);
      const session = await store.getSession(input.sessionId);
      if (!action || action.tenantId !== input.tenantId || action.sessionId !== input.sessionId || action.workflowKey !== 'lead.capture' || !session || session.tenantId !== input.tenantId) throw new HttpError(403, 'LEAD_FORBIDDEN', 'Lead context does not match the authorized action.');
      assertKnownTokens(session, JSON.stringify({ leadData: input.leadData, conversation: input.conversation }), tokenVault);
      const leadData = { ...(input.leadData.name ? { name: input.leadData.name } : {}), ...(input.leadData.email ? { email: input.leadData.email } : {}), ...(input.leadData.phone ? { phone: input.leadData.phone } : {}) };
      const existing = await store.getCrmLeadByActionId(input.actionId, input.tenantId);
      if (existing) { res.json({ lead: existing, externalReference: `crm-lead-${existing.id}` }); return; }
      const lead: CrmLead = { id: randomUUID(), tenantId: input.tenantId, actionId: input.actionId, sessionId: input.sessionId, intent: input.intent, score: input.score, validationPass: input.validationPass, leadData, conversation: input.conversation, summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const created = await store.createCrmLead(lead);
      await store.addAudit({ id: randomUUID(), tenantId: created.tenantId, actorId: null, eventName: 'crm.lead_created', metadata: { leadId: created.id, intent: created.intent, score: created.score, validationPass: created.validationPass }, createdAt: new Date().toISOString() });
      res.status(201).json({ lead: created, externalReference: `crm-lead-${created.id}` });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/internal/crm/leads/:id/summary', n8nInternalApi, async (req, res, next) => {
    try {
      const input = parse(crmSummarySchema, req.body);
      const lead = await store.getCrmLead(routeParam(req, 'id'), input.tenantId);
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      const session = await store.getSession(lead.sessionId);
      if (session) assertKnownTokens(session, input.summary, tokenVault);
      const updated = await store.updateCrmLeadSummary(lead.id, input.tenantId, input.summary, input.status);
      if (!updated) throw new HttpError(404, 'LEAD_NOT_FOUND', 'CRM lead not found.');
      res.json({ lead: updated });
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

  app.get('/api/v1/chat/sessions/:id', optionalApi, async (req, res, next) => { try { const session = await store.getSession(routeParam(req, 'id')); if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); ensureLiveSession(session.lastActivityAt, session.closedAt); const tenant = await store.getTenant(session.tenantId); if (!tenant) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); if (!getAuth(req)) { if (tenant.status !== 'active' || !tenant.publicChatEnabled) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.'); enforcePublicOrigin(req, tenant, nodeEnv); } else if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.'); const { limit } = parse(historyQuerySchema, req.query); res.json({ sessionId: session.id, tenantId: session.tenantId, createdAt: session.createdAt, messages: (await store.listMessages(session.id, session.tenantId, limit)).map((message) => ({ id: message.id, role: message.role, content: message.role === 'assistant' ? rehydrateForSession(session, message.maskedContent, tokenVault) : message.maskedContent, citations: message.citations, conversational: message.response?.conversational === true, clientMessageId: message.clientMessageId, createdAt: message.createdAt })) }); } catch (error) { next(error); } });

  app.get('/api/v1/admin/workflow-runs', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listActions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/crm/leads', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); res.json({ items: await Promise.all((await store.listCrmLeads(tenantId)).map(crmLeadForAdmin)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/audit', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listAudit(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/chat/config', optionalApi, async (req, res, next) => { try { const tenantSlug = typeof req.query.tenantSlug === 'string' ? req.query.tenantSlug : ''; const tenant = await store.getTenantBySlug(tenantSlug); if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (getAuth(req) && !ensureTenant(req, tenant.id)) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.'); if (!getAuth(req)) enforcePublicOrigin(req, tenant, nodeEnv); const persona = await store.getPersona(tenant.id); res.json({ tenant: { slug: tenant.slug, name: tenant.name }, persona: persona ? { name: persona.name, greeting: persona.greeting, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages } : null }); } catch (error) { next(error); } });

  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as AuthedRequest).requestId ?? randomUUID();
    if (res.headersSent) { next(error); return; }
    if (errorType(error) === 'entity.too.large') { res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.', requestId } }); return; }
    if (errorType(error) === 'entity.parse.failed') { res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.', requestId } }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } }); return; }
    if (errorCode(error) === '23505') { res.status(409).json({ error: { code: 'RESOURCE_CONFLICT', message: 'The requested resource already exists.', requestId } }); return; }
    if (errorCode(error) === '22P02') { res.status(400).json({ error: { code: 'INVALID_DATA', message: 'The request contains invalid data.', requestId } }); return; }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
  });
  return { app, store, auth, gateway, workflow };
};

export const createDefaultApp = () => createApp({});

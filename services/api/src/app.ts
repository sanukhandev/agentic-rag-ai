import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ActionGateway, MockWorkflowAdapter, verifyN8nPayload, type WorkflowAdapter } from './actions.js';
import { AuthService, authMiddleware, ensureTenant, requireRoles, type AuthedRequest } from './auth.js';
import { buildChunksWithEmbeddings, hasConflictingEvidence, rankChunksWithEmbedding } from './knowledge.js';
import { DeterministicEmbeddingProvider, type EmbeddingProvider } from './embedding.js';
import { DeterministicGroundedModel, validateCitations, type ChatModel, type ModelDraft } from './model.js';
import { assertKnownTokens, maskPii, rehydrateForSession, sanitizeKnowledgeText, saveTokens, TokenVault } from './privacy.js';
import { MemoryStore, contentHash } from './store-memory.js';
import type { SourceStatus, Store, TenantStatus } from './types.js';

const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/\d/, 'Password must contain a number.');
const tenantSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(80), adminEmail: z.string().email(), adminPassword: passwordSchema });
const safePersonaText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/\b(ignore (?:all )?rules|system prompt|search the web|reveal secrets|bypass security)\b/i.test(value), 'Persona contains an unsafe instruction.');
const personaSchema = z.object({ name: safePersonaText(80), greeting: safePersonaText(500), personality: safePersonaText(500), tone: safePersonaText(200), speakingStyle: safePersonaText(200), permittedLanguages: z.array(z.string().min(2).max(12)).min(1).max(10) });
const sourceSchema = z.object({ title: z.string().trim().min(1).max(200), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']), sourceUrl: z.string().url().optional(), audience: z.enum(['public', 'internal']).default('public'), content: z.string().trim().min(1).max(200_000) });
const sessionSchema = z.object({ tenantId: z.string().uuid().optional(), tenantSlug: z.string().regex(/^[a-z0-9-]+$/).optional() }).refine((value) => Boolean(value.tenantId || value.tenantSlug), 'tenantId or tenantSlug is required.');
const messageSchema = z.object({ sessionId: z.string().uuid(), message: z.string().trim().min(1).max(4000), clientMessageId: z.string().trim().min(1).max(128) });
const confirmSchema = z.object({ sessionId: z.string().uuid(), confirmed: z.literal(true) });

const publicUser = (user: { id: string; email: string; role: string; tenantId: string | null }) => ({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId });

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(422, 'VALIDATION_ERROR', result.error.issues.map((issue) => issue.message).join(' '));
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
  if (!auth?.tenantId) throw new HttpError(403, 'TENANT_REQUIRED', 'A tenant-scoped identity is required.');
  return auth.tenantId;
};

const activeTenant = async (store: Store, tenantId: string) => {
  const tenant = await store.getTenant(tenantId);
  if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
  if (tenant.status !== 'active') throw new HttpError(423, 'TENANT_SUSPENDED', 'This tenant is not accepting new activity.');
  return tenant;
};

export interface AppDependencies {
  store?: Store;
  model?: ChatModel;
  workflow?: WorkflowAdapter;
  jwtSecret?: string;
  nodeEnv?: string;
  tokenVault?: TokenVault;
  embedding?: EmbeddingProvider;
  n8nCallbackSecret?: string;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

export const createApp = (dependencies: AppDependencies = {}) => {
  const store = dependencies.store ?? new MemoryStore();
  const model = dependencies.model ?? new DeterministicGroundedModel();
  const workflow = dependencies.workflow ?? new MockWorkflowAdapter();
  const tokenVault = dependencies.tokenVault ?? new TokenVault(process.env.PII_VAULT_KEY ?? 'local-development-pii-vault-key');
  const embedding = dependencies.embedding ?? new DeterministicEmbeddingProvider();
  const n8nCallbackSecret = dependencies.n8nCallbackSecret ?? process.env.N8N_WEBHOOK_SECRET ?? '';
  const auth = new AuthService(store, dependencies.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only-change-me');
  const gateway = new ActionGateway(store, workflow);
  const app = express();
  const responseCache = new Map<string, unknown>();
  const callbackNonces = new Map<string, number>();
  const rateLimits = new Map<string, { count: number; resetAt: number }>();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '300kb' }));
  app.use((req: AuthedRequest, res: Response, next: NextFunction) => { req.requestId = req.header('x-request-id') ?? randomUUID(); res.setHeader('x-request-id', req.requestId); next(); });
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) { next(); return; }
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const current = rateLimits.get(key);
    const limit = dependencies.rateLimitMax ?? 120;
    const windowMs = dependencies.rateLimitWindowMs ?? 60_000;
    const entry = !current || current.resetAt <= now ? { count: 1, resetAt: now + windowMs } : { count: current.count + 1, resetAt: current.resetAt };
    rateLimits.set(key, entry);
    if (entry.count > limit) { res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }); return; }
    next();
  });

  app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_req, res) => {
    try { await store.countUsers(); res.json({ status: 'ready', store: 'available' }); } catch { res.status(503).json({ status: 'not_ready' }); }
  });

  app.post('/api/v1/auth/register-platform', async (req, res, next) => {
    try {
      if ((dependencies.nodeEnv ?? process.env.NODE_ENV ?? 'development') === 'production') throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      if (await store.countUsers() > 0) throw new HttpError(409, 'BOOTSTRAP_COMPLETE', 'Platform bootstrap is already complete.');
      const input = parse(z.object({ email: z.string().email(), password: passwordSchema }), req.body);
      const user = await store.createUser({ email: input.email, passwordHash: await auth.hashPassword(input.password), role: 'platform_admin', tenantId: null });
      res.status(201).json({ token: auth.issue(user), user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/auth/login', async (req, res, next) => {
    try {
      const input = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
      const user = await store.getUserByEmail(input.email);
      if (!user || !(await auth.verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      res.json({ token: auth.issue(user), user: publicUser(user) });
    } catch (error) { next(error); }
  });

  const protectedApi = authMiddleware(auth);
  const optionalApi = authMiddleware(auth, false);

  app.post('/api/v1/auth/logout', protectedApi, (req, res) => { const token = req.header('authorization')?.slice(7); if (token) auth.revoke(token); res.status(204).send(); });

  app.post('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try {
      const input = parse(tenantSchema, req.body);
      if (await store.getTenantBySlug(input.slug)) throw new HttpError(409, 'TENANT_EXISTS', 'Tenant slug already exists.');
      if (await store.getUserByEmail(input.adminEmail)) throw new HttpError(409, 'USER_EXISTS', 'Admin email already exists.');
      const tenant = await store.createTenant({ name: input.name, slug: input.slug });
      const user = await store.createUser({ email: input.adminEmail, passwordHash: await auth.hashPassword(input.adminPassword), role: 'tenant_admin', tenantId: tenant.id });
      await store.setPersona({ tenantId: tenant.id, name: 'Sales assistant', greeting: 'How can I help?', personality: 'Helpful and precise.', tone: 'Clear', speakingStyle: 'Concise', permittedLanguages: ['en'] });
      res.status(201).json({ tenant, admin: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), async (_req, res, next) => { try { res.json({ items: await store.listTenants() }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/tenants/:id/status', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const status = parse(z.object({ status: z.enum(['active', 'suspended', 'archived']) }), req.body).status as TenantStatus; const tenant = await store.setTenantStatus(routeParam(req, 'id'), status); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: `tenant.${status}`, metadata: {}, createdAt: new Date().toISOString() }); res.json({ tenant }); } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/members', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: (await store.listUsers(await tenantForRequest(store, req))).map(publicUser) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/dashboard/overview', protectedApi, async (req, res, next) => { try { res.json({ tenantId: await tenantForRequest(store, req), metrics: await store.getTenantStats(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });

  app.put('/api/v1/admin/persona', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); res.json({ persona: await store.setPersona({ tenantId, ...input }) }); } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/persona', protectedApi, async (req, res, next) => { try { res.json({ persona: await store.getPersona(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });

  app.post('/api/v1/admin/sources', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
      await activeTenant(store, tenantId);
      const input = parse(sourceSchema, req.body);
      if (input.sourceUrl && !input.sourceUrl.startsWith('https://')) throw new HttpError(422, 'UNSAFE_SOURCE_URL', 'Only authorized HTTPS source URLs are accepted.');
      if (input.sourceUrl) {
        const hostname = new URL(input.sourceUrl).hostname;
        const allowedHosts = (process.env.ALLOWED_SOURCE_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);
        if (allowedHosts.length === 0 || !allowedHosts.includes(hostname)) throw new HttpError(422, 'UNAUTHORIZED_SOURCE_HOST', 'The HTTPS source host is not allowlisted.');
      }
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const sourceBase = { id: sourceId, tenantId, versionId };
      const safeContent = sanitizeKnowledgeText(input.content);
      const safeContentHash = contentHash(safeContent);
      const existing = await store.findSourceByHash(tenantId, safeContentHash);
      if (existing) { res.status(200).json({ source: existing, ingestion: { status: existing.status, chunks: 0 }, idempotent: true }); return; }
      const chunks = await buildChunksWithEmbeddings(sourceBase, safeContent, embedding);
      const source = await store.createSource({ id: sourceId, tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public', status: 'awaiting_review', versionId, contentHash: safeContentHash, chunks });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.staged', metadata: { sourceId, chunks: chunks.length }, createdAt: new Date().toISOString() });
      res.status(201).json({ source, ingestion: { status: 'awaiting_review', chunks: chunks.length } });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/sources', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listSources(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  const setSourceStatus = (status: SourceStatus) => async (req: Request, res: Response, next: NextFunction) => {
    try { const tenantId = await tenantForRequest(store, req); await activeTenant(store, tenantId); const source = await store.setSourceStatus(routeParam(req, 'id'), tenantId, status); if (!source) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: `source.${status}`, metadata: { sourceId: source.id }, createdAt: new Date().toISOString() }); res.json({ source }); } catch (error) { next(error); }
  };
  app.post('/api/v1/admin/sources/:id/publish', protectedApi, requireRoles('tenant_admin'), setSourceStatus('active'));
  app.post('/api/v1/admin/sources/:id/revoke', protectedApi, requireRoles('tenant_admin'), setSourceStatus('revoked'));
  app.get('/api/v1/admin/ingestion-jobs/:id', protectedApi, async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const source = await store.getSource(routeParam(req, 'id')); if (!source || source.tenantId !== tenantId) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.'); res.json({ id: source.id, status: source.status, sourceId: source.id, versionId: source.versionId }); } catch (error) { next(error); } });

  app.post('/api/v1/chat/sessions', optionalApi, async (req, res, next) => {
    try {
      const input = parse(sessionSchema, req.body);
      if (input.tenantId && !getAuth(req)) throw new HttpError(403, 'TENANT_REQUIRED', 'Public sessions must use an approved tenant slug.');
      const tenant = input.tenantId ? await store.getTenant(input.tenantId) : await store.getTenantBySlug(input.tenantSlug ?? '');
      if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
      if (!ensureTenant(req, tenant.id) && getAuth(req)?.role !== undefined) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.');
      if (tenant.status !== 'active' || (!getAuth(req) && !tenant.publicChatEnabled)) throw new HttpError(423, 'TENANT_UNAVAILABLE', 'This tenant is not accepting public chat.');
      const session = await store.createSession(tenant.id);
      res.status(201).json({ sessionId: session.id, tenantId: tenant.id, createdAt: session.createdAt });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/messages', optionalApi, async (req, res, next) => {
    try {
      const input = parse(messageSchema, req.body);
      const session = await store.getSession(input.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      await activeTenant(store, session.tenantId);
      if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
      const durableDuplicate = await store.getMessageByClientId(session.id, input.clientMessageId);
      if (durableDuplicate?.response) { res.json(durableDuplicate.response); return; }
      if (durableDuplicate) throw new HttpError(409, 'MESSAGE_IN_PROGRESS', 'A request with this client message ID is already being processed.');
      const cacheKey = `${session.id}:${input.clientMessageId}`;
      const cached = responseCache.get(cacheKey);
      if (cached) { res.json(cached); return; }
      const masked = maskPii(input.message);
      saveTokens(session, masked.tokens, tokenVault);
      await store.updateSession(session);
      const userMessage = await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: session.tenantId, role: 'user', maskedContent: masked.masked, citations: [], clientMessageId: input.clientMessageId, response: null, createdAt: new Date().toISOString() });
      const internal = getAuth(req)?.tenantId === session.tenantId && ['tenant_admin', 'tenant_agent', 'platform_admin'].includes(getAuth(req)?.role ?? '');
      const rows = await store.listSearchableChunks(session.tenantId, internal ? 'internal' : 'public');
       const ranked = await rankChunksWithEmbedding(masked.masked, rows, embedding, 4);
      const evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: chunk.content }));
      const persona = await store.getPersona(session.tenantId);
      let draft: ModelDraft;
      if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null };
      else try { draft = await model.draft({ maskedMessage: masked.masked, evidence, personaName: persona?.name ?? 'Sales assistant' }); } catch { throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The assistant is currently unable to verify an answer.'); }
      try { assertKnownTokens(session, draft.answer, tokenVault); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      const citations = validateCitations(draft, evidence);
      const grounded = evidence.length > 0 && citations.length > 0;
      const explicitLeadRequest = /\b(contact|call|email|interested|demo|quote)\b/i.test(masked.masked);
      const action = draft.proposedIntent === 'lead.capture' && explicitLeadRequest ? await gateway.propose(session.tenantId, session.id, input.clientMessageId) : null;
      const answer = rehydrateForSession(session, draft.answer, tokenVault);
      const response = { messageId: randomUUID(), sessionId: session.id, answer, grounded, citations, actionProposal: action ? { id: action.id, intent: action.workflowKey, confirmation: 'Please confirm that you want to submit a contact request.', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } : null, requestId: (req as AuthedRequest).requestId ?? randomUUID() };
      await store.addMessage({ id: response.messageId, sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: draft.answer, citations, clientMessageId: null, response: null, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response });
      responseCache.set(cacheKey, response);
      res.json(response);
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/actions/:id/confirm', optionalApi, async (req, res, next) => {
    try {
      const input = parse(confirmSchema, req.body);
      const action = await store.getAction(routeParam(req, 'id'));
      if (!action || action.sessionId !== input.sessionId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const session = await store.getSession(input.sessionId);
      if (!session || (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== action.tenantId)) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.');
      await activeTenant(store, action.tenantId);
      res.json({ action: await gateway.confirm(action.id, action.tenantId) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/actions/:id', optionalApi, async (req, res, next) => { try { const action = await store.getAction(routeParam(req, 'id')); if (!action) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); const sessionId = req.query.sessionId; if (typeof sessionId !== 'string' || sessionId !== action.sessionId) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.'); res.json({ action }); } catch (error) { next(error); } });

  app.post('/api/v1/internal/n8n/callback', async (req, res, next) => {
    try {
      if (!n8nCallbackSecret) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      const timestamp = req.header('x-agentic-timestamp') ?? '';
      const nonce = req.header('x-agentic-nonce') ?? '';
      const signature = req.header('x-agentic-signature') ?? '';
      const body = JSON.stringify(req.body);
      if (!verifyN8nPayload(n8nCallbackSecret, timestamp, nonce, body, signature)) throw new HttpError(401, 'INVALID_CALLBACK', 'Callback authentication failed.');
      const now = Date.now();
      for (const [key, expiry] of callbackNonces) if (expiry <= now) callbackNonces.delete(key);
      if (callbackNonces.has(nonce)) throw new HttpError(401, 'REPLAYED_CALLBACK', 'Callback replay rejected.');
      callbackNonces.set(nonce, now + 300_000);
      const input = parse(z.object({ actionId: z.string().uuid(), tenantId: z.string().uuid(), state: z.enum(['completed', 'failed']), externalReference: z.string().min(1).max(200) }), req.body);
      const action = await store.getAction(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.');
      const updated = await store.updateAction({ ...action, state: input.state, result: input.state === 'completed' ? { externalReference: input.externalReference } : null });
      await store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: `workflow.callback.${input.state}`, metadata: { actionId: action.id }, createdAt: new Date().toISOString() });
      res.json({ action: updated });
    } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/workflow-runs', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listActions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/audit', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listAudit(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/chat/config', optionalApi, async (req, res, next) => { try { const tenantSlug = typeof req.query.tenantSlug === 'string' ? req.query.tenantSlug : ''; const tenant = await store.getTenantBySlug(tenantSlug); if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); const persona = await store.getPersona(tenant.id); res.json({ tenant: { slug: tenant.slug, name: tenant.name }, persona: persona ? { name: persona.name, greeting: persona.greeting, tone: persona.tone, speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages } : null }); } catch (error) { next(error); } });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as AuthedRequest).requestId ?? randomUUID();
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large.', requestId } }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } }); return; }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
  });
  return { app, store, auth, gateway, workflow };
};

export const createDefaultApp = () => createApp({});

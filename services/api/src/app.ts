import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ActionGateway, MockWorkflowAdapter, type WorkflowAdapter } from './actions.js';
import { AuthService, authMiddleware, ensureTenant, requireRoles, type AuthedRequest } from './auth.js';
import { buildChunks, rankChunks } from './knowledge.js';
import { DeterministicGroundedModel, validateCitations, type ChatModel } from './model.js';
import { assertKnownTokens, maskPii, rehydrateForSession, sanitizeKnowledgeText, saveTokens } from './privacy.js';
import { MemoryStore, contentHash } from './store-memory.js';
import type { Audience, Citation, SourceStatus, Store } from './types.js';

const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/\d/, 'Password must contain a number.');
const tenantSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(80), adminEmail: z.string().email(), adminPassword: passwordSchema });
const personaSchema = z.object({ name: z.string().trim().min(1).max(80), greeting: z.string().trim().min(1).max(500), personality: z.string().trim().min(1).max(500), tone: z.string().trim().min(1).max(200), speakingStyle: z.string().trim().min(1).max(200), permittedLanguages: z.array(z.string().min(2).max(12)).min(1).max(10) });
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

export interface AppDependencies {
  store?: Store;
  model?: ChatModel;
  workflow?: WorkflowAdapter;
  jwtSecret?: string;
  nodeEnv?: string;
}

export const createApp = (dependencies: AppDependencies = {}) => {
  const store = dependencies.store ?? new MemoryStore();
  const model = dependencies.model ?? new DeterministicGroundedModel();
  const workflow = dependencies.workflow ?? new MockWorkflowAdapter();
  const auth = new AuthService(store, dependencies.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only-change-me');
  const gateway = new ActionGateway(store, workflow);
  const app = express();
  const responseCache = new Map<string, unknown>();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '300kb' }));
  app.use((req: AuthedRequest, res: Response, next: NextFunction) => { req.requestId = req.header('x-request-id') ?? randomUUID(); res.setHeader('x-request-id', req.requestId); next(); });

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

  app.put('/api/v1/admin/persona', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); res.json({ persona: await store.setPersona({ tenantId, ...input }) }); } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/persona', protectedApi, async (req, res, next) => { try { res.json({ persona: await store.getPersona(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });

  app.post('/api/v1/admin/sources', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req);
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
      const chunks = buildChunks(sourceBase, safeContent);
      const source = await store.createSource({ id: sourceId, tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl ?? null, audience: input.audience ?? 'public', status: 'awaiting_review', versionId, contentHash: contentHash(safeContent), chunks });
      await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'source.staged', metadata: { sourceId, chunks: chunks.length }, createdAt: new Date().toISOString() });
      res.status(201).json({ source, ingestion: { status: 'awaiting_review', chunks: chunks.length } });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/admin/sources', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listSources(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  const setSourceStatus = (status: SourceStatus) => async (req: Request, res: Response, next: NextFunction) => {
    try { const tenantId = await tenantForRequest(store, req); const source = await store.setSourceStatus(routeParam(req, 'id'), tenantId, status); if (!source) throw new HttpError(404, 'SOURCE_NOT_FOUND', 'Source not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: `source.${status}`, metadata: { sourceId: source.id }, createdAt: new Date().toISOString() }); res.json({ source }); } catch (error) { next(error); }
  };
  app.post('/api/v1/admin/sources/:id/publish', protectedApi, requireRoles('tenant_admin'), setSourceStatus('active'));
  app.post('/api/v1/admin/sources/:id/revoke', protectedApi, requireRoles('tenant_admin'), setSourceStatus('revoked'));
  app.get('/api/v1/admin/ingestion-jobs/:id', protectedApi, async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const source = await store.getSource(routeParam(req, 'id')); if (!source || source.tenantId !== tenantId) throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.'); res.json({ id: source.id, status: source.status, sourceId: source.id, versionId: source.versionId }); } catch (error) { next(error); } });

  app.post('/api/v1/chat/sessions', optionalApi, async (req, res, next) => {
    try {
      const input = parse(sessionSchema, req.body);
      const tenant = input.tenantId ? await store.getTenant(input.tenantId) : await store.getTenantBySlug(input.tenantSlug ?? '');
      if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.');
      if (!ensureTenant(req, tenant.id) && getAuth(req)?.role !== undefined) throw new HttpError(403, 'TENANT_FORBIDDEN', 'Tenant access denied.');
      const session = await store.createSession(tenant.id);
      res.status(201).json({ sessionId: session.id, tenantId: tenant.id, createdAt: session.createdAt });
    } catch (error) { next(error); }
  });

  app.post('/api/v1/chat/messages', optionalApi, async (req, res, next) => {
    try {
      const input = parse(messageSchema, req.body);
      const session = await store.getSession(input.sessionId);
      if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
      if (getAuth(req)?.tenantId && getAuth(req)?.tenantId !== session.tenantId && getAuth(req)?.role !== 'platform_admin') throw new HttpError(403, 'SESSION_FORBIDDEN', 'Session access denied.');
      const cacheKey = `${session.id}:${input.clientMessageId}`;
      const cached = responseCache.get(cacheKey);
      if (cached) { res.json(cached); return; }
      const masked = maskPii(input.message);
      saveTokens(session, masked.tokens);
      await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: session.tenantId, role: 'user', maskedContent: masked.masked, citations: [], clientMessageId: input.clientMessageId, createdAt: new Date().toISOString() });
      const internal = getAuth(req)?.tenantId === session.tenantId && ['tenant_admin', 'tenant_agent', 'platform_admin'].includes(getAuth(req)?.role ?? '');
      const rows = await store.listSearchableChunks(session.tenantId, internal ? 'internal' : 'public');
      const ranked = rankChunks(masked.masked, rows, 4);
      const evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: chunk.content }));
      const persona = await store.getPersona(session.tenantId);
      let draft;
      try { draft = await model.draft({ maskedMessage: masked.masked, evidence, personaName: persona?.name ?? 'Sales assistant' }); } catch { throw new HttpError(503, 'MODEL_UNAVAILABLE', 'The assistant is currently unable to verify an answer.'); }
      try { assertKnownTokens(session, draft.answer); } catch { throw new HttpError(502, 'MODEL_PRIVACY_VIOLATION', 'The assistant returned an unsafe response.'); }
      const citations = validateCitations(draft, evidence);
      const grounded = evidence.length > 0 && citations.length > 0;
      const action = draft.proposedIntent === 'lead.capture' ? await gateway.propose(session.tenantId, session.id, input.clientMessageId) : null;
      const answer = rehydrateForSession(session, draft.answer);
      const response = { messageId: randomUUID(), sessionId: session.id, answer, grounded, citations, actionProposal: action ? { id: action.id, intent: action.workflowKey, confirmation: 'Please confirm that you want to submit a contact request.', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() } : null, requestId: (req as AuthedRequest).requestId ?? randomUUID() };
      await store.addMessage({ id: response.messageId, sessionId: session.id, tenantId: session.tenantId, role: 'assistant', maskedContent: draft.answer, citations, clientMessageId: null, createdAt: new Date().toISOString() });
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
      res.json({ action: await gateway.confirm(action.id, action.tenantId) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/actions/:id', optionalApi, async (req, res, next) => { try { const action = await store.getAction(routeParam(req, 'id')); if (!action) throw new HttpError(404, 'ACTION_NOT_FOUND', 'Action not found.'); const sessionId = req.query.sessionId; if (typeof sessionId !== 'string' || sessionId !== action.sessionId) throw new HttpError(403, 'ACTION_FORBIDDEN', 'Action access denied.'); res.json({ action }); } catch (error) { next(error); } });

  app.get('/api/v1/admin/workflow-runs', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listActions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/audit', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listAudit(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = (req as AuthedRequest).requestId ?? randomUUID();
    if (error instanceof HttpError) { res.status(error.status).json({ error: { code: error.code, message: error.message, requestId } }); return; }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
  });
  return { app, store, auth, gateway, workflow };
};

export const createDefaultApp = () => createApp({});

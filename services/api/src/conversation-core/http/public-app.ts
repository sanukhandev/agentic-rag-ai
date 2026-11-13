import express, { type Express, type Request } from 'express';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AuthService, authMiddleware, type AuthedRequest } from '../../auth.js';
import { ChannelSecretVault } from '../../channel-auth.js';
import { createCache, type CacheStore } from '../../cache.js';
import type { EmbeddingProvider } from '../../embedding.js';
import { HttpError } from '../../http/errors.js';
import { PrivateDocumentStorage } from '../../document-intake.js';
import { TokenVault } from '../../privacy.js';
import type { ChatModel } from '../../model.js';
import type { Store } from '../../types.js';
import { registerAuthRoutes } from '../../routes/auth.js';
import { registerAdminRoutes, type TelemetrySnapshot } from '../../routes/admin.js';
import { registerHealthRoutes } from '../../routes/health.js';
import { PostgresScopedPrivacyVault } from '../adapters/p6-session-vault.js';
import type { CustomerTurnRouteDependencies } from './customer-turn.js';
import { registerCustomerTurnRoute } from './customer-turn.js';

const sessionSchema = z.object({ tenantSlug: z.string().min(1).max(80) }).strict();
const historySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(40) });

function emptyTelemetry(): TelemetrySnapshot {
  return {
    requests: 0, serverErrors: 0, totalLatencyMs: 0, lastRequestAt: null,
    chatResponses: 0, groundedResponses: 0, abstentions: 0, actionProposals: 0,
    estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedCostUsd: null,
    normalizationAttempts: 0, normalizationFallbacks: 0, normalizationFailures: 0,
    normalizationLatencyMs: 0,
  };
}
const routeParam = (req: Request, key: string): string => {
  const value = req.params[key];
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_ROUTE', 'Invalid route parameter');
  return value;
};
const authContext = (req: Request): AuthedRequest['auth'] => (req as AuthedRequest).auth;
const publicUser = (user: { id: string; email: string; role: string; tenantId: string | null }) => ({
  id: user.id, email: user.email, role: user.role, tenantId: user.tenantId,
});

export interface ConversationAppDependencies {
  readonly store: Store;
  readonly cache: CacheStore;
  readonly embedding: EmbeddingProvider;
  readonly vault: PostgresScopedPrivacyVault;
  readonly customerTurn: Omit<CustomerTurnRouteDependencies, 'store' | 'vault' | 'nodeEnv' | 'localOrigin'>;
  readonly nodeEnv: string;
  readonly origin: string;
  readonly sessionTtlMs: number;
  readonly jwtSecret: string;
  readonly vaultSecret: string;
  readonly channelSecret: string;
  readonly documentStorageRoot: string;
  readonly ingestionWorkerSecret: string;
}

/**
 * New composition root. No legacy conversation controller or synthetic model fallback.
 * Administration remains available for catalog/persona/source management, while the
 * retired deterministic persona preview is deliberately unavailable.
 */
export function createConversationApp(deps: ConversationAppDependencies): { app: Express } {
  const { store, cache, nodeEnv } = deps;
  if (deps.jwtSecret.length < 32 || deps.vaultSecret.length < 32 || deps.channelSecret.length < 16) {
    throw new Error('Strong private JWT, PII vault and channel credentials are mandatory');
  }
  if (!Number.isFinite(deps.sessionTtlMs) || deps.sessionTtlMs <= 0) {
    throw new Error('Invalid session TTL');
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    (req as AuthedRequest).requestId = randomUUID();
    res.setHeader('x-request-id', (req as AuthedRequest).requestId!);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    if (req.path.startsWith('/api')) res.setHeader('cache-control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '30mb' }));
  app.use((req, res, next) => {
    void (async () => {
      const origin = req.header('origin');
      if (origin) {
        const tenants = await store.listTenants();
        if (origin === deps.origin || tenants.some(t => t.status === 'active' && t.publicOrigin === origin)) {
          res.setHeader('access-control-allow-origin', origin);
          res.setHeader('vary', 'origin');
          res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
          res.setHeader('access-control-allow-headers', 'authorization, content-type, x-agentic-session-token');
        }
      }
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      next();
    })().catch(next);
  });

  const auth = new AuthService(store, deps.jwtSecret);
  const protectedApi = authMiddleware(auth);
  registerHealthRoutes(app, { store, cache });
  registerAuthRoutes(app, { store, auth, nodeEnv, protectedApi, publicUser });

  const telemetry = emptyTelemetry();
  const tenantTelemetry = new Map<string, TelemetrySnapshot>();
  app.use((req, res, next) => {
    const start = Date.now();
    res.once('finish', () => {
      telemetry.requests++;
      if (res.statusCode >= 500) telemetry.serverErrors++;
      telemetry.totalLatencyMs += Date.now() - start;
      telemetry.lastRequestAt = new Date().toISOString();
    });
    next();
  });
  const disabledPreview: ChatModel = {
    async draft() { throw new Error('Use authenticated conversation preview; deterministic preview is retired'); },
  };
  // The administrative router is temporary infrastructure for persona,
  // catalog and source management; it never owns public conversation turns.
  const channelVault = new ChannelSecretVault(deps.channelSecret);
  registerAdminRoutes(app, {
    store, auth, model: disabledPreview, embedding: deps.embedding, protectedApi,
    documentStorage: new PrivateDocumentStorage(deps.documentStorageRoot),
    channelVault, ingestionWorkerSecret: deps.ingestionWorkerSecret,
    tokenVault: new TokenVault(deps.vaultSecret),
    cachePing: () => cache.ping(),
    invalidateTenantCache: tenantId => cache.invalidate(`agentic:tenant:${encodeURIComponent(tenantId)}:`),
    modelConfigured: true, embeddingConfigured: true,
    getAuth: authContext, routeParam,
    tenantForRequest: async (s, req) => {
      const user = authContext(req);
      if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Authentication required');
      if (user.role === 'platform_admin') {
        const id = req.header('x-tenant-id') || req.query.tenantId;
        if (typeof id !== 'string') throw new HttpError(400, 'TENANT_REQUIRED', 'Tenant scope required');
        const tenant = await s.getTenant(id);
        if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant unavailable');
        return tenant.id;
      }
      if (!user.tenantId) throw new HttpError(403, 'TENANT_REQUIRED', 'Tenant scope required');
      return user.tenantId;
    },
    activeTenant: async (s, tenantId) => {
      const tenant = await s.getTenant(tenantId);
      if (!tenant || tenant.status !== 'active') throw new HttpError(404, 'TENANT_UNAVAILABLE', 'Tenant unavailable');
      return tenant;
    },
    publicUser, publicChannelCredential: credential => ({
      id: credential.id, tenantId: credential.tenantId,
      channel: credential.channel, authMode: credential.authMode,
      keyId: credential.keyId, active: credential.active,
      createdAt: credential.createdAt, revokedAt: credential.revokedAt,
    }),
    observedTelemetry: value => ({
      ...value, averageLatencyMs: value.requests ? value.totalLatencyMs / value.requests : 0,
    }),
    newTelemetry: emptyTelemetry, telemetry, tenantTelemetry,
  });

  // Retire heuristic admin-only model preview rather than silently calling it.
  app.post('/api/v1/admin/persona/preview', protectedApi, (_req, res) => {
    res.status(503).json({ error: { code: 'CONVERSATION_PREVIEW_REQUIRES_SESSION' } });
  });

  const originAllowed = (req: Request, publicOrigin: string | null): boolean => {
    const origin = req.header('origin');
    return Boolean(origin && (publicOrigin ? origin === publicOrigin : nodeEnv !== 'production' && origin === deps.origin));
  };

  app.get('/api/v1/chat/config', async (req, res) => {
    const slug = z.string().min(1).max(80).safeParse(req.query.tenantSlug);
    if (!slug.success) { res.status(400).json({ error: { code: 'TENANT_REQUIRED' } }); return; }
    const tenant = await store.getTenantBySlug(slug.data);
    if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled || !originAllowed(req, tenant.publicOrigin)) {
      res.status(404).json({ error: { code: 'TENANT_UNAVAILABLE' } }); return;
    }
    const persona = await store.getPersona(tenant.id);
    res.json({
      tenant: { slug: tenant.slug, name: tenant.name },
      persona: persona ? {
        name: persona.name, greeting: persona.greeting, tone: persona.tone,
        speakingStyle: persona.speakingStyle, permittedLanguages: persona.permittedLanguages,
        voiceName: persona.voiceName, voiceLanguage: persona.voiceLanguage,
        voiceRate: persona.voiceRate, voicePitch: persona.voicePitch,
        voiceVolume: persona.voiceVolume,
      } : null,
      documents: { enabled: false, policies: [], requirements: [] },
    });
  });

  app.post('/api/v1/chat/sessions', async (req, res) => {
    const parsed = sessionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: 'SESSION_INVALID_INPUT' } }); return; }
    const tenant = await store.getTenantBySlug(parsed.data.tenantSlug);
    if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled
      || !originAllowed(req, tenant.publicOrigin)) {
      res.status(404).json({ error: { code: 'TENANT_UNAVAILABLE' } }); return;
    }
    const versions = await store.listPersonaVersions(tenant.id);
    const published = versions.find(v => v.status === 'published');
    const session = await store.createSession(tenant.id, published?.id ?? null);
    const sessionToken = randomBytes(32).toString('base64url');
    await store.createSessionAccessToken({
      sessionId: session.id,
      tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
      expiresAt: new Date(Date.now() + deps.sessionTtlMs).toISOString(),
    });
    res.status(201).json({
      sessionId: session.id, sessionToken, tenantId: tenant.id,
      createdAt: session.createdAt,
    });
  });

  app.get('/api/v1/chat/sessions/:id', async (req, res) => {
    const id = routeParam(req, 'id');
    const bearer = req.header('x-agentic-session-token');
    const session = await store.getSession(id);
    if (!session || !bearer || bearer.length < 32 || !await store.verifySessionAccessToken(id,
      createHash('sha256').update(bearer, 'utf8').digest('hex'))) {
      res.status(404).json({ error: { code: 'SESSION_UNAVAILABLE' } }); return;
    }
    const tenant = await store.getTenant(session.tenantId);
    if (!tenant || tenant.status !== 'active' || !originAllowed(req, tenant.publicOrigin)
      || session.closedAt !== null || Date.parse(session.lastActivityAt) + deps.sessionTtlMs <= Date.now()) {
      res.status(404).json({ error: { code: 'SESSION_UNAVAILABLE' } }); return;
    }
    const limit = historySchema.safeParse(req.query);
    if (!limit.success) { res.status(400).json({ error: { code: 'INVALID_HISTORY_LIMIT' } }); return; }
    const actor = { sessionId: id, tenantId: session.tenantId,
      principalId: createHash('sha256').update(bearer).digest('hex'), role: 'customer' as const };
    const messages = await Promise.all((await store.listMessages(id, session.tenantId, limit.data.limit))
      .map(async message => ({
        id: message.id, role: message.role,
        content: message.role === 'assistant'
          ? await deps.vault.restoreForCustomer(actor, message.maskedContent)
          : message.maskedContent,
        citations: message.citations, conversational: true,
        clientMessageId: message.clientMessageId, createdAt: message.createdAt,
      })));
    res.json({ sessionId: id, tenantId: session.tenantId, createdAt: session.createdAt, messages });
  });

  registerCustomerTurnRoute(app, {
    ...deps.customerTurn, store, vault: deps.vault, nodeEnv, localOrigin: deps.origin,
  });

  app.use((error: unknown, req: Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const expected = error instanceof HttpError;
    const status = expected ? error.status : 503;
    const code = expected ? error.code : 'SERVICE_UNAVAILABLE';
    if (!expected) console.error(JSON.stringify({
      event: 'api.failed', requestId: (req as AuthedRequest).requestId, code,
    }));
    res.status(status).json({ error: { code, message: expected ? error.message : 'Service unavailable' } });
  });
  return { app };
}

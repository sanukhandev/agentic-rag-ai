import type { Application, Request } from 'express';
import { randomUUID } from 'node:crypto';
import { requireRoles, type AuthService, type AuthedRequest } from '../auth.js';
import { type ChannelSecretVault, generateChannelApiKey, generateChannelKeyId, generateChannelSecret } from '../channel-auth.js';
import { type EmbeddingProvider } from '../embedding.js';
import { HttpError, parse } from '../http/errors.js';
import {
  channelCredentialSchema,
  channelSchema,
  DEFAULT_CONTEXT_WINDOW_MESSAGES,
  domainSchema,
  memberRoleSchema,
  memberSchema,
  personaPreviewSchema,
  personaSchema,
  retentionSchema,
  tenantSchema,
  tenantStatusSchema,
} from '../http/schemas.js';
import { hasConflictingEvidence, presentKnowledgeText, rankChunksWithVector } from '../knowledge.js';
import { conversationalIntent, conversationalReply, detectedLanguage, hasSufficientEvidence, isPermittedLanguage, naturalAbstention, permittedLanguageReply, validateCitations, type ChatModel, type ModelDraft } from '../model.js';
import { assertKnownTokens, maskPii, rehydrateForSession, saveTokens, TokenVault } from '../privacy.js';
import { type PrivateDocumentStorage } from '../document-intake.js';
import type { ChannelCredential, Store, TenantStatus } from '../types.js';
import { newConversationState } from '../conversation-state.js';

export type TelemetrySnapshot = {
  requests: number;
  serverErrors: number;
  totalLatencyMs: number;
  lastRequestAt: string | null;
  chatResponses: number;
  groundedResponses: number;
  abstentions: number;
  actionProposals: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number | null;
  normalizationAttempts: number;
  normalizationFallbacks: number;
  normalizationLatencyMs: number;
};

export type AdminRouteDependencies = {
  store: Store;
  auth: AuthService;
  model: ChatModel;
  embedding: EmbeddingProvider;
  protectedApi: import('express').RequestHandler;
  documentStorage: PrivateDocumentStorage;
  channelVault: ChannelSecretVault;
  ingestionWorkerSecret: string;
  tokenVault: TokenVault;
  cachePing: () => Promise<boolean>;
  modelConfigured: boolean;
  embeddingConfigured: boolean;
  getAuth: (req: Request) => AuthedRequest['auth'];
  routeParam: (req: Request, name: string) => string;
  tenantForRequest: (store: Store, req: Request) => Promise<string>;
  activeTenant: (store: Store, tenantId: string) => Promise<NonNullable<Awaited<ReturnType<Store['getTenant']>>>>;
  publicUser: (user: { id: string; email: string; role: string; tenantId: string | null }) => unknown;
  publicChannelCredential: (credential: ChannelCredential) => unknown;
  observedTelemetry: (value: TelemetrySnapshot) => Record<string, unknown>;
  newTelemetry: () => TelemetrySnapshot;
  telemetry: TelemetrySnapshot;
  tenantTelemetry: Map<string, TelemetrySnapshot>;
};

export const registerAdminRoutes = (app: Application, dependencies: AdminRouteDependencies): void => {
  const { store, auth, model, embedding, protectedApi, documentStorage, channelVault, ingestionWorkerSecret, tokenVault, getAuth, routeParam, tenantForRequest, activeTenant, publicUser, publicChannelCredential, observedTelemetry, newTelemetry, telemetry, tenantTelemetry } = dependencies;

  app.post('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), (req, res, next) => {
    void (async () => {
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
    })();
  });

  app.get('/api/v1/admin/tenants', protectedApi, requireRoles('platform_admin'), async (_req, res, next) => { try { res.json({ items: await store.listTenants() }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/platform/overview', protectedApi, requireRoles('platform_admin'), async (_req, res, next) => { try { const tenants = await store.listTenants(); const stats = await Promise.all(tenants.map(async (tenant) => ({ tenantId: tenant.id, metrics: await store.getTenantStats(tenant.id) }))); res.json({ tenants: { total: tenants.length, active: tenants.filter((tenant) => tenant.status === 'active').length, suspended: tenants.filter((tenant) => tenant.status === 'suspended').length, archived: tenants.filter((tenant) => tenant.status === 'archived').length }, metrics: stats }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/tenants/:id/status', protectedApi, requireRoles('platform_admin'), async (req, res, next) => {
    try { const status = parse(tenantStatusSchema, req.body).status as TenantStatus; const tenant = await store.setTenantStatus(routeParam(req, 'id'), status); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: `tenant.${status}`, metadata: {}, createdAt: new Date().toISOString() }); res.json({ tenant }); } catch (error) { next(error); }
  });

  app.get('/api/v1/admin/tenant', protectedApi, async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const tenant = await store.getTenant(tenantId); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); res.json({ tenant }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/members', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: (await store.listUsers(await tenantForRequest(store, req))).map(publicUser) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/members', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(memberSchema, req.body); if (await store.getUserByEmail(input.email)) throw new HttpError(409, 'USER_EXISTS', 'Member email already exists.'); const user = await store.createUser({ email: input.email, passwordHash: await auth.hashPassword(input.password), role: input.role, tenantId }); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'member.created', metadata: { memberId: user.id, role: user.role }, createdAt: new Date().toISOString() }); res.status(201).json({ user: publicUser(user) }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/members/:id', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const role = parse(memberRoleSchema, req.body).role; const user = await store.updateUserRole(routeParam(req, 'id'), tenantId, role); if (!user) throw new HttpError(404, 'MEMBER_NOT_FOUND', 'Member not found or not eligible for role changes.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'member.role_updated', metadata: { memberId: user.id, role }, createdAt: new Date().toISOString() }); res.json({ user: publicUser(user) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/domains', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: await store.listDomains(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/domains', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(domainSchema, req.body); if ((await store.listDomains(tenantId)).some((domain) => domain.hostname === input.hostname)) throw new HttpError(409, 'DOMAIN_EXISTS', 'Domain already exists.'); const domain = await store.addDomain({ tenantId, hostname: input.hostname }); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'domain.created', metadata: { hostname: domain.hostname }, createdAt: new Date().toISOString() }); res.status(201).json({ domain }); } catch (error) { next(error); } });
  app.delete('/api/v1/admin/domains/:id', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const id = routeParam(req, 'id'); if (!(await store.removeDomain(id, tenantId))) throw new HttpError(404, 'DOMAIN_NOT_FOUND', 'Domain not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'domain.deleted', metadata: { domainId: id }, createdAt: new Date().toISOString() }); res.status(204).send(); } catch (error) { next(error); } });
  app.get('/api/v1/admin/channel', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenant = await activeTenant(store, await tenantForRequest(store, req)); res.json({ publicOrigin: tenant.publicOrigin, publicChatEnabled: tenant.publicChatEnabled }); } catch (error) { next(error); } });
  app.patch('/api/v1/admin/channel', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(channelSchema, req.body); let tenant = await store.setTenantPublicOrigin(tenantId, input.publicOrigin ? new URL(input.publicOrigin).origin : null); if (tenant && input.publicChatEnabled !== undefined) tenant = await store.setTenantPublicChatEnabled(tenantId, input.publicChatEnabled); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'tenant.channel_updated', metadata: { publicOrigin: tenant.publicOrigin, publicChatEnabled: tenant.publicChatEnabled }, createdAt: new Date().toISOString() }); res.json({ publicOrigin: tenant.publicOrigin, publicChatEnabled: tenant.publicChatEnabled }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/channels', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { res.json({ items: (await store.listChannelCredentials(await tenantForRequest(store, req))).map(publicChannelCredential) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/channels', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try { const tenantId = await tenantForRequest(store, req); await activeTenant(store, tenantId); const input = parse(channelCredentialSchema, req.body); if ((await store.listChannelCredentials(tenantId)).some((credential) => credential.channel === input.channel && credential.active)) throw new HttpError(409, 'CHANNEL_EXISTS', 'An active credential already exists for this channel.'); const authMode = input.authMode ?? 'hmac'; const tenant = await store.getTenant(tenantId); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); const secret = authMode === 'api_key' ? generateChannelApiKey(tenant.slug) : generateChannelSecret(); const credential = await store.createChannelCredential({ id: randomUUID(), tenantId, channel: input.channel, authMode, keyId: generateChannelKeyId(), secretCiphertext: channelVault.encrypt(secret), apiKeyHash: authMode === 'api_key' ? channelVault.hashApiKey(secret) : null, active: true }); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'channel.credential_created', metadata: { channel: credential.channel, credentialId: credential.id }, createdAt: new Date().toISOString() }); res.status(201).json({ credential: publicChannelCredential(credential), secret, warning: 'Store this secret now. It is shown only once.' });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/admin/channels/:id/revoke', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const credential = await store.revokeChannelCredential(routeParam(req, 'id'), tenantId); if (!credential) throw new HttpError(404, 'CHANNEL_NOT_FOUND', 'Channel credential not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'channel.credential_revoked', metadata: { channel: credential.channel, credentialId: credential.id }, createdAt: new Date().toISOString() }); res.json({ credential: publicChannelCredential(credential) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/dashboard/overview', protectedApi, async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); res.json({ tenantId, metrics: await store.getTenantStats(tenantId) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/retention/purge-sessions', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const before = parse(retentionSchema, req.body).before; if (Date.parse(before) > Date.now()) throw new HttpError(422, 'INVALID_RETENTION_CUTOFF', 'Retention cutoff must be in the past.'); const expiredDocuments = await store.listExpiredSupportingDocuments(tenantId, before); for (const document of expiredDocuments) await documentStorage.purge(document.storageKey); const purged = await store.purgeExpiredSessions(tenantId, before); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'retention.sessions_purged', metadata: { purged, before }, createdAt: new Date().toISOString() }); res.json({ purged, before }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/services/health', protectedApi, requireRoles('platform_admin', 'tenant_admin'), async (req, res, _next) => {
    const checkedAt = new Date().toISOString(); const authContext = getAuth(req); const observed = observedTelemetry(authContext?.role === 'platform_admin' ? telemetry : tenantTelemetry.get(authContext?.tenantId ?? '') ?? newTelemetry());
    try { await store.countUsers(); const isCacheOk = (await dependencies.cachePing()) ? 'ok' : 'degraded'; res.json({ checkedAt, telemetry: observed, checks: { api: { status: 'ok' }, store: { status: 'ok' }, cache: { status: isCacheOk }, model: { status: dependencies.modelConfigured ? 'ok' : 'adapter' }, embedding: { status: dependencies.embeddingConfigured ? 'ok' : 'adapter' }, workflow: { status: 'catalog-polling' }, ingestion: { status: ingestionWorkerSecret ? 'ok' : 'ready' } } }); } catch { res.status(503).json({ checkedAt, telemetry: observed, checks: { api: { status: 'ok' }, store: { status: 'down' }, cache: { status: 'down' }, model: { status: dependencies.modelConfigured ? 'ok' : 'adapter' }, embedding: { status: dependencies.embeddingConfigured ? 'ok' : 'adapter' }, workflow: { status: 'catalog-polling' }, ingestion: { status: ingestionWorkerSecret ? 'ok' : 'ready' } } }); }
  });

  app.put('/api/v1/admin/persona', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); const version = await store.createPersonaVersion({ tenantId, ...input, contextWindowMessages: input.contextWindowMessages ?? 10, voiceName: input.voiceName ?? '', voiceLanguage: input.voiceLanguage ?? 'en-US', voiceRate: input.voiceRate ?? 1, voicePitch: input.voicePitch ?? 1, voiceVolume: input.voiceVolume ?? 1, status: 'draft' }); await store.publishPersonaVersion(tenantId, version.id); res.json({ persona: await store.getPersona(tenantId) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/tenants/:tenantId/persona', protectedApi, requireRoles('platform_admin'), async (req, res, next) => { try { const tenant = await store.getTenant(routeParam(req, 'tenantId')); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (tenant.status === 'archived') throw new HttpError(423, 'TENANT_ARCHIVED', 'Archived tenants cannot be managed.'); res.json({ persona: await store.getPersona(tenant.id) }); } catch (error) { next(error); } });
  app.put('/api/v1/admin/tenants/:tenantId/persona', protectedApi, requireRoles('platform_admin'), async (req, res, next) => { try { const tenant = await store.getTenant(routeParam(req, 'tenantId')); if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'Tenant not found.'); if (tenant.status === 'archived') throw new HttpError(423, 'TENANT_ARCHIVED', 'Archived tenants cannot be managed.'); const input = parse(personaSchema, req.body); const version = await store.createPersonaVersion({ tenantId: tenant.id, ...input, contextWindowMessages: input.contextWindowMessages ?? 10, voiceName: input.voiceName ?? '', voiceLanguage: input.voiceLanguage ?? 'en-US', voiceRate: input.voiceRate ?? 1, voicePitch: input.voicePitch ?? 1, voiceVolume: input.voiceVolume ?? 1, status: 'draft' }); await store.publishPersonaVersion(tenant.id, version.id); const persona = await store.getPersona(tenant.id); await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: getAuth(req)?.userId ?? null, eventName: 'persona.platform_updated', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() }); res.json({ persona }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/persona', protectedApi, async (req, res, next) => { try { res.json({ persona: await store.getPersona(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/drafts', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const input = parse(personaSchema, req.body); res.status(201).json({ version: await store.createPersonaVersion({ tenantId, ...input, contextWindowMessages: input.contextWindowMessages ?? 10, voiceName: input.voiceName ?? '', voiceLanguage: input.voiceLanguage ?? 'en-US', voiceRate: input.voiceRate ?? 1, voicePitch: input.voicePitch ?? 1, voiceVolume: input.voiceVolume ?? 1, status: 'draft' }) }); } catch (error) { next(error); } });
  app.get('/api/v1/admin/persona/versions', protectedApi, async (req, res, next) => { try { res.json({ items: await store.listPersonaVersions(await tenantForRequest(store, req)) }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/versions/:id/publish', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => { try { const tenantId = await tenantForRequest(store, req); const version = await store.publishPersonaVersion(tenantId, routeParam(req, 'id')); if (!version) throw new HttpError(404, 'PERSONA_VERSION_NOT_FOUND', 'Persona version not found.'); await store.addAudit({ id: randomUUID(), tenantId, actorId: getAuth(req)?.userId ?? null, eventName: 'persona.published', metadata: { versionId: version.id, version: version.version }, createdAt: new Date().toISOString() }); res.json({ version }); } catch (error) { next(error); } });
  app.post('/api/v1/admin/persona/preview', protectedApi, requireRoles('tenant_admin'), async (req, res, next) => {
    try {
      const tenantId = await tenantForRequest(store, req); const tenant = await activeTenant(store, tenantId); const input = parse(personaPreviewSchema, req.body); const masked = maskPii(input.message); const previewSession = { id: randomUUID(), tenantId, createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>(), conversationState: newConversationState() }; saveTokens(previewSession, masked.tokens, tokenVault); const queryEmbedding = await embedding.embed(masked.masked); const ranked = rankChunksWithVector(masked.masked, await store.searchSearchableChunks(tenantId, 'internal', queryEmbedding, 4), queryEmbedding, 4); const evidence = ranked.map(({ source, chunk }) => ({ citation: { sourceId: source.id, versionId: source.versionId, chunkId: chunk.id, title: source.title, locator: chunk.locator }, content: presentKnowledgeText(chunk.content) })).filter((item) => item.content.length > 0); const language = detectedLanguage(masked.masked); const languageAllowed = isPermittedLanguage(masked.masked, input.permittedLanguages); const intent = conversationalIntent(masked.masked); const conversational = intent !== null && (languageAllowed || language === 'ar'); let draft: ModelDraft; if (!languageAllowed && !conversational) draft = { answer: permittedLanguageReply(language, input.permittedLanguages), citationIds: [], proposedIntent: null }; else if (conversational && intent === 'identity') draft = { answer: conversationalReply(intent, input.name, language, tenant.name), citationIds: [], proposedIntent: null }; else if (hasConflictingEvidence(evidence.map((item) => item.content))) draft = { answer: 'The approved sources contain conflicting facts, so I will not choose one without review.', citationIds: [], proposedIntent: null }; else if (conversational && evidence.length === 0) draft = { answer: intent === 'greeting' && language !== 'ar' ? input.greeting : conversationalReply(intent ?? 'identity', input.name, language, tenant.name), citationIds: [], proposedIntent: null }; else draft = await model.draft({ maskedMessage: masked.masked, evidence, personaName: input.name, ownerName: tenant.name, persona: input }); assertKnownTokens(previewSession, draft.answer, tokenVault); const citations = validateCitations(draft, evidence); const grounded = languageAllowed && hasSufficientEvidence(draft.answer, evidence, citations); const safeCitations = grounded ? citations : []; const casualFallback = conversational && (evidence.length === 0 || intent === 'identity'); const answer = !languageAllowed ? draft.answer : casualFallback ? draft.answer : grounded ? draft.answer : naturalAbstention(language); res.json({ preview: { answer: rehydrateForSession(previewSession, answer, tokenVault), grounded, citations: safeCitations, persona: { name: input.name, permittedLanguages: input.permittedLanguages } } });
    } catch (error) { next(error); }
  });
};

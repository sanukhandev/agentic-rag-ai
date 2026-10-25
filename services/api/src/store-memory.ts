import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ActionExecution, ActionRequest, AuditEvent, AuthSession, ChannelCredential, Chunk, CrmLead, DocumentProcessingJob, EventInboxClaim, EventInboxState, IngestionJob, IntentCatalogVersion, Message, OutboxEvent, Persona, PersonaVersion, Session, Source, SourceStatus, SourceVersion, Store, SupportingDocument, Tenant, TenantDomain, TenantStatus, TenantStats, User, WorkflowActionClaim } from './types.js';
import { newConversationState } from './conversation-state.js';
import { formatCrmSummarySpec } from './crm-summary.js';
import { createOutboxEvent } from './events.js';
import { HttpError } from './http/errors.js';
import { isWorkflowClaimableBinding } from './intent-catalog.js';

const now = (): string => new Date().toISOString();
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

export class MemoryStore implements Store {
  private readonly tenants = new Map<string, Tenant>();
  private readonly users = new Map<string, User>();
  private readonly domains = new Map<string, TenantDomain>();
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly callbackNonces = new Map<string, string>();
  private readonly channelCredentials = new Map<string, ChannelCredential>();
  private readonly personas = new Map<string, Persona>();
  private readonly intentCatalogVersions = new Map<string, IntentCatalogVersion[]>();
  private readonly personaVersions = new Map<string, PersonaVersion[]>();
  private readonly sources = new Map<string, Source>();
  private readonly sourceVersions = new Map<string, SourceVersion[]>();
  private readonly ingestionJobs = new Map<string, IngestionJob>();
  private readonly chunks = new Map<string, Chunk>();
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, Message>();
  private readonly actions = new Map<string, ActionRequest>();
  private readonly crmLeads = new Map<string, CrmLead>();
  private readonly crmLeadDedupe = new Map<string, string>();
  private readonly supportingDocuments = new Map<string, SupportingDocument>();
  private readonly documentJobs = new Map<string, DocumentProcessingJob>();
  private readonly outbox = new Map<string, OutboxEvent>();
  private readonly deadLetteredOutbox = new Set<string>();
  private readonly publishedDeadLetterProjections = new Set<string>();
  private readonly inbox = new Map<string, { state: EventInboxState; attempts: number; leaseExpiresAt: number | null; retryAt: number | null; lastError: string | null; dlqEvent?: OutboxEvent; dlqReason?: string; dlqPublished?: boolean; dlqLeaseExpiresAt?: number | null }>();
  private readonly actionExecutions = new Map<string, ActionExecution>();
  private readonly audits: AuditEvent[] = [];

  async countUsers(): Promise<number> { return this.users.size; }

  async createTenant(input: { name: string; slug: string }): Promise<Tenant> {
    const tenant: Tenant = { id: randomUUID(), name: input.name, slug: input.slug, status: 'active', publicChatEnabled: true, publicOrigin: null, catalogQueryNormalizationEnabled: false, createdAt: now() };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  async getTenant(id: string): Promise<Tenant | null> { return this.tenants.get(id) ?? null; }
  async getTenantBySlug(slug: string): Promise<Tenant | null> { return [...this.tenants.values()].find((tenant) => tenant.slug === slug) ?? null; }
  async listTenants(): Promise<Tenant[]> { return [...this.tenants.values()]; }
  async setTenantStatus(id: string, status: TenantStatus): Promise<Tenant | null> {
    const tenant = this.tenants.get(id);
    if (!tenant) return null;
    const updated = { ...tenant, status };
    this.tenants.set(id, updated);
    return updated;
  }
  async setTenantPublicOrigin(id: string, publicOrigin: string | null): Promise<Tenant | null> {
    const tenant = this.tenants.get(id);
    if (!tenant) return null;
    const updated = { ...tenant, publicOrigin };
    this.tenants.set(id, updated);
    return updated;
  }
  async setTenantPublicChatEnabled(id: string, enabled: boolean): Promise<Tenant | null> { const tenant = this.tenants.get(id); if (!tenant) return null; const updated = { ...tenant, publicChatEnabled: enabled }; this.tenants.set(id, updated); return updated; }
  async setTenantCatalogQueryNormalizationEnabled(id: string, enabled: boolean): Promise<Tenant | null> { const tenant = this.tenants.get(id); if (!tenant) return null; const updated = { ...tenant, catalogQueryNormalizationEnabled: enabled }; this.tenants.set(id, updated); return updated; }
  async updateUserRole(userId: string, tenantId: string, role: Exclude<User['role'], 'platform_admin' | 'tenant_admin'>): Promise<User | null> { const user = this.users.get(userId); if (!user || user.tenantId !== tenantId || user.role === 'tenant_admin') return null; const updated = { ...user, role }; this.users.set(userId, updated); return updated; }
  async listUsers(tenantId: string): Promise<User[]> { return [...this.users.values()].filter((user) => user.tenantId === tenantId); }
  async listDomains(tenantId: string): Promise<TenantDomain[]> { return [...this.domains.values()].filter((domain) => domain.tenantId === tenantId); }
  async addDomain(input: { tenantId: string; hostname: string }): Promise<TenantDomain> {
    const domain: TenantDomain = { id: randomUUID(), tenantId: input.tenantId, hostname: input.hostname, createdAt: now() };
    this.domains.set(domain.id, domain);
    return domain;
  }
  async removeDomain(id: string, tenantId: string): Promise<boolean> {
    const domain = this.domains.get(id);
    if (!domain || domain.tenantId !== tenantId) return false;
    this.domains.delete(id);
    return true;
  }

  async createUser(input: { email: string; passwordHash: string; role: User['role']; tenantId: string | null }): Promise<User> {
    const user: User = { id: randomUUID(), email: input.email.toLowerCase(), passwordHash: input.passwordHash, role: input.role, tenantId: input.tenantId, createdAt: now() };
    this.users.set(user.id, user);
    return user;
  }

  async getUserByEmail(email: string): Promise<User | null> { return [...this.users.values()].find((user) => user.email === email.toLowerCase()) ?? null; }
  async getUser(id: string): Promise<User | null> { return this.users.get(id) ?? null; }
  async createAuthSession(session: AuthSession): Promise<AuthSession> { this.authSessions.set(session.tokenHash, session); return session; }
  async getAuthSession(tokenHash: string): Promise<AuthSession | null> { return this.authSessions.get(tokenHash) ?? null; }
  async revokeAuthSession(tokenHash: string): Promise<void> { const session = this.authSessions.get(tokenHash); if (session) this.authSessions.set(tokenHash, { ...session, revokedAt: now() }); }
  async claimCallbackNonce(nonce: string, expiresAt: string): Promise<boolean> {
    const current = this.callbackNonces.get(nonce);
    if (current && Date.parse(current) > Date.now()) return false;
    this.callbackNonces.set(nonce, expiresAt);
    return true;
  }
  async createChannelCredential(input: Omit<ChannelCredential, 'createdAt' | 'revokedAt'>): Promise<ChannelCredential> { const credential: ChannelCredential = { ...input, createdAt: now(), revokedAt: null }; this.channelCredentials.set(credential.id, credential); return credential; }
  async getChannelCredential(keyId: string): Promise<ChannelCredential | null> { return [...this.channelCredentials.values()].find((credential) => credential.keyId === keyId) ?? null; }
  async getChannelCredentialByApiKeyHash(apiKeyHash: string): Promise<ChannelCredential | null> { return [...this.channelCredentials.values()].find((credential) => credential.apiKeyHash === apiKeyHash) ?? null; }
  async listChannelCredentials(tenantId: string): Promise<ChannelCredential[]> { return [...this.channelCredentials.values()].filter((credential) => credential.tenantId === tenantId).sort((left, right) => right.createdAt.localeCompare(left.createdAt)); }
  async revokeChannelCredential(id: string, tenantId: string): Promise<ChannelCredential | null> { const credential = this.channelCredentials.get(id); if (!credential || credential.tenantId !== tenantId) return null; const updated = { ...credential, active: false, revokedAt: now() }; this.channelCredentials.set(id, updated); return updated; }

  async setPersona(persona: Persona): Promise<Persona> { this.personas.set(persona.tenantId, persona); return persona; }
  async getPersona(tenantId: string): Promise<Persona | null> { return this.personas.get(tenantId) ?? null; }
  async createIntentCatalogVersion(input: Omit<IntentCatalogVersion, 'id' | 'version' | 'createdAt' | 'publishedAt'>): Promise<IntentCatalogVersion> {
    const versions = this.intentCatalogVersions.get(input.tenantId) ?? [];
    const version: IntentCatalogVersion = { ...input, id: randomUUID(), version: versions.length + 1, createdAt: now(), publishedAt: null };
    this.intentCatalogVersions.set(input.tenantId, [...versions, version]);
    return version;
  }
  async listIntentCatalogVersions(tenantId: string): Promise<IntentCatalogVersion[]> { return [...(this.intentCatalogVersions.get(tenantId) ?? [])].sort((left, right) => right.version - left.version); }
  async getIntentCatalogVersion(tenantId: string, versionId: string): Promise<IntentCatalogVersion | null> { return (this.intentCatalogVersions.get(tenantId) ?? []).find((version) => version.id === versionId) ?? null; }
  async getPublishedIntentCatalog(tenantId: string): Promise<IntentCatalogVersion | null> { return (await this.listIntentCatalogVersions(tenantId)).find((version) => version.status === 'published') ?? null; }
  async publishIntentCatalogVersion(tenantId: string, versionId: string): Promise<IntentCatalogVersion | null> {
    const versions = this.intentCatalogVersions.get(tenantId) ?? [];
    if (!versions.some((version) => version.id === versionId)) return null;
    const publishedAt = now();
    const updated = versions.map((version) => ({ ...version, status: version.id === versionId ? 'published' as const : 'draft' as const, publishedAt: version.id === versionId ? publishedAt : version.publishedAt }));
    this.intentCatalogVersions.set(tenantId, updated);
    return updated.find((version) => version.id === versionId) ?? null;
  }
  async createPersonaVersion(input: Omit<PersonaVersion, 'id' | 'version' | 'createdAt' | 'publishedAt'>): Promise<PersonaVersion> {
    const versions = this.personaVersions.get(input.tenantId) ?? [];
    const version: PersonaVersion = { ...input, id: randomUUID(), version: versions.length + 1, createdAt: now(), publishedAt: input.status === 'published' ? now() : null };
    this.personaVersions.set(input.tenantId, [...versions, version]);
    return version;
  }
  async listPersonaVersions(tenantId: string): Promise<PersonaVersion[]> { return [...(this.personaVersions.get(tenantId) ?? [])].sort((left, right) => right.version - left.version); }
  async getPersonaVersion(tenantId: string, versionId: string): Promise<PersonaVersion | null> { return (this.personaVersions.get(tenantId) ?? []).find((version) => version.id === versionId) ?? null; }
  async publishPersonaVersion(tenantId: string, versionId: string): Promise<PersonaVersion | null> {
    const versions = this.personaVersions.get(tenantId) ?? [];
    const selected = versions.find((version) => version.id === versionId);
    if (!selected) return null;
    const publishedAt = now();
    const updated = versions.map((version) => ({ ...version, status: version.id === versionId ? 'published' as const : 'draft' as const, publishedAt: version.id === versionId ? publishedAt : version.publishedAt }));
    this.personaVersions.set(tenantId, updated);
    await this.setPersona({ tenantId, name: selected.name, greeting: selected.greeting, personality: selected.personality, tone: selected.tone, speakingStyle: selected.speakingStyle, permittedLanguages: selected.permittedLanguages, contextWindowMessages: selected.contextWindowMessages, voiceName: selected.voiceName, voiceLanguage: selected.voiceLanguage, voiceRate: selected.voiceRate, voicePitch: selected.voicePitch, voiceVolume: selected.voiceVolume });
    return updated.find((version) => version.id === versionId) ?? null;
  }

  async createSource(input: Omit<Source, 'createdAt' | 'approvedAt'> & { chunks: Chunk[] }): Promise<Source> {
    const source: Source = { ...input, createdAt: now(), approvedAt: null };
    this.sources.set(source.id, source);
    this.sourceVersions.set(source.id, [{ sourceId: source.id, tenantId: source.tenantId, versionId: source.versionId, contentHash: source.contentHash, createdAt: source.createdAt }]);
    for (const chunk of input.chunks) this.chunks.set(chunk.id, chunk);
    return source;
  }
  async getSource(id: string): Promise<Source | null> { return this.sources.get(id) ?? null; }
  async findSourceByHash(tenantId: string, hash: string): Promise<Source | null> { return [...this.sources.values()].find((source) => source.tenantId === tenantId && source.contentHash === hash) ?? null; }
  async listSources(tenantId: string): Promise<Source[]> { return [...this.sources.values()].filter((source) => source.tenantId === tenantId); }
  async setSourceStatus(id: string, tenantId: string, status: SourceStatus): Promise<Source | null> {
    const source = this.sources.get(id);
    if (!source || source.tenantId !== tenantId) return null;
    const updated = { ...source, status, approvedAt: status === 'active' ? now() : source.approvedAt };
    this.sources.set(id, updated);
    return updated;
  }
  async purgeSource(id: string, tenantId: string): Promise<boolean> {
    const source = this.sources.get(id);
    if (!source || source.tenantId !== tenantId || source.status !== 'revoked') return false;
    this.sources.delete(id);
    this.sourceVersions.delete(id);
    for (const [chunkId, chunk] of this.chunks) if (chunk.sourceId === id) this.chunks.delete(chunkId);
    return true;
  }
  async listSourceChunks(sourceId: string, tenantId: string): Promise<Chunk[]> { const source = this.sources.get(sourceId); return source && source.tenantId === tenantId ? [...this.chunks.values()].filter((chunk) => chunk.sourceId === sourceId && chunk.tenantId === tenantId && chunk.versionId === source.versionId).sort((left, right) => left.ordinal - right.ordinal) : []; }
  async listSourceVersions(sourceId: string, tenantId: string): Promise<SourceVersion[]> { const source = this.sources.get(sourceId); return source && source.tenantId === tenantId ? [...(this.sourceVersions.get(sourceId) ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)) : []; }
  async replaceSourceVersion(input: { sourceId: string; tenantId: string; versionId: string; contentHash: string; chunks: Chunk[] }): Promise<Source | null> {
    const source = this.sources.get(input.sourceId);
    if (!source || source.tenantId !== input.tenantId) return null;
    for (const chunk of input.chunks) this.chunks.set(chunk.id, chunk);
    const createdAt = now();
    this.sourceVersions.set(source.id, [...(this.sourceVersions.get(source.id) ?? []), { sourceId: source.id, tenantId: source.tenantId, versionId: input.versionId, contentHash: input.contentHash, createdAt }]);
    const updated: Source = { ...source, versionId: input.versionId, contentHash: input.contentHash, status: 'awaiting_review', approvedAt: null };
    this.sources.set(source.id, updated);
    return updated;
  }
  async createIngestionJob(input: { id: string; tenantId: string; title: string; mimeType: string; sourceUrl: string | null; audience: 'public' | 'internal' }): Promise<IngestionJob> {
    const timestamp = now();
    const job: IngestionJob = { id: input.id, tenantId: input.tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl, audience: input.audience, sourceId: null, status: 'queued', attempts: 0, errorCode: null, errorDetail: null, leaseExpiresAt: null, createdAt: timestamp, updatedAt: timestamp };
    this.ingestionJobs.set(job.id, job);
    return job;
  }
  async getIngestionJob(id: string): Promise<IngestionJob | null> { return this.ingestionJobs.get(id) ?? null; }
  async listIngestionJobs(tenantId: string): Promise<IngestionJob[]> { return [...this.ingestionJobs.values()].filter((job) => job.tenantId === tenantId).sort((left, right) => right.createdAt.localeCompare(left.createdAt)); }
  async claimIngestionJob(id: string, leaseMs: number): Promise<IngestionJob | null> {
    const job = this.ingestionJobs.get(id);
    if (!job) return null;
    const nowMs = Date.now();
    if (job.status !== 'queued' && !(job.status === 'processing' && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= nowMs)) return null;
    const updated: IngestionJob = { ...job, status: 'processing', attempts: job.attempts + 1, leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(), updatedAt: now() };
    this.ingestionJobs.set(id, updated);
    return updated;
  }
  async claimNextIngestionJob(leaseMs: number): Promise<IngestionJob | null> {
    const nowMs = Date.now();
    const next = [...this.ingestionJobs.values()]
      .filter((job) => job.status === 'queued' || (job.status === 'processing' && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= nowMs))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    return next ? this.claimIngestionJob(next.id, leaseMs) : null;
  }
  async updateIngestionJob(job: IngestionJob): Promise<IngestionJob> { this.ingestionJobs.set(job.id, job); return job; }
  async listSearchableChunks(tenantId: string, audience: 'public' | 'internal'): Promise<Array<{ source: Source; chunk: Chunk }>> {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.tenantId === tenantId)
      .flatMap((chunk) => {
        const source = this.sources.get(chunk.sourceId);
        if (!source || source.status !== 'active' || chunk.versionId !== source.versionId || (source.audience !== 'public' && audience !== 'internal')) return [];
        return [{ source, chunk }];
      });
  }
  async searchSearchableChunks(tenantId: string, audience: 'public' | 'internal', _queryEmbedding: number[], limit: number, queryText = ''): Promise<Array<{ source: Source; chunk: Chunk }>> {
    const terms = queryText.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    return (await this.listSearchableChunks(tenantId, audience)).sort((left, right) => {
      const overlap = (row: { chunk: Chunk }): number => terms.filter((term) => row.chunk.content.toLocaleLowerCase('en-US').includes(term)).length;
      return overlap(right) - overlap(left);
    }).slice(0, limit);
  }

  async createSession(tenantId: string, personaVersionId: string | null = null): Promise<Session> {
    const timestamp = now();
    const session: Session = { id: randomUUID(), tenantId, createdAt: timestamp, lastActivityAt: timestamp, closedAt: null, personaVersionId, tokenMap: new Map(), conversationState: newConversationState(), stateVersion: 0 };
    this.sessions.set(session.id, session);
    return session;
  }
  async getSession(id: string): Promise<Session | null> { const existing = this.sessions.get(id); return existing ? structuredClone(existing) : null; }
  async listExpiredSupportingDocuments(tenantId: string, before: string): Promise<SupportingDocument[]> {
    const cutoff = Date.parse(before);
    const leadSessionIds = new Set([...this.crmLeads.values()].map((lead) => lead.sessionId));
    const expiredSessionIds = new Set([...this.sessions.values()].filter((session) => session.tenantId === tenantId && Date.parse(session.lastActivityAt) < cutoff && !leadSessionIds.has(session.id)).map((session) => session.id));
    return [...this.supportingDocuments.values()].filter((document) => document.tenantId === tenantId && expiredSessionIds.has(document.sessionId));
  }
  async purgeExpiredSessions(tenantId: string, before: string): Promise<number> {
    const cutoff = Date.parse(before);
    const leadSessionIds = new Set([...this.crmLeads.values()].map((l) => l.sessionId));
    const expired = [...this.sessions.values()].filter((session) => session.tenantId === tenantId && Date.parse(session.lastActivityAt) < cutoff && !leadSessionIds.has(session.id));
    for (const session of expired) {
      this.sessions.delete(session.id);
      for (const [messageId, message] of this.messages) if (message.sessionId === session.id) this.messages.delete(messageId);
      for (const [actionId, action] of this.actions) if (action.sessionId === session.id) this.actions.delete(actionId);
      for (const [documentId, document] of this.supportingDocuments) if (document.sessionId === session.id) {
        this.supportingDocuments.delete(documentId);
        for (const [jobId, job] of this.documentJobs) if (job.documentId === documentId) this.documentJobs.delete(jobId);
      }
    }
    return expired.length;
  }
  async updateSession(session: Session): Promise<Session> {
    const current = this.sessions.get(session.id);
    if (!current || current.stateVersion !== session.stateVersion) throw new HttpError(409, 'SESSION_STATE_CONFLICT', 'Another message changed this conversation. Retry with the latest prompt.');
    session.stateVersion = (session.stateVersion ?? 0) + 1;
    this.sessions.set(session.id, structuredClone(session));
    return session;
  }
  async addMessage(message: Message): Promise<Message> { this.messages.set(message.id, message); return message; }
  async updateMessage(message: Message): Promise<Message> { this.messages.set(message.id, message); return message; }
  async listMessages(sessionId: string, tenantId: string, limit?: number): Promise<Message[]> {
    const messages = [...this.messages.values()].filter((message) => message.sessionId === sessionId && message.tenantId === tenantId).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return limit === undefined ? messages : messages.slice(-limit);
  }
  async getMessageByClientId(sessionId: string, clientMessageId: string): Promise<Message | null> {
    return [...this.messages.values()].find((message) => message.sessionId === sessionId && message.clientMessageId === clientMessageId) ?? null;
  }

  async createAction(action: ActionRequest): Promise<ActionRequest> { this.actions.set(action.id, action); return action; }
  async approveAction(action: ActionRequest): Promise<ActionRequest> {
    const current = this.actions.get(action.id);
    if (!current || current.tenantId !== action.tenantId) throw new Error('Action not found.');
    if (current.state === 'approved' || current.state === 'processing' || current.state === 'completed') return current;
    this.actions.set(action.id, action);
    if (isUuid(action.tenantId) && isUuid(action.sessionId) && isUuid(action.id)) await this.enqueueOutboxEvent(createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId: action.tenantId, sessionId: action.sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId: action.sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? null, catalogVersionId: action.catalogVersionId ?? null } }));
    return action;
  }
  async approveActionAndSession(action: ActionRequest, session: Session): Promise<ActionRequest> {
    const current = this.actions.get(action.id);
    if (!current || current.tenantId !== action.tenantId) throw new Error('Action not found.');
    if (current.state === 'approved' || current.state === 'processing' || current.state === 'completed') {
      await this.updateSession(session);
      return current;
    }
    await this.updateSession(session);
    this.actions.set(action.id, action);
    if (isUuid(action.tenantId) && isUuid(action.sessionId) && isUuid(action.id)) await this.enqueueOutboxEvent(createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId: action.tenantId, sessionId: action.sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId: action.sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? null, catalogVersionId: action.catalogVersionId ?? null } }));
    return action;
  }
  async getAction(id: string): Promise<ActionRequest | null> { return this.actions.get(id) ?? null; }
  async getActionByIdempotency(tenantId: string, idempotencyKey: string): Promise<ActionRequest | null> {
    return [...this.actions.values()].find((action) => action.tenantId === tenantId && action.idempotencyKey === idempotencyKey) ?? null;
  }
  async updateAction(action: ActionRequest): Promise<ActionRequest> { this.actions.set(action.id, action); return action; }
  async transitionAction(actionId: string, tenantId: string, fromState: ActionRequest['state'], toState: ActionRequest['state'], result: ActionRequest['result']): Promise<ActionRequest | null> {
    const current = this.actions.get(actionId);
    if (!current || current.tenantId !== tenantId || current.state !== fromState) return null;
    const updated = { ...current, state: toState, result };
    this.actions.set(actionId, updated);
    return updated;
  }
  async transitionActionWithExecution(input: { actionId: string; tenantId: string; fromState: ActionRequest['state']; toState: ActionRequest['state']; result: ActionRequest['result']; providerStatus: string; n8nExecutionRef: string; eventId: string; correlationId: string; expectedAttempt: number; resolveReconciliation?: boolean; outcome?: ActionExecution['outcome'] }): Promise<{ action: ActionRequest; execution: ActionExecution } | null> {
    const action = this.actions.get(input.actionId);
    const execution = await this.getActionExecution(input.actionId, input.tenantId);
    if (!action || action.tenantId !== input.tenantId || !execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.expectedAttempt || (execution.n8nExecutionRef && execution.n8nExecutionRef !== input.n8nExecutionRef)) return null;
    if (action.state === input.toState && execution.providerStatus === input.providerStatus) return { action, execution };
    if (action.state !== input.fromState || ['completed', 'failed'].includes(execution.providerStatus) || (execution.providerStatus === 'reconcile_required' && !(input.resolveReconciliation === true && input.providerStatus === 'completed'))) return null;
    const updatedAction = { ...action, state: input.toState, result: input.result };
    const updatedExecution = { ...execution, providerStatus: input.providerStatus, n8nExecutionRef: input.n8nExecutionRef, outcome: { ...(execution.outcome ?? {}), ...(input.outcome ?? {}) }, updatedAt: now() };
    this.actions.set(action.id, updatedAction);
    this.actionExecutions.set(execution.id, updatedExecution);
    return { action: updatedAction, execution: updatedExecution };
  }
  async claimWorkflowActionsWithExecutions(input: { actionId?: string; tenantId?: string; n8nWorkflowId: string; executionReference: string; workflowKey?: string; limit: number; eventId?: string; correlationId?: string; attempt: number; deadlineAt: string }): Promise<WorkflowActionClaim[]> {
    if (input.actionId) {
      if (!input.tenantId || !input.eventId || !input.correlationId) throw new HttpError(422, 'WORKFLOW_CLAIM_CORRELATION_REQUIRED', 'Webhook claims require the server-issued tenant, event, correlation and attempt tuple.');
      const action = this.actions.get(input.actionId);
      if (!action || action.tenantId !== input.tenantId) throw new HttpError(409, 'WORKFLOW_CLAIM_MISMATCH', 'The webhook claim does not match the authorized tenant action.');
      if (!['approved', 'processing'].includes(action.state) || (input.workflowKey && action.workflowKey !== input.workflowKey)) throw new HttpError(409, 'WORKFLOW_CLAIM_MISMATCH', 'The webhook claim does not match the active workflow action.');
      const version = action.catalogVersionId ? this.intentCatalogVersions.get(action.tenantId)?.find((item) => item.id === action.catalogVersionId) : null;
      const binding = version?.catalog.workflowBindings.find((item) => item.workflowKey === action.workflowKey);
      if (!binding?.active || !isWorkflowClaimableBinding(binding) || binding.n8nWorkflowId !== input.n8nWorkflowId) throw new HttpError(409, 'WORKFLOW_CLAIM_MISMATCH', 'The webhook claim does not match the published workflow binding.');
      const execution = [...this.actionExecutions.values()].find((item) => item.actionId === action.id && item.tenantId === action.tenantId && item.idempotencyKey === action.idempotencyKey);
      if (!execution || execution.eventId !== input.eventId || execution.correlationId !== input.correlationId || execution.attempt !== input.attempt || ['completed', 'failed', 'reconcile_required'].includes(execution.providerStatus)) throw new HttpError(409, 'WORKFLOW_CLAIM_MISMATCH', 'The webhook claim does not match the durable workflow execution.');
      if (execution.n8nExecutionRef) {
        if (execution.n8nExecutionRef === input.executionReference) return [];
        throw new HttpError(409, 'WORKFLOW_CLAIM_CONFLICT', 'The workflow action is already owned by another n8n execution.');
      }
      if (!['dispatching', 'accepted', 'processing'].includes(execution.providerStatus)) throw new HttpError(409, 'WORKFLOW_CLAIM_MISMATCH', 'The durable workflow execution is not claimable.');
      const ownedExecution = { ...execution, n8nExecutionRef: input.executionReference, updatedAt: now() };
      this.actionExecutions.set(execution.id, ownedExecution);
      const updated = action.state === 'approved' ? { ...action, state: 'processing' as const } : action;
      this.actions.set(updated.id, updated);
      return [{ action: updated, execution: ownedExecution }];
    }
    const candidates = [...this.actions.values()]
      .filter((action) => action.state === 'approved' && (!input.actionId || action.id === input.actionId) && (!input.workflowKey || action.workflowKey === input.workflowKey))
      .filter((action) => {
        if (!action.catalogVersionId || [...this.actionExecutions.values()].some((execution) => execution.actionId === action.id && execution.tenantId === action.tenantId)) return false;
        const version = this.intentCatalogVersions.get(action.tenantId)?.find((item) => item.id === action.catalogVersionId);
        const binding = version?.catalog.workflowBindings.find((item) => item.workflowKey === action.workflowKey);
        return Boolean(binding?.active && isWorkflowClaimableBinding(binding) && binding.n8nWorkflowId === input.n8nWorkflowId);
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, input.limit);
    const claims: WorkflowActionClaim[] = [];
    for (const candidate of candidates) {
      const current = this.actions.get(candidate.id);
      if (!current || current.state !== 'approved' || [...this.actionExecutions.values()].some((execution) => execution.actionId === current.id && execution.tenantId === current.tenantId)) continue;
      const eventId = input.actionId && input.eventId ? input.eventId : randomUUID();
      const correlationId = input.actionId && input.correlationId ? input.correlationId : randomUUID();
      const execution: ActionExecution = { id: randomUUID(), actionId: current.id, tenantId: current.tenantId, workflowKey: current.workflowKey, catalogVersionId: current.catalogVersionId ?? null, providerStatus: 'dispatching', n8nExecutionRef: input.executionReference, eventId, correlationId, idempotencyKey: current.idempotencyKey, attempt: input.attempt, deadlineAt: input.deadlineAt, outcome: { eventId, correlationId }, createdAt: now(), updatedAt: now() };
      this.actionExecutions.set(execution.id, execution);
      const updated = { ...current, state: 'processing' as const };
      this.actions.set(updated.id, updated);
      claims.push({ action: updated, execution });
    }
    return claims;
  }
  async claimAction(actionId: string, workflowKey: string): Promise<ActionRequest | null> {
    const action = this.actions.get(actionId);
    if (!action || action.workflowKey !== workflowKey || action.state !== 'approved') return null;
    const claimed = { ...action, state: 'processing' as const };
    this.actions.set(actionId, claimed);
    return claimed;
  }
  async claimActionsForWorkflow(n8nWorkflowId: string, workflowKey: string | undefined, limit: number): Promise<ActionRequest[]> {
    const candidates = [...this.actions.values()]
      .filter((action) => action.state === 'approved' && (!workflowKey || action.workflowKey === workflowKey))
      .filter((action) => {
        if (!action.catalogVersionId) return false;
        const version = this.intentCatalogVersions.get(action.tenantId)?.find((item) => item.id === action.catalogVersionId);
        const binding = version?.catalog.workflowBindings.find((item) => item.workflowKey === action.workflowKey);
        return Boolean(binding?.active && isWorkflowClaimableBinding(binding) && binding.n8nWorkflowId === n8nWorkflowId);
      })
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    const claimed: ActionRequest[] = [];
    for (const candidate of candidates.slice(0, limit)) {
      const current = this.actions.get(candidate.id);
      if (!current || current.state !== 'approved') continue;
      const updated = { ...current, state: 'processing' as const };
      this.actions.set(updated.id, updated);
      claimed.push(updated);
    }
    return claimed;
  }
  async listActions(tenantId: string): Promise<ActionRequest[]> { return [...this.actions.values()].filter((action) => action.tenantId === tenantId); }
  async listActionsBySession(sessionId: string, tenantId: string): Promise<ActionRequest[]> { return [...this.actions.values()].filter((action) => action.sessionId === sessionId && action.tenantId === tenantId); }
  async createCrmLead(lead: CrmLead): Promise<CrmLead> { this.crmLeads.set(lead.id, lead); return lead; }
  async upsertCrmLead(lead: CrmLead, dedupeKey: string): Promise<CrmLead> {
    const key = `${lead.tenantId}:${dedupeKey}`;
    const existingId = this.crmLeadDedupe.get(key);
    const existing = existingId ? this.crmLeads.get(existingId) : undefined;
    if (existing) {
      const updated = { ...lead, id: existing.id, createdAt: existing.createdAt, updatedAt: now() };
      this.crmLeads.set(existing.id, updated);
      return updated;
    }
    this.crmLeadDedupe.set(key, lead.id);
    this.crmLeads.set(lead.id, lead);
    return lead;
  }
  async getCrmLeadByActionId(actionId: string, tenantId: string): Promise<CrmLead | null> { return [...this.crmLeads.values()].find((lead) => lead.actionId === actionId && lead.tenantId === tenantId) ?? null; }
  async getCrmLeadBySessionId(sessionId: string, tenantId: string): Promise<CrmLead | null> { return [...this.crmLeads.values()].find((lead) => lead.sessionId === sessionId && lead.tenantId === tenantId) ?? null; }
  async getCrmLead(id: string, tenantId: string): Promise<CrmLead | null> { const lead = this.crmLeads.get(id); return lead?.tenantId === tenantId ? lead : null; }
  async listCrmLeads(tenantId: string): Promise<CrmLead[]> { return [...this.crmLeads.values()].filter((lead) => lead.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async updateCrmLeadSummary(id: string, tenantId: string, summary: string, status: CrmLead['summaryStatus']): Promise<CrmLead | null> {
    const lead = await this.getCrmLead(id, tenantId);
    if (!lead) return null;
    const updated = { ...lead, summary: formatCrmSummarySpec(summary), summaryStatus: status, updatedAt: now() };
    this.crmLeads.set(id, updated);
    return updated;
  }
  async updateCrmLeadScore(id: string, tenantId: string, score: number): Promise<CrmLead | null> {
    const lead = await this.getCrmLead(id, tenantId);
    if (!lead) return null;
    const updated = { ...lead, score, updatedAt: now() };
    this.crmLeads.set(id, updated);
    return updated;
  }
  async updateCrmLeadRemote(input: { id: string; tenantId: string; leadId: string; remoteCrm: string }): Promise<CrmLead | null> {
    const lead = await this.getCrmLead(input.id, input.tenantId);
    if (!lead) return null;
    const updated = { ...lead, leadId: input.leadId, remoteCrm: input.remoteCrm, updatedAt: now() };
    this.crmLeads.set(input.id, updated);
    return updated;
  }
  async createSupportingDocument(document: SupportingDocument): Promise<SupportingDocument> { this.supportingDocuments.set(document.id, document); return document; }
  async createSupportingDocumentWithJob(document: SupportingDocument, job: DocumentProcessingJob): Promise<void> {
    this.supportingDocuments.set(document.id, document);
    this.documentJobs.set(job.id, job);
    await this.enqueueOutboxEvent(createOutboxEvent({ eventId: randomUUID(), eventType: 'document.extraction.requested.v1', tenantId: document.tenantId, sessionId: document.sessionId, aggregateId: document.id, workflowKey: job.workflowKey, payloadRef: job.id, idempotencyKey: `document:${job.id}`, payload: { documentId: document.id, jobId: job.id, sessionId: document.sessionId, workflowKey: job.workflowKey, webhookPath: job.webhookPath } }));
  }
  async getSupportingDocument(id: string, tenantId: string): Promise<SupportingDocument | null> { const document = this.supportingDocuments.get(id); return document?.tenantId === tenantId ? document : null; }
  async listSupportingDocuments(tenantId: string, sessionId?: string, leadId?: string): Promise<SupportingDocument[]> { return [...this.supportingDocuments.values()].filter((document) => document.tenantId === tenantId && (!sessionId || document.sessionId === sessionId) && (!leadId || document.leadId === leadId)).sort((left, right) => right.createdAt.localeCompare(left.createdAt)); }
  async updateSupportingDocument(document: SupportingDocument): Promise<SupportingDocument> { this.supportingDocuments.set(document.id, document); return document; }
  async createDocumentProcessingJob(job: DocumentProcessingJob): Promise<DocumentProcessingJob> { this.documentJobs.set(job.id, job); return job; }
  async getDocumentProcessingJob(id: string, tenantId: string): Promise<DocumentProcessingJob | null> { const job = this.documentJobs.get(id); return job?.tenantId === tenantId ? job : null; }
  async claimNextDocumentProcessingJob(leaseMs: number): Promise<DocumentProcessingJob | null> {
    const candidate = [...this.documentJobs.values()].find((job) => job.status === 'queued' || (job.status === 'processing' && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= Date.now()));
    if (!candidate) return null;
    const claimed = { ...candidate, status: 'processing' as const, attempts: candidate.attempts + 1, leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(), updatedAt: now() };
    this.documentJobs.set(candidate.id, claimed); return claimed;
  }
  async renewDocumentProcessingJob(id: string, tenantId: string, leaseMs: number): Promise<DocumentProcessingJob | null> {
    const job = await this.getDocumentProcessingJob(id, tenantId);
    if (!job || job.status !== 'processing' || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) return null;
    const renewed = { ...job, leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(), updatedAt: now() };
    this.documentJobs.set(id, renewed);
    return renewed;
  }
  async updateDocumentProcessingJob(job: DocumentProcessingJob): Promise<DocumentProcessingJob> { this.documentJobs.set(job.id, job); return job; }
  async linkSessionDocuments(sessionId: string, tenantId: string, leadId: string): Promise<void> { for (const document of await this.listSupportingDocuments(tenantId, sessionId)) this.supportingDocuments.set(document.id, { ...document, leadId, updatedAt: now() }); }
  async enqueueOutboxEvent(event: OutboxEvent): Promise<OutboxEvent> { const existing = this.outbox.get(event.eventId); if (existing) return existing; this.outbox.set(event.eventId, event); return event; }
  async claimOutboxEvents(limit: number, leaseMs: number): Promise<OutboxEvent[]> {
    const current = Date.now();
    const claimed = [...this.outbox.values()].filter((event) => !event.publishedAt && !this.deadLetteredOutbox.has(event.eventId) && (!event.leaseExpiresAt || Date.parse(event.leaseExpiresAt) <= current)).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)).slice(0, limit).map((event) => ({ ...event, attempts: event.attempts + 1, leaseExpiresAt: new Date(current + leaseMs).toISOString() }));
    for (const event of claimed) this.outbox.set(event.eventId, event);
    return claimed;
  }
  async markOutboxPublished(eventId: string, publishedAt = now()): Promise<void> { const event = this.outbox.get(eventId); if (event) this.outbox.set(eventId, { ...event, publishedAt, leaseExpiresAt: null, lastError: null }); }
  async releaseOutboxEvent(eventId: string, error: string, retryAt: string): Promise<void> { const event = this.outbox.get(eventId); if (event) this.outbox.set(eventId, { ...event, leaseExpiresAt: retryAt, lastError: error.slice(0, 500) }); }
  async deadLetterOutboxEvent(eventId: string, error: string): Promise<void> { const event = this.outbox.get(eventId); if (event) { this.deadLetteredOutbox.add(eventId); this.publishedDeadLetterProjections.delete(eventId); this.outbox.set(eventId, { ...event, leaseExpiresAt: null, lastError: error.slice(0, 500) }); } }
  async claimDeadLetterOutboxEvents(limit: number, _leaseMs: number): Promise<OutboxEvent[]> { return [...this.deadLetteredOutbox].filter((eventId) => !this.publishedDeadLetterProjections.has(eventId)).map((eventId) => this.outbox.get(eventId)).filter((event): event is OutboxEvent => Boolean(event)).slice(0, limit); }
  async markOutboxDeadLetterPublished(eventId: string): Promise<void> { if (this.deadLetteredOutbox.has(eventId)) this.publishedDeadLetterProjections.add(eventId); }
  async claimInboxEvent(consumer: string, eventId: string, leaseMs = 30_000): Promise<EventInboxClaim> {
    const key = `${consumer}:${eventId}`;
    const existing = this.inbox.get(key);
    const current = Date.now();
    if (!existing) { this.inbox.set(key, { state: 'processing', attempts: 1, leaseExpiresAt: current + leaseMs, retryAt: null, lastError: null, dlqPublished: false, dlqLeaseExpiresAt: null }); return { state: 'processing', attempts: 1, claimed: true, dlqPublished: false }; }
    if (existing.state === 'completed' || existing.state === 'reconcile_required' || existing.state === 'dead_lettered') return { state: existing.state, attempts: existing.attempts, claimed: false, dlqPublished: existing.dlqPublished === true };
    if (existing.state === 'processing' && existing.leaseExpiresAt && existing.leaseExpiresAt > current) return { state: 'processing', attempts: existing.attempts, claimed: false, dlqPublished: existing.dlqPublished === true };
    if (existing.state === 'retry_scheduled' && existing.retryAt && existing.retryAt > current) return { state: 'retry_scheduled', attempts: existing.attempts, claimed: false, dlqPublished: existing.dlqPublished === true };
    existing.state = 'processing'; existing.attempts += 1; existing.leaseExpiresAt = current + leaseMs; existing.retryAt = null; existing.lastError = null;
    return { state: 'processing', attempts: existing.attempts, claimed: true, dlqPublished: false };
  }
  async completeInboxEvent(consumer: string, eventId: string): Promise<void> { const item = this.inbox.get(`${consumer}:${eventId}`); if (item) { item.state = 'completed'; item.leaseExpiresAt = null; item.retryAt = null; } }
  async scheduleInboxRetry(consumer: string, eventId: string, error: string, retryAt: string): Promise<void> { const item = this.inbox.get(`${consumer}:${eventId}`); if (item) { item.state = 'retry_scheduled'; item.leaseExpiresAt = null; item.retryAt = Date.parse(retryAt); item.lastError = error.slice(0, 500); } }
  async markInboxReconcileRequired(consumer: string, eventId: string, error: string, event?: OutboxEvent): Promise<void> { const item = this.inbox.get(`${consumer}:${eventId}`); if (item) { item.state = 'reconcile_required'; item.leaseExpiresAt = null; item.retryAt = null; item.lastError = error.slice(0, 500); if (event) item.dlqEvent = event; item.dlqReason = error.slice(0, 500); item.dlqPublished = false; item.dlqLeaseExpiresAt = null; } }
  async markInboxDeadLettered(consumer: string, eventId: string, error: string, event?: OutboxEvent): Promise<void> { const item = this.inbox.get(`${consumer}:${eventId}`); if (item) { item.state = 'dead_lettered'; item.leaseExpiresAt = null; item.retryAt = null; item.lastError = error.slice(0, 500); if (event) item.dlqEvent = event; item.dlqReason = error.slice(0, 500); item.dlqPublished = false; item.dlqLeaseExpiresAt = null; } }
  async claimInboxDeadLetterProjections(limit: number, leaseMs: number): Promise<Array<{ consumer: string; eventId: string; event: OutboxEvent; reason: string }>> {
    const current = Date.now();
    return [...this.inbox.entries()].filter(([, item]) => ['reconcile_required', 'dead_lettered'].includes(item.state) && item.dlqEvent && !item.dlqPublished && (!item.dlqLeaseExpiresAt || item.dlqLeaseExpiresAt <= current)).slice(0, limit).map(([key, item]) => { item.dlqLeaseExpiresAt = current + leaseMs; const separator = key.indexOf(':'); return { consumer: key.slice(0, separator), eventId: key.slice(separator + 1), event: item.dlqEvent!, reason: item.dlqReason ?? 'event processing terminally failed' }; });
  }
  async markInboxDeadLetterPublished(consumer: string, eventId: string): Promise<void> { const item = this.inbox.get(`${consumer}:${eventId}`); if (item) { item.dlqPublished = true; item.dlqLeaseExpiresAt = null; } }
  async releaseInboxDeadLetterProjection(consumer: string, eventId: string): Promise<void> { const item = this.inbox.get(`${consumer}:${eventId}`); if (item) item.dlqLeaseExpiresAt = null; }
  async claimActionExecution(execution: ActionExecution): Promise<{ execution: ActionExecution; claimed: boolean }> {
    const key = `${execution.actionId}:${execution.idempotencyKey}`;
    const existing = [...this.actionExecutions.values()].find((item) => `${item.actionId}:${item.idempotencyKey}` === key);
    if (!existing) { this.actionExecutions.set(execution.id, execution); return { execution, claimed: true }; }
    if (existing.providerStatus === 'dispatching' && existing.attempt < execution.attempt) { const reclaimed = { ...existing, providerStatus: 'dispatching', attempt: execution.attempt, deadlineAt: execution.deadlineAt, eventId: execution.eventId ?? existing.eventId ?? null, correlationId: execution.correlationId ?? existing.correlationId ?? null, updatedAt: now() }; this.actionExecutions.set(existing.id, reclaimed); return { execution: reclaimed, claimed: true }; }
    return { execution: existing, claimed: false };
  }
  async getActionExecution(actionId: string, tenantId: string): Promise<ActionExecution | null> { return [...this.actionExecutions.values()].filter((item) => item.actionId === actionId && item.tenantId === tenantId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null; }
  async recordActionExecution(execution: ActionExecution): Promise<ActionExecution> { const key = `${execution.actionId}:${execution.idempotencyKey}`; const existing = [...this.actionExecutions.values()].find((item) => `${item.actionId}:${item.idempotencyKey}` === key); const protectedState = existing && (['completed', 'failed', 'reconcile_required'].includes(existing.providerStatus) || (['accepted', 'processing'].includes(existing.providerStatus) && execution.providerStatus === 'dispatching')); const value = existing ? { ...existing, providerStatus: protectedState ? existing.providerStatus : execution.providerStatus, n8nExecutionRef: execution.n8nExecutionRef ?? existing.n8nExecutionRef, eventId: execution.eventId ?? existing.eventId ?? null, correlationId: execution.correlationId ?? existing.correlationId ?? null, attempt: Math.max(existing.attempt, execution.attempt), deadlineAt: protectedState ? existing.deadlineAt : execution.deadlineAt, outcome: protectedState ? existing.outcome : execution.outcome ?? existing.outcome, updatedAt: now() } : execution; this.actionExecutions.set(value.id, value); return value; }
  async updateActionExecution(input: { actionId: string; tenantId: string; providerStatus: string; n8nExecutionRef?: string | null; outcome?: ActionExecution['outcome']; resolveReconciliation?: boolean; eventId?: string; correlationId?: string; expectedAttempt?: number }): Promise<ActionExecution | null> {
    const execution = [...this.actionExecutions.values()].filter((item) => item.actionId === input.actionId && item.tenantId === input.tenantId).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (!execution || ['completed', 'failed'].includes(execution.providerStatus) || (execution.providerStatus === 'reconcile_required' && !(input.resolveReconciliation === true && input.providerStatus === 'completed'))) return null;
    if ((input.eventId && execution.eventId !== input.eventId) || (input.correlationId && execution.correlationId !== input.correlationId) || (input.expectedAttempt !== undefined && execution.attempt !== input.expectedAttempt) || (execution.n8nExecutionRef && input.n8nExecutionRef && execution.n8nExecutionRef !== input.n8nExecutionRef)) return null;
    const updated = { ...execution, providerStatus: input.providerStatus, n8nExecutionRef: input.n8nExecutionRef ?? execution.n8nExecutionRef, eventId: execution.eventId ?? null, correlationId: execution.correlationId ?? null, outcome: { ...(execution.outcome ?? {}), ...(input.outcome ?? {}) }, updatedAt: now() };
    this.actionExecutions.set(updated.id, updated);
    return updated;
  }
  async reconcileExpiredActionExecutions(timestamp: string): Promise<ActionExecution[]> {
    const cutoff = Date.parse(timestamp);
    const expired = [...this.actionExecutions.values()].filter((item) => ['dispatching', 'accepted'].includes(item.providerStatus) && item.deadlineAt && Date.parse(item.deadlineAt) <= cutoff);
    for (const execution of expired) {
      const action = this.actions.get(execution.actionId);
      if (!action || action.tenantId !== execution.tenantId || !['approved', 'processing'].includes(action.state)) continue;
      const updated = { ...execution, providerStatus: 'reconcile_required', outcome: { ...(execution.outcome ?? {}), reason: 'completion_deadline_exceeded' }, updatedAt: now() };
      this.actionExecutions.set(updated.id, updated);
      this.actions.set(action.id, { ...action, state: 'reconcile_required' });
      const session = this.sessions.get(action.sessionId);
      const current = session?.conversationState;
      if (session && (!current?.selectedIntentKey || current.selectedIntentKey === action.intentKey) && (!current?.catalogVersionId || current.catalogVersionId === action.catalogVersionId)) {
        this.sessions.set(session.id, { ...session, lastActivityAt: now(), stateVersion: (session.stateVersion ?? 0) + 1, conversationState: { ...(current ?? newConversationState()), workflowStatus: 'reconcile_required', phase: 'RECONCILE_REQUIRED', pendingPrompt: null } });
      }
      this.audits.push({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.reconcile_required', metadata: { actionId: action.id, executionId: execution.id, reason: 'completion_deadline_exceeded', eventId: execution.eventId ?? null, correlationId: execution.correlationId ?? null }, createdAt: now() });
    }
    return expired.map((execution) => this.actionExecutions.get(execution.id)!).filter(Boolean);
  }
  async addAudit(event: AuditEvent): Promise<void> { this.audits.push(event); }
  async listAudit(tenantId: string): Promise<AuditEvent[]> { return this.audits.filter((event) => event.tenantId === tenantId); }
  async getTenantStats(tenantId: string): Promise<TenantStats> {
    const sources = [...this.sources.values()].filter((source) => source.tenantId === tenantId);
    const jobs = [...this.ingestionJobs.values()].filter((job) => job.tenantId === tenantId);
    return { sourceCounts: { awaiting_review: sources.filter((source) => source.status === 'awaiting_review').length, active: sources.filter((source) => source.status === 'active').length, revoked: sources.filter((source) => source.status === 'revoked').length }, ingestionJobs: { queued: jobs.filter((job) => job.status === 'queued').length, processing: jobs.filter((job) => job.status === 'processing').length, completed: jobs.filter((job) => job.status === 'completed').length, failed: jobs.filter((job) => job.status === 'failed').length }, sessions: [...this.sessions.values()].filter((session) => session.tenantId === tenantId).length, messages: [...this.messages.values()].filter((message) => message.tenantId === tenantId).length, actions: [...this.actions.values()].filter((action) => action.tenantId === tenantId).length, auditEvents: this.audits.filter((event) => event.tenantId === tenantId).length };
  }
}

export const contentHash = (content: string): string => createHash('sha256').update(content).digest('hex');

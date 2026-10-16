import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ActionRequest, AuditEvent, AuthSession, Chunk, CrmLead, IngestionJob, Message, Persona, PersonaVersion, Session, Source, SourceStatus, SourceVersion, Store, Tenant, TenantDomain, TenantStatus, TenantStats, User } from './types.js';

const now = (): string => new Date().toISOString();

export class MemoryStore implements Store {
  private readonly tenants = new Map<string, Tenant>();
  private readonly users = new Map<string, User>();
  private readonly domains = new Map<string, TenantDomain>();
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly callbackNonces = new Map<string, string>();
  private readonly personas = new Map<string, Persona>();
  private readonly personaVersions = new Map<string, PersonaVersion[]>();
  private readonly sources = new Map<string, Source>();
  private readonly sourceVersions = new Map<string, SourceVersion[]>();
  private readonly ingestionJobs = new Map<string, IngestionJob>();
  private readonly chunks = new Map<string, Chunk>();
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, Message>();
  private readonly actions = new Map<string, ActionRequest>();
  private readonly crmLeads = new Map<string, CrmLead>();
  private readonly audits: AuditEvent[] = [];

  async countUsers(): Promise<number> { return this.users.size; }

  async createTenant(input: { name: string; slug: string }): Promise<Tenant> {
    const tenant: Tenant = { id: randomUUID(), name: input.name, slug: input.slug, status: 'active', publicChatEnabled: true, publicOrigin: null, createdAt: now() };
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

  async setPersona(persona: Persona): Promise<Persona> { this.personas.set(persona.tenantId, persona); return persona; }
  async getPersona(tenantId: string): Promise<Persona | null> { return this.personas.get(tenantId) ?? null; }
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
    await this.setPersona({ tenantId, name: selected.name, greeting: selected.greeting, personality: selected.personality, tone: selected.tone, speakingStyle: selected.speakingStyle, permittedLanguages: selected.permittedLanguages, contextWindowMessages: selected.contextWindowMessages });
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
    const job: IngestionJob = { id: input.id, tenantId: input.tenantId, title: input.title, mimeType: input.mimeType, sourceUrl: input.sourceUrl, audience: input.audience, sourceId: null, status: 'queued', attempts: 0, errorCode: null, leaseExpiresAt: null, createdAt: timestamp, updatedAt: timestamp };
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
  async searchSearchableChunks(tenantId: string, audience: 'public' | 'internal', _queryEmbedding: number[], limit: number): Promise<Array<{ source: Source; chunk: Chunk }>> { return (await this.listSearchableChunks(tenantId, audience)).slice(0, limit); }

  async createSession(tenantId: string, personaVersionId: string | null = null): Promise<Session> {
    const timestamp = now();
    const session: Session = { id: randomUUID(), tenantId, createdAt: timestamp, lastActivityAt: timestamp, closedAt: null, personaVersionId, tokenMap: new Map() };
    this.sessions.set(session.id, session);
    return session;
  }
  async getSession(id: string): Promise<Session | null> { return this.sessions.get(id) ?? null; }
  async purgeExpiredSessions(tenantId: string, before: string): Promise<number> {
    const cutoff = Date.parse(before);
    const leadSessionIds = new Set([...this.crmLeads.values()].map((l) => l.sessionId));
    const expired = [...this.sessions.values()].filter((session) => session.tenantId === tenantId && Date.parse(session.lastActivityAt) < cutoff && !leadSessionIds.has(session.id));
    for (const session of expired) {
      this.sessions.delete(session.id);
      for (const [messageId, message] of this.messages) if (message.sessionId === session.id) this.messages.delete(messageId);
      for (const [actionId, action] of this.actions) if (action.sessionId === session.id) this.actions.delete(actionId);
    }
    return expired.length;
  }
  async updateSession(session: Session): Promise<Session> { this.sessions.set(session.id, session); return session; }
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
  async getAction(id: string): Promise<ActionRequest | null> { return this.actions.get(id) ?? null; }
  async getActionByIdempotency(tenantId: string, idempotencyKey: string): Promise<ActionRequest | null> {
    return [...this.actions.values()].find((action) => action.tenantId === tenantId && action.idempotencyKey === idempotencyKey) ?? null;
  }
  async updateAction(action: ActionRequest): Promise<ActionRequest> { this.actions.set(action.id, action); return action; }
  async listActions(tenantId: string): Promise<ActionRequest[]> { return [...this.actions.values()].filter((action) => action.tenantId === tenantId); }
  async createCrmLead(lead: CrmLead): Promise<CrmLead> { this.crmLeads.set(lead.id, lead); return lead; }
  async getCrmLeadByActionId(actionId: string, tenantId: string): Promise<CrmLead | null> { return [...this.crmLeads.values()].find((lead) => lead.actionId === actionId && lead.tenantId === tenantId) ?? null; }
  async getCrmLead(id: string, tenantId: string): Promise<CrmLead | null> { const lead = this.crmLeads.get(id); return lead?.tenantId === tenantId ? lead : null; }
  async listCrmLeads(tenantId: string): Promise<CrmLead[]> { return [...this.crmLeads.values()].filter((lead) => lead.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  async updateCrmLeadSummary(id: string, tenantId: string, summary: string, status: CrmLead['summaryStatus']): Promise<CrmLead | null> {
    const lead = await this.getCrmLead(id, tenantId);
    if (!lead) return null;
    const updated = { ...lead, summary, summaryStatus: status, updatedAt: now() };
    this.crmLeads.set(id, updated);
    return updated;
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

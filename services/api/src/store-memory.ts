import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ActionRequest, AuditEvent, AuthSession, Chunk, IngestionJob, Message, Persona, Session, Source, SourceStatus, SourceVersion, Store, Tenant, TenantStatus, TenantStats, User } from './types.js';

const now = (): string => new Date().toISOString();

export class MemoryStore implements Store {
  private readonly tenants = new Map<string, Tenant>();
  private readonly users = new Map<string, User>();
  private readonly authSessions = new Map<string, AuthSession>();
  private readonly personas = new Map<string, Persona>();
  private readonly sources = new Map<string, Source>();
  private readonly sourceVersions = new Map<string, SourceVersion[]>();
  private readonly ingestionJobs = new Map<string, IngestionJob>();
  private readonly chunks = new Map<string, Chunk>();
  private readonly sessions = new Map<string, Session>();
  private readonly messages = new Map<string, Message>();
  private readonly actions = new Map<string, ActionRequest>();
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
  async listUsers(tenantId: string): Promise<User[]> { return [...this.users.values()].filter((user) => user.tenantId === tenantId); }

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

  async setPersona(persona: Persona): Promise<Persona> { this.personas.set(persona.tenantId, persona); return persona; }
  async getPersona(tenantId: string): Promise<Persona | null> { return this.personas.get(tenantId) ?? null; }

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
  async claimIngestionJob(id: string, leaseMs: number): Promise<IngestionJob | null> {
    const job = this.ingestionJobs.get(id);
    if (!job) return null;
    const nowMs = Date.now();
    if (job.status !== 'queued' && !(job.status === 'processing' && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= nowMs)) return null;
    const updated: IngestionJob = { ...job, status: 'processing', attempts: job.attempts + 1, leaseExpiresAt: new Date(nowMs + leaseMs).toISOString(), updatedAt: now() };
    this.ingestionJobs.set(id, updated);
    return updated;
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

  async createSession(tenantId: string): Promise<Session> {
    const session: Session = { id: randomUUID(), tenantId, createdAt: now(), tokenMap: new Map() };
    this.sessions.set(session.id, session);
    return session;
  }
  async getSession(id: string): Promise<Session | null> { return this.sessions.get(id) ?? null; }
  async updateSession(session: Session): Promise<Session> { this.sessions.set(session.id, session); return session; }
  async addMessage(message: Message): Promise<Message> { this.messages.set(message.id, message); return message; }
  async updateMessage(message: Message): Promise<Message> { this.messages.set(message.id, message); return message; }
  async listMessages(sessionId: string, tenantId: string): Promise<Message[]> { return [...this.messages.values()].filter((message) => message.sessionId === sessionId && message.tenantId === tenantId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)); }
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
  async addAudit(event: AuditEvent): Promise<void> { this.audits.push(event); }
  async listAudit(tenantId: string): Promise<AuditEvent[]> { return this.audits.filter((event) => event.tenantId === tenantId); }
  async getTenantStats(tenantId: string): Promise<TenantStats> {
    const sources = [...this.sources.values()].filter((source) => source.tenantId === tenantId);
    return { sourceCounts: { awaiting_review: sources.filter((source) => source.status === 'awaiting_review').length, active: sources.filter((source) => source.status === 'active').length, revoked: sources.filter((source) => source.status === 'revoked').length }, sessions: [...this.sessions.values()].filter((session) => session.tenantId === tenantId).length, messages: [...this.messages.values()].filter((message) => message.tenantId === tenantId).length, actions: [...this.actions.values()].filter((action) => action.tenantId === tenantId).length, auditEvents: this.audits.filter((event) => event.tenantId === tenantId).length };
  }
}

export const contentHash = (content: string): string => createHash('sha256').update(content).digest('hex');

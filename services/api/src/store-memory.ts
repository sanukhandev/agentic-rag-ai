import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { ActionRequest, AuditEvent, Chunk, Message, Persona, Session, Source, SourceStatus, Store, Tenant, TenantStatus, User } from './types.js';

const now = (): string => new Date().toISOString();

export class MemoryStore implements Store {
  private readonly tenants = new Map<string, Tenant>();
  private readonly users = new Map<string, User>();
  private readonly personas = new Map<string, Persona>();
  private readonly sources = new Map<string, Source>();
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
    const updated = { ...tenant, status, publicChatEnabled: status === 'active' && tenant.publicChatEnabled };
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

  async setPersona(persona: Persona): Promise<Persona> { this.personas.set(persona.tenantId, persona); return persona; }
  async getPersona(tenantId: string): Promise<Persona | null> { return this.personas.get(tenantId) ?? null; }

  async createSource(input: Omit<Source, 'createdAt' | 'approvedAt'> & { chunks: Chunk[] }): Promise<Source> {
    const source: Source = { ...input, createdAt: now(), approvedAt: null };
    this.sources.set(source.id, source);
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
  async listSearchableChunks(tenantId: string, audience: 'public' | 'internal'): Promise<Array<{ source: Source; chunk: Chunk }>> {
    return [...this.chunks.values()]
      .filter((chunk) => chunk.tenantId === tenantId)
      .flatMap((chunk) => {
        const source = this.sources.get(chunk.sourceId);
        if (!source || source.status !== 'active' || (source.audience !== 'public' && audience !== 'internal')) return [];
        return [{ source, chunk }];
      });
  }

  async createSession(tenantId: string): Promise<Session> {
    const session: Session = { id: randomUUID(), tenantId, createdAt: now(), tokenMap: new Map() };
    this.sessions.set(session.id, session);
    return session;
  }
  async getSession(id: string): Promise<Session | null> { return this.sessions.get(id) ?? null; }
  async addMessage(message: Message): Promise<Message> { this.messages.set(message.id, message); return message; }
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
}

export const contentHash = (content: string): string => createHash('sha256').update(content).digest('hex');

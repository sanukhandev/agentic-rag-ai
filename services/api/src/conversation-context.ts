import { cacheKey, type CacheStore } from './cache.js';

export type ConversationContextTurn = { role: 'user' | 'assistant'; content: string };

export interface ConversationContextSnapshot {
  schemaVersion: 1;
  tenantId: string;
  sessionId: string;
  opportunityId: string | null;
  catalogVersionId: string | null;
  personaVersionId: string | null;
  stateRevision: number;
  summary: string;
  recentTurns: ConversationContextTurn[];
  createdAt: string;
  refreshedAt: string;
}

const maxSummaryLength = 6_000;
const maxTurnLength = 600;
const maxTurns = 20;

export class ConversationContextCache {
  private readonly idleTtlSeconds: number;
  private readonly absoluteTtlSeconds: number;

  constructor(private readonly cache: CacheStore, options: { idleTtlSeconds?: number; absoluteTtlSeconds?: number } = {}) {
    this.idleTtlSeconds = Math.max(1, Math.floor(options.idleTtlSeconds ?? Number(process.env.REDIS_CONTEXT_TTL_SECONDS ?? 86_400)));
    this.absoluteTtlSeconds = Math.max(this.idleTtlSeconds, Math.floor(options.absoluteTtlSeconds ?? Number(process.env.REDIS_CONTEXT_ABSOLUTE_TTL_SECONDS ?? 604_800)));
  }

  async get(scope: Pick<ConversationContextSnapshot, 'tenantId' | 'sessionId' | 'opportunityId'>): Promise<ConversationContextSnapshot | null> {
    const value = await this.cache.get<ConversationContextSnapshot>(this.key(scope));
    if (!value || value.schemaVersion !== 1 || value.tenantId !== scope.tenantId || value.sessionId !== scope.sessionId || value.opportunityId !== scope.opportunityId) return null;
    if (!Number.isInteger(value.stateRevision) || value.stateRevision < 0 || typeof value.summary !== 'string' || !Array.isArray(value.recentTurns)) return null;
    if (Date.parse(value.createdAt) + this.absoluteTtlSeconds * 1_000 <= Date.now()) {
      await this.cache.delete(this.key(scope));
      return null;
    }
    return { ...value, summary: value.summary.slice(0, maxSummaryLength), recentTurns: value.recentTurns.slice(-maxTurns).map((turn) => ({ role: turn.role, content: turn.content.slice(0, maxTurnLength) })) };
  }

  async set(input: Omit<ConversationContextSnapshot, 'schemaVersion' | 'refreshedAt'>): Promise<void> {
    const createdAt = Number.isFinite(Date.parse(input.createdAt)) ? input.createdAt : new Date().toISOString();
    const remainingAbsolute = Math.floor((Date.parse(createdAt) + this.absoluteTtlSeconds * 1_000 - Date.now()) / 1_000);
    if (remainingAbsolute <= 0) return;
    const snapshot: ConversationContextSnapshot = {
      schemaVersion: 1, ...input, createdAt, refreshedAt: new Date().toISOString(),
      summary: input.summary.slice(0, maxSummaryLength),
      recentTurns: input.recentTurns.slice(-maxTurns).map((turn) => ({ role: turn.role, content: turn.content.slice(0, maxTurnLength) })),
    };
    await this.cache.set(this.key(input), snapshot, Math.min(this.idleTtlSeconds, remainingAbsolute));
  }

  private key(scope: Pick<ConversationContextSnapshot, 'tenantId' | 'sessionId' | 'opportunityId'>): string {
    return cacheKey('conversation-context', scope.tenantId, scope.sessionId, scope.opportunityId ?? 'none');
  }
}

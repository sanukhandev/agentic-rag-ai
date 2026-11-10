import { describe, expect, it } from 'vitest';
import { MemoryCache } from './cache.js';
import { ConversationContextCache } from './conversation-context.js';

describe('conversation context cache', () => {
  it('keeps bounded masked context and expires by absolute lifetime', async () => {
    const cache = new ConversationContextCache(new MemoryCache(), { idleTtlSeconds: 60, absoluteTtlSeconds: 60 });
    const createdAt = new Date().toISOString();
    await cache.set({ tenantId: 'tenant', sessionId: 'session', opportunityId: null, catalogVersionId: 'catalog', personaVersionId: 'persona', stateRevision: 2, summary: 's'.repeat(7000), recentTurns: Array.from({ length: 25 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'x'.repeat(700) })), createdAt });
    const value = await cache.get({ tenantId: 'tenant', sessionId: 'session', opportunityId: null });
    expect(value?.summary).toHaveLength(6000);
    expect(value?.recentTurns).toHaveLength(20);
    expect(value?.recentTurns[0]?.content).toHaveLength(600);
  });

  it('does not return another opportunity context', async () => {
    const cache = new ConversationContextCache(new MemoryCache());
    await cache.set({ tenantId: 'tenant', sessionId: 'session', opportunityId: 'opportunity-a', catalogVersionId: null, personaVersionId: null, stateRevision: 1, summary: 'a', recentTurns: [], createdAt: new Date().toISOString() });
    await expect(cache.get({ tenantId: 'tenant', sessionId: 'session', opportunityId: 'opportunity-b' })).resolves.toBeNull();
  });
});

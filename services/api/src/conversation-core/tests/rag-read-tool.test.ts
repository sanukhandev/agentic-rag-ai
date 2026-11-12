import { describe, expect, it } from 'vitest';
import { NodeReadToolRegistry } from '../read-tool-registry.js';
import { registerP3ReadTools, searchAuthorizedKnowledge } from '../adapters/rag-read-tool.js';
import type { ConversationRepository, SessionSnapshot, TrustedActor } from '../contracts.js';
import type { EmbeddingProvider } from '../../embedding.js';
import type { Chunk, Source, Store } from '../../types.js';

const tenantId = 'tenant-a';
const otherTenant = 'tenant-b';
const actor: TrustedActor = {
  tenantId, sessionId: 'session-a', principalId: 'f'.repeat(64), role: 'customer',
};
const source: Source = {
  id: 'source-1', tenantId, title: 'Approved public reference', mimeType: 'text/plain', sourceUrl: null,
  audience: 'public', status: 'active', versionId: 'v1', contentHash: 'hash-1',
  embeddingReady: true, createdAt: '2026-01-01', approvedAt: '2026-01-02',
};
const chunk: Chunk = {
  id: 'chunk-1', sourceId: source.id, tenantId, versionId: source.versionId,
  ordinal: 0, locator: 'section 1', content: 'Licensing steps include selecting a business activity and submitting an application.',
  contentHash: 'hash-2', embedding: [1, 0],
};
const embedding: EmbeddingProvider = {
  model: 'real-model-for-test', dimension: 2, async embed() { return [1, 0]; },
};
const snapshot: SessionSnapshot = {
  tenantId, sessionId: actor.sessionId, ownerPrincipalId: actor.principalId,
  revision: 2, personaVersionId: 'persona-1', catalogVersionId: 'catalog-1',
  personaInstructions: 'Helpful', conversationSummary: 'Customer provided a phone +971501234567.',
  recentTurns: [], verifiedFacts: [{
    key: 'activity', value: 'Consulting', source: 'customer', sourceReference: 'turn-1', revision: 2,
  }], publishedGoalKeys: ['formation'], pendingActionStatus: [],
};

function fakeStore(overrides: { returnedSource?: Source; returnedChunk?: Chunk; getSource?: Source | null } = {}) {
  const returnedSource = overrides.returnedSource ?? source;
  const returnedChunk = overrides.returnedChunk ?? chunk;
  const store = {
    async searchSearchableChunks() { return [{ source: returnedSource, chunk: returnedChunk }]; },
    async listSearchableChunks() { return [{ source: returnedSource, chunk: returnedChunk }]; },
    async getSource() { return overrides.getSource === undefined ? source : overrides.getSource; },
    async listSourceChunks() { return [overrides.returnedChunk ?? chunk]; },
  } as unknown as Pick<Store, 'searchSearchableChunks' | 'listSearchableChunks' | 'getSource' | 'listSourceChunks'>;
  return store;
}

describe('P3 protected RAG retrieval', () => {
  it('returns public approved chunks with exact source, revision and native citation identity', async () => {
    const result = await searchAuthorizedKnowledge(fakeStore(), embedding, actor, 'licensing steps', 3, new AbortController().signal);
    expect(result.status).toBe('results');
    expect(result.evidence).toEqual([expect.objectContaining({
      citationId: chunk.id, chunkId: chunk.id, sourceId: source.id, versionId: 'v1',
      title: source.title, locator: chunk.locator,
    })]);
    expect(result.evidence[0]?.untrustedContent).toContain('Licensing steps');
  });

  it('rejects foreign tenant, internal-only, revoked, stale-version or orphaned chunks', async () => {
    const cases = [
      fakeStore({ returnedSource: { ...source, tenantId: otherTenant }, getSource: { ...source, tenantId: otherTenant } }),
      fakeStore({ returnedSource: { ...source, audience: 'internal' }, getSource: { ...source, audience: 'internal' } }),
      fakeStore({ returnedSource: { ...source, status: 'revoked' }, getSource: { ...source, status: 'revoked' } }),
      fakeStore({ returnedSource: { ...source, versionId: 'old' }, getSource: source }),
      fakeStore({ returnedChunk: { ...chunk, tenantId: otherTenant } }),
      fakeStore({ returnedChunk: { ...chunk, versionId: 'old' } }),
    ];
    for (const store of cases) {
      const result = await searchAuthorizedKnowledge(store, embedding, actor, 'licensing steps', 3, new AbortController().signal);
      expect(result).toEqual({ status: 'no_evidence', evidence: [] });
    }
  });

  it('uses only server-derived tenant and public audience in retrieval calls', async () => {
    let seenTenant = '';
    let seenAudience = '';
    const store = {
      ...fakeStore(),
      async searchSearchableChunks(tenant: string, audience: string) {
        seenTenant = tenant; seenAudience = audience;
        return [{ source, chunk }];
      },
    };
    await searchAuthorizedKnowledge(store, embedding, actor, 'licensing steps', 2, new AbortController().signal);
    expect(seenTenant).toBe(tenantId);
    expect(seenAudience).toBe('public');
  });

  it('redacts sensitive source text before returning untrusted model data', async () => {
    const piiChunk = { ...chunk, content: 'Licensing steps: contact sanu@example.com for application details.' };
    const result = await searchAuthorizedKnowledge(fakeStore({ returnedChunk: piiChunk }), embedding, actor, 'licensing steps', 1, new AbortController().signal);
    expect(result.status).toBe('results');
    expect(result.evidence[0]?.untrustedContent).not.toContain('sanu@example.com');
    expect(result.evidence[0]?.untrustedContent).toContain('REDACTED');
  });

  it('aborts before invoking an embedding provider', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchAuthorizedKnowledge(fakeStore(), embedding, actor, 'licensing steps', 2, controller.signal))
      .rejects.toThrow();
  });

  it('rejects forged tenant overrides and validates the session on each tool invocation', async () => {
    let authorized = true;
    const repo = {
      async loadAuthorizedSnapshot() {
        if (!authorized) throw new Error('session revoked');
        return snapshot;
      },
    } as unknown as ConversationRepository;
    const registry = new NodeReadToolRegistry();
    registerP3ReadTools(registry, { repository: repo, store: fakeStore(), embedding });
    const invalid = await registry.invoke(actor, 'search_knowledge', { query: 'licensing steps', tenantId: otherTenant }, new AbortController().signal);
    expect(invalid.status).toBe('invalid_input');
    const valid = await registry.invoke(actor, 'search_knowledge', { query: 'licensing steps', resultCount: 1 }, new AbortController().signal);
    expect(valid.status).toBe('ok');
    authorized = false;
    const denied = await registry.invoke(actor, 'search_knowledge', { query: 'licensing steps' }, new AbortController().signal);
    expect(denied.status).not.toBe('ok');
  });

  it('exposes no provider actions or arbitrary network/database tools', () => {
    const registry = new NodeReadToolRegistry();
    registerP3ReadTools(registry, {
      repository: { loadAuthorizedSnapshot: async () => snapshot } as unknown as ConversationRepository,
      store: fakeStore(), embedding,
    });
    expect(registry.listDefinitions().map(item => item.name).sort()).toEqual([
      'get_conversation_summary', 'get_verified_customer_facts', 'list_supported_goals', 'search_knowledge',
    ]);
  });
});

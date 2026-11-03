import { describe, expect, it } from 'vitest';
import { isV2FactualKnowledgeQuestion, prefetchV2ApprovedKnowledge, toV2KnowledgeEvidence } from './v2-knowledge-preflight.js';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { buildChunksWithEmbeddings } from './knowledge.js';
import type { Source, Store } from './types.js';

describe('V2 knowledge preflight', () => {
  it('detects formation process and policy questions but skips greetings and consent', () => {
    expect(isV2FactualKnowledgeQuestion('can you tell me about the process of starting a company in ajman freezone')).toBe(true);
    expect(isV2FactualKnowledgeQuestion('What are the documents required to set up my company?')).toBe(true);
    expect(isV2FactualKnowledgeQuestion('How much does an Ajman free zone licence cost?')).toBe(true);
    expect(isV2FactualKnowledgeQuestion('Hello')).toBe(false);
    expect(isV2FactualKnowledgeQuestion('Yes, I confirm the goal')).toBe(false);
  });
  it('preserves actual source chunk IDs and source revision, not digests', () => {
    const original = {
      citation: {sourceId:'source-12345678',versionId:'version-12345678',chunkId:'chunk-12345678',title:'ANCFZ setup guide',locator:'section 1'},
      content:'The approved guide says to choose an activity.',
    };
    const result = toV2KnowledgeEvidence(original);
    expect(result).toEqual({citationId:'chunk-12345678',sourceRef:'source-12345678',sourceVersion:'version-12345678',text:original.content,approved:true,revoked:false});
  });
  it('retrieves an approved public source and excludes revoked or cross-tenant material', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const source: Source = {
      id: 'source-12345678', tenantId: 'tenant-A', title: 'Approved ANCFZ setup process',
      mimeType: 'text/plain', sourceUrl: null, audience: 'public', status: 'active',
      versionId: 'version-12345678', contentHash: 'hash', embeddingReady: true,
      createdAt: new Date().toISOString(), approvedAt: new Date().toISOString(),
    };
    const content = 'The Ajman Free Zone company formation process is described in the approved setup guide.';
    const chunks = await buildChunksWithEmbeddings(source, content, provider);
    const rows = [{ source, chunk: chunks[0]! }];
    const makeStore = (activeSource: Source | null) => ({
      searchSearchableChunks: async () => rows,
      listSearchableChunks: async () => rows,
      getSource: async () => activeSource,
    }) as unknown as Pick<Store, 'getSource' | 'searchSearchableChunks' | 'listSearchableChunks'>;
    const question = 'can you tell me about the process of starting a company in ajman freezone';
    const found = await prefetchV2ApprovedKnowledge(makeStore(source), provider, 'tenant-A', question);
    expect(found).toHaveLength(1);
    expect(found[0]?.citationId).toBe(chunks[0]!.id);
    expect(found[0]?.sourceVersion).toBe(source.versionId);
    expect(await prefetchV2ApprovedKnowledge(makeStore(source), provider, 'tenant-B', question)).toEqual([]);
    expect(await prefetchV2ApprovedKnowledge(makeStore({ ...source, status: 'revoked' }), provider, 'tenant-A', question)).toEqual([]);
  });

});

import { describe, expect, it } from 'vitest';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { buildChunks, buildChunksWithEmbeddings, chunkText, embedText, rankChunks, rankChunksWithEmbedding } from './knowledge.js';

describe('knowledge pipeline primitives', () => {
  it('chunks deterministically and emits the configured local vector dimension', () => {
    const source = { id: 'source', tenantId: 'tenant', versionId: 'version' };
    const content = 'Pricing is published in the approved catalog.\n\nSupport is available by email.';
    expect(chunkText(content)).toEqual(chunkText(content));
    expect(embedText(content)).toHaveLength(8);
    expect(buildChunks(source, content)).toHaveLength(1);
  });

  it('does not return unrelated evidence merely because a vector has a score', () => {
    const source = { id: 'source', tenantId: 'tenant', versionId: 'version' };
    const chunks = buildChunks(source, 'Pricing is published in the approved catalog.');
    const rows = [{ source: { id: 'source', title: 'Catalog' }, chunk: chunks[0]! }];
    expect(rankChunks('What is the pricing?', rows)).toHaveLength(1);
    expect(rankChunks('What is the office location?', rows)).toHaveLength(0);
  });

  it('uses the injectable embedding boundary for indexing and queries', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const source = { id: 'source', tenantId: 'tenant', versionId: 'version' };
    const chunks = await buildChunksWithEmbeddings(source, 'Pricing is published in the approved catalog.', provider);
    const rows = [{ source: { id: 'source', title: 'Catalog' }, chunk: chunks[0]! }];
    expect(chunks[0]?.embedding).toHaveLength(provider.dimension);
    expect(await rankChunksWithEmbedding('What is the pricing?', rows, provider)).toHaveLength(1);
    expect(rankChunks('What is the pricing?', rows)).toHaveLength(1);
  });
});

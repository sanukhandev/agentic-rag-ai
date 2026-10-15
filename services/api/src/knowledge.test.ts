import { describe, expect, it } from 'vitest';
import { buildChunks, chunkText, embedText, rankChunks } from './knowledge.js';

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
});

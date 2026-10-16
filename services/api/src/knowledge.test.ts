import { describe, expect, it } from 'vitest';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { contentHash } from './store-memory.js';
import { buildChunks, buildChunksWithEmbeddings, buildIngestionChunksWithEmbeddings, chunkText, embedText, hasConflictingEvidence, rankChunks, rankChunksWithEmbedding, rankChunksWithVector } from './knowledge.js';

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
    expect(rankChunksWithVector('What is the pricing?', rows, await provider.embed('What is the pricing?'))).toHaveLength(1);
    expect(rankChunks('What is the pricing?', rows)).toHaveLength(1);
  });

  it('preserves worker locators and ordinals while embedding chunks', async () => {
    const provider = new DeterministicEmbeddingProvider();
    const content = 'Approved content';
    const chunks = await buildIngestionChunksWithEmbeddings({ id: 'source', tenantId: 'tenant', versionId: 'version' }, [{ ordinal: 0, locator: 'page 2', content, contentHash: contentHash(content) }], provider);
    expect(chunks[0]).toMatchObject({ ordinal: 0, locator: 'page 2', content, contentHash: contentHash(content) });
    expect(chunks[0]?.embedding).toHaveLength(provider.dimension);
  });

  it('flags active evidence that shares a topic but disagrees on numeric facts', () => {
    expect(hasConflictingEvidence(['The plan costs 100 credits per month.', 'The plan costs 200 credits per month.'])).toBe(true);
    expect(hasConflictingEvidence(['The plan costs 100 credits.', 'Support is available by email.'])).toBe(false);
    expect(hasConflictingEvidence([
      'File: training/02_architecture_capabilities.docx · section 1\nDocument SK-002\nThe portfolio describes 100 systems across 9 markets.',
      'File: training/04_portfolio_faq.docx · section 1\nDocument SK-004\nThe portfolio includes a 25-hour prototype.',
    ])).toBe(false);
    expect(hasConflictingEvidence([
      'Case study | https://www.sanukhan.dev/projects/zaakiy-v3rse\nSource | https://github.com/sanukhandev/sanukhandev.github.io/blob/main/src/data/caseStudies.ts\n07 ZaakiyV3RSE',
      'Case study | https://www.sanukhan.dev/projects/garage-management-and-diagnostics\nSource | https://github.com/sanukhandev/sanukhandev.github.io/blob/main/src/data/caseStudies.ts\n06 Garage Management',
    ])).toBe(false);
    expect(hasConflictingEvidence([
      'The plan costs 100 credits per month.',
      'The plan costs 200 credits per month.',
    ])).toBe(true);
  });
});

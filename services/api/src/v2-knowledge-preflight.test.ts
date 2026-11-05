import { describe, expect, it } from 'vitest';
import { contextualizeV2KnowledgeQuery, isV2FactualKnowledgeQuestion, prefetchV2ApprovedKnowledge, toV2KnowledgeEvidence } from './v2-knowledge-preflight.js';
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
  it('contextualizes anaphoric knowledge follow-ups without treating consent as retrieval', () => {
    expect(contextualizeV2KnowledgeQuery('How does it work?', 'Company formation'))
      .toBe('Company formation: How does it work?');
    expect(contextualizeV2KnowledgeQuery('What about visas?', 'Company formation'))
      .toBe('Company formation: What about visas?');
    expect(isV2FactualKnowledgeQuestion(
      contextualizeV2KnowledgeQuery('How does it work?', 'Company formation'))).toBe(true);
    expect(contextualizeV2KnowledgeQuery('Yes, proceed', 'Company formation'))
      .toBe('Yes, proceed');
    expect(contextualizeV2KnowledgeQuery('How long to drive to Abu Dhabi?', 'Company formation'))
      .toBe('How long to drive to Abu Dhabi?');
    expect(contextualizeV2KnowledgeQuery('How does it work?', null))
      .toBe('How does it work?');
  });

  it('preserves actual source chunk IDs and source revision, not digests', () => {
    const original = {
      citation: {sourceId:'source-12345678',versionId:'version-12345678',chunkId:'chunk-12345678',title:'ANCFZ setup guide',locator:'section 1'},
      content:'The approved guide says to choose an activity.',
    };
    const result = toV2KnowledgeEvidence(original);
    expect(result).toEqual({citationId:'chunk-12345678',sourceRef:'source-12345678',sourceVersion:'version-12345678',text:original.content,approved:true,revoked:false});
  });
  it('keeps the process clause and removes an incidental document caveat for a process question', () => {
    const original = {
      citation: {sourceId:'source-12345678',versionId:'version-12345678',chunkId:'chunk-12345678',title:'ANCFZ setup guide',locator:'section 1'},
      content:'Company registration can be completed in as little as 2 hours, provided documents are in order. Note: Additional documents may be required depending on shareholder type.',
    };
    expect(toV2KnowledgeEvidence(original, 'Company formation: How does it work? process steps').text)
      .toBe('Company registration can be completed in as little as 2 hours, provided documents are in order.');
    expect(toV2KnowledgeEvidence({ ...original, content: '8. What documents are required for company registration?' }, 'Tell me about company formation').text)
      .toBe('');
  });
  it('drops mixed chunks when every retained sentence is document-only', () => {
    const evidence = toV2KnowledgeEvidence({
      citation: { sourceId: 'source', versionId: 'version', chunkId: 'document-list', title: 'documents', locator: 'section 1' },
      content: 'Proof of residence (e.g., utility bill or tenancy contract)\n\nApplication form and proposed company name(s)',
    }, 'Tell me about company formation');
    expect(evidence.text).toBe('');
  });
  it('drops incidental notes and capital requirements from a broad process question', () => {
    const evidence = toV2KnowledgeEvidence({
      citation: { sourceId: 'source', versionId: 'version', chunkId: 'mixed', title: 'faq', locator: 'section 1' },
      content: 'ANCFZ has no minimum paid-up capital requirement for most business activities.\n\nCompany registration and licence issuance can be completed in as little as 2 hours, provided all required documents are in order.\n\nNote: Additional documents may be required depending on the activity and shareholder type.',
    }, 'Tell me about company formation');
    expect(evidence.text).toBe('Company registration and licence issuance can be completed in as little as 2 hours, provided all required documents are in order.');
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

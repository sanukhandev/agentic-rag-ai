import { describe, expect, it } from 'vitest';
import { isV2FactualKnowledgeQuestion, toV2KnowledgeEvidence } from './v2-knowledge-preflight.js';

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
});

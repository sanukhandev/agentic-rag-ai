import { describe, expect, it } from 'vitest';
import { evaluateVocabularyCandidate, normalizeVocabularyPhrase } from './vocabulary.js';

describe('intent vocabulary lifecycle policy', () => {
  it('promotes a customer phrase only after two independent eligible sessions', () => {
    expect(evaluateVocabularyCandidate({
      phrase: 'get my trading venture off the ground',
      intentKey: 'start_company',
      sourceRole: 'user',
      sourceSessionIds: ['session-a', 'session-b'],
      existingPhrases: ['start company'],
      competingPhrases: ['rent an office'],
      containsPii: false,
      isNegated: false,
      isQuotedOrHypothetical: false,
    })).toMatchObject({ status: 'promotable', reason: 'independent_customer_support' });
  });

  it.each([
    ['assistant text', { sourceRole: 'assistant' as const }],
    ['PII', { containsPii: true }],
    ['negation', { isNegated: true }],
    ['hypothetical text', { isQuotedOrHypothetical: true }],
    ['ambiguous phrase', { competingPhrases: ['get my trading venture off the ground'] }],
  ])('rejects %s as an authoritative vocabulary update', (_label, override) => {
    expect(evaluateVocabularyCandidate({
      phrase: 'get my trading venture off the ground',
      intentKey: 'start_company',
      sourceRole: 'user',
      sourceSessionIds: ['session-a', 'session-b'],
      existingPhrases: ['start company'],
      competingPhrases: [],
      containsPii: false,
      isNegated: false,
      isQuotedOrHypothetical: false,
      ...override,
    }).status).toBe('rejected');
  });

  it('normalizes whitespace and rejects empty phrases', () => {
    expect(normalizeVocabularyPhrase('  open   my   own company ')).toBe('open my own company');
    expect(normalizeVocabularyPhrase('   ')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { guardV2Response, type V2ResponseGuardContext } from './v2-response-guard.js';

const context = (overrides: Partial<V2ResponseGuardContext> = {}): V2ResponseGuardContext => ({
  personaVersionId: 'persona-12345678',
  permittedLanguages: ['en'],
  pendingRequirementKey: null,
  lastQuestionKey: null,
  questionPolicy: 'optional',
  conversational: true,
  ...overrides,
});

const response = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  personaVersionId: 'persona-12345678',
  language: 'en',
  answer: 'Hello, how can I help?',
  citationIds: [],
  nextQuestion: null,
  nextQuestionKey: null,
  reasonNoQuestion: 'greeting',
  decisionRef: 'decision-12345678',
  ...overrides,
});

describe('guardV2Response', () => {
  it('delivers a safe conversational response', () => {
    const result = guardV2Response(response(), context());
    expect(result.verdict.accepted).toBe(true);
    expect(result.response.answer).toBe('Hello, how can I help?');
    expect(result.feedback).toBeNull();
  });

  it('blocks wrong persona and returns approved fallback only', () => {
    const result = guardV2Response(response({ personaVersionId: 'other-persona-123456' }), context());
    expect(result.verdict.reasonCode).toBe('persona_mismatch');
    expect(result.verdict.response).toBeNull();
    expect(result.response.answer).not.toContain('other-persona-123456');
    expect(result.feedback?.responseDigest).toMatch(/^[a-f0-9]{32}$/u);
  });

  it('blocks invented payment completion without approved evidence', () => {
    const result = guardV2Response(response({ answer: 'Your payment is complete.' }), context({ conversational: false }));
    expect(result.verdict.reasonCode).toBe('unsupported_claim');
    expect(result.response.answer).not.toContain('payment is complete');
  });

  it('blocks a repeated or irrelevant question', () => {
    const result = guardV2Response(response({ answer: 'What is your activity?', nextQuestion: 'What is your activity?', nextQuestionKey: 'other_requirement', reasonNoQuestion: null }), context({ pendingRequirementKey: 'business_activity', lastQuestionKey: 'other_requirement', questionPolicy: 'required' }));
    expect(result.verdict.reasonCode).toBe('invalid_question');
  });

  it('allows a pending requirement only when the question is the approved next question', () => {
    const result = guardV2Response(response({ answer: 'I can help with that. What is your activity?', nextQuestion: 'What is your activity?', nextQuestionKey: 'business_activity', reasonNoQuestion: null }), context({ pendingRequirementKey: 'business_activity', questionPolicy: 'required' }));
    expect(result.verdict.accepted).toBe(true);
  });
});

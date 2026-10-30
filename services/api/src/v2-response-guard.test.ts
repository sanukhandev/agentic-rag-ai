import { describe, expect, it } from 'vitest';
import { guardV2OfflineFallback, guardV2Response, type V2ResponseGuardContext } from './v2-response-guard.js';
import type { V2ApprovedFallbackTemplateSet } from './v2-fallbacks.js';

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

const fallbackTemplates = (): V2ApprovedFallbackTemplateSet => ({
  approved: true,
  personaVersionId: 'persona-12345678',
  templateVersion: 'fallback-12345678',
  language: 'en',
  templates: {
    missing_knowledge: 'I do not have a verified answer for that detail yet.',
    invalid_model: 'I could not produce a verified response just now.',
    rate_limited: 'I need a moment before I can continue with verified information.',
    tool_unavailable: 'The approved information service is temporarily unavailable.',
    action_processing: 'Your approved request is still being processed.',
    reconciliation: 'I need to verify the request status before I confirm the outcome.',
    consent_declined: 'Understood. I will not proceed with that action.',
    human_handoff: 'I am connecting this request to a human advisor for review.',
  },
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

  it('blocks legal registration claims without authoritative registration evidence', () => {
    const answer = response({ answer: 'Your company is legally registered.', citationIds: ['fact-12345678'] });
    const evidence = [{ citationId: 'fact-12345678', text: 'The government registration record confirms the company is legally registered.', sourceVersion: 'provider-12345678', approved: true, revoked: false }];
    expect(guardV2Response(answer, context({ evidence, legalRegistration: { status: 'not_verified', evidenceRef: null } })).verdict.reasonCode).toBe('unsupported_claim');
    expect(guardV2Response(answer, context({ evidence, legalRegistration: { status: 'verified', evidenceRef: 'registration-record-1' } })).verdict.accepted).toBe(true);
  });

  it('blocks a repeated or irrelevant question', () => {
    const result = guardV2Response(response({ answer: 'What is your activity?', nextQuestion: 'What is your activity?', nextQuestionKey: 'other_requirement', reasonNoQuestion: null }), context({ pendingRequirementKey: 'business_activity', lastQuestionKey: 'other_requirement', questionPolicy: 'required' }));
    expect(result.verdict.reasonCode).toBe('invalid_question');
  });

  it('allows a pending requirement only when the question is the approved next question', () => {
    const result = guardV2Response(response({ answer: 'I can help with that. What is your activity?', nextQuestion: 'What is your activity?', nextQuestionKey: 'business_activity', reasonNoQuestion: null }), context({ pendingRequirementKey: 'business_activity', questionPolicy: 'required' }));
    expect(result.verdict.accepted).toBe(true);
  });

  it('delivers every approved outage fallback family through the same guard', () => {
    for (const family of Object.keys(fallbackTemplates().templates) as Array<keyof V2ApprovedFallbackTemplateSet['templates']>) {
      const result = guardV2OfflineFallback(family, context({ fallbackTemplates: fallbackTemplates(), fallbackTemplateVersion: 'fallback-12345678' }));
      expect(result.verdict.accepted).toBe(true);
      expect(result.response?.reasonNoQuestion).toBe(family);
    }
  });

  it('fails closed for an unknown or unapproved fallback set', () => {
    const result = guardV2OfflineFallback('tool_unavailable', context({ fallbackTemplates: { ...fallbackTemplates(), approved: false }, fallbackTemplateVersion: 'fallback-12345678' }));
    expect(result.response).toBeNull();
    expect(result.verdict.reasonCode).toBe('policy_denied');
  });
});

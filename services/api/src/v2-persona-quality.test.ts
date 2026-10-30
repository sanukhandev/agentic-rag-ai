import { describe, expect, it } from 'vitest';
import { guardV2OfflineFallback, guardV2Response, type V2ResponseGuardContext } from './v2-response-guard.js';
import type { V2ApprovedEvidence } from './v2-evidence.js';

type Scenario = {
  name: string;
  answer: string;
  evidence?: V2ApprovedEvidence;
  nextQuestion?: string;
  nextQuestionKey?: string;
  reasonNoQuestion: string;
  questionPolicy?: 'required' | 'optional';
  pendingRequirementKey?: string | null;
};

const personas = [
  { personaVersionId: 'persona-zara-123456', assistantName: 'Zara' },
  { personaVersionId: 'persona-ava-123456', assistantName: 'Ava' },
] as const;

const scenarios: Scenario[] = [
  { name: 'first_greeting', answer: 'Hello, how can I help?', reasonNoQuestion: 'greeting' },
  { name: 'qualification_remembers_three_visas', answer: 'I have noted the three visas. What business activity are you planning?', evidence: { citationId: 'fact-qualification-123456', text: 'The customer has confirmed three visas and the next verified requirement is business activity.', sourceVersion: 'catalog-12345678', approved: true, revoked: false }, nextQuestion: 'What business activity are you planning?', nextQuestionKey: 'business_activity', reasonNoQuestion: '', questionPolicy: 'required', pendingRequirementKey: 'business_activity' },
  { name: 'fact_correction', answer: 'I updated the visa count to five as requested.', evidence: { citationId: 'fact-correction-123456', text: 'The customer corrected the verified visa count from three to five.', sourceVersion: 'catalog-12345678', approved: true, revoked: false }, reasonNoQuestion: 'correction_recorded' },
  { name: 'consent', answer: 'Your explicit consent is required before I proceed.', evidence: { citationId: 'fact-consent-12345678', text: 'Explicit customer consent is required before the action can proceed.', sourceVersion: 'catalog-12345678', approved: true, revoked: false }, reasonNoQuestion: 'consent_pending' },
  { name: 'action_status', answer: 'Your request is still processing, so I will share the next verified update when it arrives.', evidence: { citationId: 'fact-status-12345678', text: 'The verified action status is processing and no provider completion has been recorded.', sourceVersion: 'provider-12345678', approved: true, revoked: false }, reasonNoQuestion: 'action_pending' },
  { name: 'document_review', answer: 'Your document is under review and its OCR status is pending.', evidence: { citationId: 'fact-document-123456', text: 'The uploaded document is under review and OCR status is pending.', sourceVersion: 'document-12345678', approved: true, revoked: false }, reasonNoQuestion: 'document_pending' },
  { name: 'invoice_without_payment_claim', answer: 'The invoice is pending verification; I will not claim payment completion until it is confirmed.', evidence: { citationId: 'fact-invoice-12345678', text: 'The invoice status is pending verification and payment completion is not recorded.', sourceVersion: 'invoice-12345678', approved: true, revoked: false }, reasonNoQuestion: 'invoice_pending' },
  { name: 'contract_without_signature_claim', answer: 'The contract draft is ready for review, but signature is not yet verified.', evidence: { citationId: 'fact-contract-123456', text: 'The contract draft is ready for review and signature is not verified.', sourceVersion: 'contract-12345678', approved: true, revoked: false }, reasonNoQuestion: 'signature_pending' },
  { name: 'opt_out', answer: 'The action was declined, so I will not proceed.', evidence: { citationId: 'fact-optout-12345678', text: 'The customer declined the action and it must not proceed.', sourceVersion: 'policy-12345678', approved: true, revoked: false }, reasonNoQuestion: 'consent_declined' },
];

const context = (personaVersionId: string, scenario: Scenario): V2ResponseGuardContext => ({
  personaVersionId,
  permittedLanguages: ['en'],
  pendingRequirementKey: scenario.pendingRequirementKey ?? null,
  lastQuestionKey: null,
  questionPolicy: scenario.questionPolicy ?? 'optional',
  conversational: !scenario.evidence,
  ...(scenario.evidence ? { evidence: [scenario.evidence] } : {}),
});

const response = (personaVersionId: string, scenario: Scenario) => ({
  schemaVersion: 2,
  personaVersionId,
  language: 'en',
  answer: scenario.answer,
  citationIds: scenario.evidence ? [scenario.evidence.citationId] : [],
  nextQuestion: scenario.nextQuestion ?? null,
  nextQuestionKey: scenario.nextQuestionKey ?? null,
  reasonNoQuestion: scenario.reasonNoQuestion || null,
  decisionRef: 'decision-quality-123456',
});

describe('v2 persona quality matrix', () => {
  it('keeps both tenant personas isolated across the labeled narrative scenarios', () => {
    for (const persona of personas) {
      for (const scenario of scenarios) {
        const result = guardV2Response(response(persona.personaVersionId, scenario), context(persona.personaVersionId, scenario));
        expect(result.verdict.accepted, `${persona.assistantName}:${scenario.name}`).toBe(true);
        expect(result.response.personaVersionId).toBe(persona.personaVersionId);
        expect(result.response.language).toBe('en');
        expect((result.response.answer.match(/[?؟]/gu) ?? []).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('allows one purposeful qualification question and rejects repetition or unrelated keys', () => {
    const scenario = scenarios[1]!;
    const valid = guardV2Response(response(personas[0]!.personaVersionId, scenario), context(personas[0]!.personaVersionId, scenario));
    expect(valid.response.nextQuestionKey).toBe('business_activity');
    const repeated = guardV2Response(response(personas[0]!.personaVersionId, scenario), { ...context(personas[0]!.personaVersionId, scenario), lastQuestionKey: 'business_activity' });
    expect(repeated.verdict.reasonCode).toBe('invalid_question');
    const unrelated = guardV2Response(response(personas[0]!.personaVersionId, { ...scenario, nextQuestionKey: 'package_selection' }), context(personas[0]!.personaVersionId, scenario));
    expect(unrelated.verdict.reasonCode).toBe('invalid_question');
  });

  it('rejects cross-persona, wrong-language, JSON and false-completion output', () => {
    const scenario = scenarios[0]!;
    expect(guardV2Response(response('persona-ava-123456', scenario), context('persona-zara-123456', scenario)).verdict.reasonCode).toBe('persona_mismatch');
    expect(guardV2Response({ ...response('persona-zara-123456', scenario), language: 'ar' }, context('persona-zara-123456', scenario)).verdict.reasonCode).toBe('persona_mismatch');
    expect(guardV2Response({ ...response('persona-zara-123456', scenario), answer: '{"sessionId":"internal"}' }, context('persona-zara-123456', scenario)).verdict.reasonCode).toBe('metadata_leak');
    expect(guardV2Response({ ...response('persona-zara-123456', scenario), answer: 'The payment is complete.' }, context('persona-zara-123456', scenario)).verdict.reasonCode).toBe('unsupported_claim');
  });

  it('uses zero-question approved fallbacks for outage and opt-out exceptions', () => {
    const templates = { approved: true, personaVersionId: 'persona-zara-123456', templateVersion: 'fallback-zara-123456', language: 'en', templates: { rate_limited: 'I need a moment before I can continue with verified information.', consent_declined: 'Understood. I will not proceed with that action.' } };
    for (const family of ['rate_limited', 'consent_declined'] as const) {
      const result = guardV2OfflineFallback(family, { personaVersionId: 'persona-zara-123456', permittedLanguages: ['en'], pendingRequirementKey: null, lastQuestionKey: null, questionPolicy: 'forbidden', fallbackTemplateVersion: 'fallback-zara-123456', fallbackTemplates: templates });
      expect(result.verdict.accepted).toBe(true);
      expect(result.response?.nextQuestion).toBeNull();
    }
  });
});

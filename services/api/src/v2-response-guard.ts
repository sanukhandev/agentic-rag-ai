import { createHash } from 'node:crypto';
import { personaComposedResponseSchema, type PersonaComposedResponseV2, type ResponseGuardVerdictV2 } from './python-model/v2-contracts.js';
import { verifyV2ResponseEvidence, type V2ApprovedEvidence, type V2ClaimProvenance, type V2VerifiedFact } from './v2-evidence.js';
import { selectV2OfflineFallback, type V2ApprovedFallbackTemplateSet, type V2FallbackFamily } from './v2-fallbacks.js';
import type { V2LegalRegistrationState } from './v2-registration.js';

export type V2QuestionPolicy = 'required' | 'optional' | 'forbidden';

export interface V2ResponseGuardContext {
  personaVersionId: string;
  permittedLanguages: readonly string[];
  pendingRequirementKey: string | null;
  /** Current authoritative workflow stage, if present. */
  activeStageKey?: string | null;
  lastQuestionKey: string | null;
  questionPolicy: V2QuestionPolicy;
  evidence?: V2ApprovedEvidence[];
  verifiedFacts?: V2VerifiedFact[];
  conversational?: boolean;
  fallbackAnswer?: string;
  fallbackTemplateVersion?: string;
  fallbackTemplates?: V2ApprovedFallbackTemplateSet;
  legalRegistration?: V2LegalRegistrationState;
  /** Only set for a deterministic, server-authored no-evidence response. Never use for model output. */
  approvedNoEvidenceAnswer?: string;
  /** Authorize only a narrowly validated model-authored non-factual acknowledgement/question. */
  allowNonFactualDialogue?: boolean;
}

export interface V2GuardFeedback {
  reasonCode: ResponseGuardVerdictV2['reasonCode'];
  responseDigest: string;
  retryable: boolean;
}

export interface V2ResponseGuardDecision {
  verdict: ResponseGuardVerdictV2;
  response: PersonaComposedResponseV2;
  claims: V2ClaimProvenance[];
  feedback: V2GuardFeedback | null;
}

export interface V2OfflineFallbackDecision {
  verdict: ResponseGuardVerdictV2;
  response: PersonaComposedResponseV2 | null;
  feedback: V2GuardFeedback | null;
}

const DEFAULT_FALLBACK = 'I’m unable to verify that response from the approved information yet. I can continue once the verified information is available.';
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
const rejected = (reasonCode: ResponseGuardVerdictV2['reasonCode']): ResponseGuardVerdictV2 => ({ schemaVersion: 2, accepted: false, reasonCode, response: null });

const feedback = (reasonCode: ResponseGuardVerdictV2['reasonCode'], input: unknown): V2GuardFeedback => ({
  reasonCode,
  responseDigest: digest(input),
  retryable: reasonCode === 'invalid_citation' || reasonCode === 'unsupported_claim' || reasonCode === 'invalid_question' || reasonCode === 'metadata_leak',
});

const fallback = (context: V2ResponseGuardContext, reasonCode: ResponseGuardVerdictV2['reasonCode']): PersonaComposedResponseV2 => ({
  schemaVersion: 2,
  personaVersionId: context.personaVersionId,
  language: context.permittedLanguages[0] ?? 'en',
  answer: (context.fallbackAnswer ?? DEFAULT_FALLBACK).trim().slice(0, 12_000),
  citationIds: [],
  nextQuestion: null,
  nextQuestionKey: null,
  reasonNoQuestion: reasonCode,
  decisionRef: `guard-fallback-${digest({ reasonCode, personaVersionId: context.personaVersionId })}`,
});

const questionFailure = (response: PersonaComposedResponseV2, context: V2ResponseGuardContext): ResponseGuardVerdictV2['reasonCode'] | null => {
  const hasQuestion = response.nextQuestion !== null;
  if (hasQuestion && !response.nextQuestion?.includes('?')) return 'invalid_question';
  if (hasQuestion && response.nextQuestionKey === null) return 'invalid_question';
  if (hasQuestion && context.pendingRequirementKey !== null && response.nextQuestionKey !== context.pendingRequirementKey) return 'invalid_question';
  // Re-asking the current unanswered requirement is legitimate. The previous
  // question key is a repetition guard only when it does not describe the
  // authoritative pending requirement (which Node may preserve across turns).
  const stillPending = response.nextQuestionKey === context.pendingRequirementKey
    || (context.pendingRequirementKey === null && Boolean(context.activeStageKey)
      && response.nextQuestionKey === `stage:${context.activeStageKey}`);
  if (hasQuestion && response.nextQuestionKey === context.lastQuestionKey && !stillPending) return 'invalid_question';
  if (context.questionPolicy === 'required' && !hasQuestion) return 'invalid_question';
  if (context.questionPolicy === 'forbidden' && hasQuestion) return 'invalid_question';
  if (!hasQuestion && response.reasonNoQuestion === null) return 'invalid_question';
  if (hasQuestion && response.reasonNoQuestion !== null) return 'invalid_question';
  return null;
};

export const guardV2Response = (input: unknown, context: V2ResponseGuardContext): V2ResponseGuardDecision => {
  const parsed = personaComposedResponseSchema.safeParse(input);
  if (!parsed.success) {
    const reasonCode: ResponseGuardVerdictV2['reasonCode'] = 'metadata_leak';
    return { verdict: rejected(reasonCode), response: fallback(context, reasonCode), claims: [], feedback: feedback(reasonCode, input) };
  }
  const response = parsed.data;
  if (response.personaVersionId !== context.personaVersionId || !context.permittedLanguages.includes(response.language)) {
    const reasonCode: ResponseGuardVerdictV2['reasonCode'] = 'persona_mismatch';
    return { verdict: rejected(reasonCode), response: fallback(context, reasonCode), claims: [], feedback: feedback(reasonCode, input) };
  }
  const questionReason = questionFailure(response, context);
  if (questionReason) return { verdict: rejected(questionReason), response: fallback(context, questionReason), claims: [], feedback: feedback(questionReason, input) };
  const unverifiedOutcome = /(?:payment|invoice|contract|signature|signed|account|opportunity|registration).{0,40}\b(?:complete|completed|success(?:ful)?|created|paid|signed|registered)\b/iu.test(response.answer);
  if (response.citationIds.length === 0 && unverifiedOutcome && !/^\s*(?:(?:thanks?(?: for clarifying)?|understood)\.\s+)?(?:(?:i(?:'|’)ll|i will)\s+wait for verified evidence and (?:i\s+)?(?:won't|won’t|will not)\s+assume (?:the )?(?:account|opportunity|payment|invoice|contract)\s+(?:is|was)\s+(?:complete|completed|created|registered|paid|signed)|(?:i(?:'|’)m|i\s+(?:will not|won't|won’t))\s+not treat (?:the )?(?:account|opportunity|payment|invoice|contract)\s+as\s+(?:complete|completed|created|registered|paid|signed)\s+without verified evidence)\.?\s*$/iu.test(response.answer)) {
    const reasonCode: ResponseGuardVerdictV2['reasonCode'] = 'unsupported_claim';
    return { verdict: rejected(reasonCode), response: fallback(context, reasonCode), claims: [], feedback: feedback(reasonCode, input) };
  }
  if ((context.legalRegistration?.status ?? 'not_verified') !== 'verified' && /\b(?:company|business|entity)\b.{0,40}\blegally\s+registered\b|\blegally\s+registered\b.{0,40}\b(?:company|business|entity)\b/iu.test(response.answer)) {
    const reasonCode: ResponseGuardVerdictV2['reasonCode'] = 'unsupported_claim';
    return { verdict: rejected(reasonCode), response: fallback(context, reasonCode), claims: [], feedback: feedback(reasonCode, input) };
  }
  const approvedNoEvidenceAnswer = context.approvedNoEvidenceAnswer === response.answer
    && response.citationIds.length === 0
    && (context.evidence?.length ?? 0) === 0
    && (context.verifiedFacts?.length ?? 0) === 0;
  const evidenceOptions: { conversational?: boolean; allowUncitedQuestion: boolean; allowNonFactualDialogue?: boolean; allowApprovedFallback?: boolean; pendingRequirementKey?: string | null } = { allowUncitedQuestion: context.questionPolicy === 'required', allowNonFactualDialogue: context.allowNonFactualDialogue === true, pendingRequirementKey: context.pendingRequirementKey };
  if (approvedNoEvidenceAnswer) evidenceOptions.allowApprovedFallback = true;
  if (context.conversational !== undefined) evidenceOptions.conversational = context.conversational;
  const evidence = verifyV2ResponseEvidence(response, context.evidence ?? [], context.verifiedFacts ?? [], evidenceOptions);
  if (!evidence.verdict.accepted) return { verdict: evidence.verdict, response: fallback(context, evidence.verdict.reasonCode), claims: [], feedback: feedback(evidence.verdict.reasonCode, input) };
  return { verdict: evidence.verdict, response, claims: evidence.claims, feedback: null };
};

export const guardV2OfflineFallback = (family: V2FallbackFamily, context: V2ResponseGuardContext): V2OfflineFallbackDecision => {
  const response = selectV2OfflineFallback({
    personaVersionId: context.personaVersionId,
    templateVersion: context.fallbackTemplateVersion ?? '',
    language: context.permittedLanguages[0] ?? 'en',
    family,
  }, context.fallbackTemplates);
  if (!response) {
    const reasonCode: ResponseGuardVerdictV2['reasonCode'] = 'policy_denied';
    return { verdict: rejected(reasonCode), response: null, feedback: feedback(reasonCode, { family, personaVersionId: context.personaVersionId }) };
  }
  const evidence = verifyV2ResponseEvidence(response, [], [], { allowApprovedFallback: true });
  if (!evidence.verdict.accepted) return { verdict: evidence.verdict, response: null, feedback: feedback(evidence.verdict.reasonCode, response) };
  return { verdict: evidence.verdict, response, feedback: null };
};

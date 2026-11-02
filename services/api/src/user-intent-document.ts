import type { ApprovedIntentResponse, IntentTurnAssessment, UserIntentDocument, UserIntentFact } from './types.js';

const MAX_SUMMARY_LENGTH = 8_000;
const MAX_RESPONSE_LENGTH = 20_000;
const MAX_REFERENCE_LENGTH = 160;
const forbiddenField = /(?:^|[._-])(otp|cvv|pan|password|secret)(?:$|[._-])/iu;
const rawPii = /(?:\b\d{12,19}\b|\b\d{3}[- )]\d{3}[- ]\d{4}\b|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/u;

const assertSafeText = (value: string, name: string, max: number): void => {
  if (value.length > max || rawPii.test(value)) throw new Error(`INTENT_DOCUMENT_UNSAFE_${name.toUpperCase()}`);
};

const assertFacts = (facts: Record<string, UserIntentFact>, name: string): void => {
  for (const [key, fact] of Object.entries(facts)) {
    if (forbiddenField.test(key) || fact.maskedValue.length > 2_000 || rawPii.test(fact.maskedValue) || fact.evidenceRefs.some((ref) => ref.length > MAX_REFERENCE_LENGTH)) throw new Error(`INTENT_DOCUMENT_UNSAFE_${name.toUpperCase()}`);
    if (!Number.isInteger(fact.messageSequence) || fact.messageSequence < 0) throw new Error('INTENT_DOCUMENT_INVALID_FACT_SEQUENCE');
  }
};

export const assertSafeApprovedResponse = (response: ApprovedIntentResponse | null): void => {
  if (!response) return;
  assertSafeText(response.answer, 'response', MAX_RESPONSE_LENGTH);
  if (response.citationRefs.some((ref) => ref.length > MAX_REFERENCE_LENGTH)) throw new Error('INTENT_DOCUMENT_UNSAFE_RESPONSE');
  if (response.pendingRequirementKey && response.pendingRequirementKey.length > 160) throw new Error('INTENT_DOCUMENT_UNSAFE_RESPONSE');
};

export const assertSafeUserIntentDocument = (document: UserIntentDocument): void => {
  if (document.catalogVersionRef.length > 240 || document.summary.length > MAX_SUMMARY_LENGTH) throw new Error('INTENT_DOCUMENT_BOUNDS');
  assertSafeText(document.summary, 'summary', MAX_SUMMARY_LENGTH);
  assertFacts(document.verifiedFacts, 'facts');
  assertSafeApprovedResponse(document.approvedResponse);
  if (document.lastQuestion && document.lastQuestion.length > 2_000) throw new Error('INTENT_DOCUMENT_BOUNDS');
  if (document.toolRefs.some((ref) => ref.length > MAX_REFERENCE_LENGTH) || document.sourceRefs.some((ref) => ref.length > MAX_REFERENCE_LENGTH)) throw new Error('INTENT_DOCUMENT_BOUNDS');
  if (!Number.isInteger(document.revision) || document.revision < 0 || !Number.isInteger(document.stageRevision) || document.stageRevision < 0 || !Number.isInteger(document.summaryRevision) || document.summaryRevision < 0) throw new Error('INTENT_DOCUMENT_INVALID_REVISION');
};

export const assertSafeIntentTurn = (assessment: IntentTurnAssessment): void => {
  if (!assessment.clientMessageId || assessment.clientMessageId.length > 128 || !/^[a-f0-9]{64}$/u.test(assessment.messageHash)) throw new Error('INTENT_TURN_INVALID_IDENTITY');
  assertFacts(assessment.verifiedFactPatch, 'fact_patch');
  assertSafeApprovedResponse(assessment.approvedResponse);
  if (assessment.lastQuestion && assessment.lastQuestion.length > 2_000) throw new Error('INTENT_TURN_BOUNDS');
  if (assessment.toolRefs.some((ref) => ref.length > MAX_REFERENCE_LENGTH) || assessment.sourceRefs.some((ref) => ref.length > MAX_REFERENCE_LENGTH)) throw new Error('INTENT_TURN_BOUNDS');
  if (!Number.isInteger(assessment.turnSequence) || assessment.turnSequence < 1) throw new Error('INTENT_TURN_INVALID_SEQUENCE');
};

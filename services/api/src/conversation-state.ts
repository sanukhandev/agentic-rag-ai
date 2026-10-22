import { randomUUID } from 'node:crypto';
import type { ConversationPhase, ConversationState, PendingPrompt } from './types.js';

const workflowStatusRank: Record<ConversationState['workflowStatus'], number> = { none: 0, queued: 1, processing: 2, reconcile_required: 3, failed: 3, succeeded: 4 };

export const consentVersionForState = (state: Pick<ConversationState, 'catalogVersionId' | 'selectedIntentKey'>): string => `contact-v1:${state.catalogVersionId ?? 'legacy'}:${state.selectedIntentKey ?? 'legacy'}`;

const hasScopedConsent = (state: ConversationState): boolean => state.contactConsent === 'granted' && state.consentVersion === consentVersionForState(state);

export const mergeConcurrentConversationState = (latest: ConversationState, candidate: ConversationState): ConversationState => {
  const latestWins = workflowStatusRank[latest.workflowStatus] > workflowStatusRank[candidate.workflowStatus];
  const workflowState = latestWins ? latest : candidate;
  const consentPurposeChanged = latest.catalogVersionId !== candidate.catalogVersionId || latest.selectedIntentKey !== candidate.selectedIntentKey;
  const slotValues = { ...latest.slotValues, ...candidate.slotValues };
  const revoked = latest.contactConsent === 'denied' || candidate.contactConsent === 'denied';
  if (consentPurposeChanged || revoked) delete slotValues.contact_consent;
  const granted = !consentPurposeChanged && !revoked && (hasScopedConsent(latest) || hasScopedConsent(candidate));
  const contactConsent = granted ? 'granted' : revoked ? 'denied' : 'unknown';
  const consentSource = contactConsent === 'granted' ? (hasScopedConsent(candidate) ? candidate : latest) : null;
  return {
    ...latest,
    ...candidate,
    workflowStatus: workflowState.workflowStatus,
    phase: workflowState.phase,
    pendingPrompt: workflowState.pendingPrompt,
    slotValues,
    candidateIntentKeys: [...new Set([...latest.candidateIntentKeys, ...candidate.candidateIntentKeys])],
    contactConsent,
    consentCapturedAt: consentSource?.consentCapturedAt ?? null,
    consentVersion: consentSource?.consentVersion ?? null,
  };
};

export const mergeWorkflowCallbackState = (latest: ConversationState, candidate: ConversationState): ConversationState => {
  const workflowScopeChanged = latest.catalogVersionId !== candidate.catalogVersionId || latest.selectedIntentKey !== candidate.selectedIntentKey;
  const latestWins = workflowScopeChanged || workflowStatusRank[latest.workflowStatus] > workflowStatusRank[candidate.workflowStatus];
  const workflowState = latestWins ? latest : candidate;
  return {
    ...latest,
    workflowStatus: workflowState.workflowStatus,
    phase: workflowState.phase,
    pendingPrompt: workflowState.pendingPrompt,
  };
};

export const newConversationState = (): ConversationState => ({
  phase: 'DISCOVERY',
  catalogVersionId: null,
  candidateIntentKeys: [],
  selectedIntentKey: null,
  slotValues: {},
  pendingPrompt: null,
  rollingSummary: '',
  summaryRevision: 0,
  messageSequence: 0,
  workflowStatus: 'none',
  contactConsent: 'unknown',
  consentVersion: null,
  consentCapturedAt: null,
});

export const prompt = (type: PendingPrompt['type'], intentKey: string | null, slotKey: string | null): PendingPrompt => ({ id: randomUUID(), type, intentKey, slotKey, issuedAt: new Date().toISOString() });

export const phaseFor = (input: { intentKey: string | null; missingSlot: string | null; consentPending: boolean; actionPending: boolean }): ConversationPhase => {
  if (input.actionPending) return 'ACTION_CONFIRMATION';
  if (input.consentPending) return 'CONSENT_PENDING';
  if (input.missingSlot === 'name' || input.missingSlot === 'email' || input.missingSlot === 'phone') return 'CONTACT_COLLECTION';
  if (input.missingSlot) return 'SLOT_COLLECTION';
  if (input.intentKey) return 'QUEUED';
  return 'DISCOVERY';
};

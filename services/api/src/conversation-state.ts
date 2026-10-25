import { randomUUID } from 'node:crypto';
import type { ConversationPhase, ConversationState, PendingPrompt } from './types.js';

const workflowStatusRank: Record<ConversationState['workflowStatus'], number> = { none: 0, awaiting_customer: 1, queued: 1, processing: 2, human_review: 3, reconcile_required: 3, failed: 3, succeeded: 4 };

export const consentVersionForState = (state: Pick<ConversationState, 'catalogVersionId' | 'selectedIntentKey'>): string => `contact-v1:${state.catalogVersionId ?? 'legacy'}:${state.selectedIntentKey ?? 'legacy'}`;

const hasScopedConsent = (state: ConversationState): boolean => state.contactConsent === 'granted' && state.consentVersion === consentVersionForState(state);

export const mergeConcurrentConversationState = (latest: ConversationState, candidate: ConversationState): ConversationState => {
  const latestWins = workflowStatusRank[latest.workflowStatus] > workflowStatusRank[candidate.workflowStatus];
  const workflowState = latestWins ? latest : candidate;
  const consentPurposeChanged = latest.catalogVersionId !== candidate.catalogVersionId || latest.selectedIntentKey !== candidate.selectedIntentKey;
  const slotValues = { ...latest.slotValues };
  const slotProvenance = { ...(latest.slotProvenance ?? {}) };
  for (const [slotKey, value] of Object.entries(candidate.slotValues)) {
    const currentProvenance = slotProvenance[slotKey];
    const incomingProvenance = candidate.slotProvenance?.[slotKey];
    const incomingWins = !currentProvenance || !incomingProvenance
      || incomingProvenance.messageSequence > currentProvenance.messageSequence
      || (incomingProvenance.messageSequence === currentProvenance.messageSequence
        && (incomingProvenance.capturedAt > currentProvenance.capturedAt
          || (incomingProvenance.capturedAt === currentProvenance.capturedAt && incomingProvenance.corrected && !currentProvenance.corrected)));
    if (incomingWins) {
      slotValues[slotKey] = value;
      if (incomingProvenance) slotProvenance[slotKey] = incomingProvenance;
    }
  }
  const revoked = latest.contactConsent === 'denied' || candidate.contactConsent === 'denied';
  if (consentPurposeChanged || revoked) delete slotValues.contact_consent;
  const granted = !consentPurposeChanged && !revoked && (hasScopedConsent(latest) || hasScopedConsent(candidate));
  const contactConsent = granted ? 'granted' : revoked ? 'denied' : 'unknown';
  const consentSource = contactConsent === 'granted' ? (hasScopedConsent(candidate) ? candidate : latest) : null;
  const summarySource = (candidate.summaryRevision ?? 0) > (latest.summaryRevision ?? 0)
    || ((candidate.summaryRevision ?? 0) === (latest.summaryRevision ?? 0) && (candidate.messageSequence ?? 0) > (latest.messageSequence ?? 0))
    ? candidate : latest;
  return {
    ...latest,
    ...candidate,
    workflowStatus: workflowState.workflowStatus,
    phase: workflowState.phase,
    pendingPrompt: workflowState.pendingPrompt,
    slotValues,
    slotProvenance,
    intentScore: workflowState.intentScore ?? latest.intentScore ?? candidate.intentScore ?? 0,
    intentConfidence: workflowState.intentConfidence ?? latest.intentConfidence ?? candidate.intentConfidence ?? 0,
    intentEvidence: [...new Set([...(latest.intentEvidence ?? []), ...(candidate.intentEvidence ?? [])])],
    activeFollowUpIntentKey: candidate.activeFollowUpIntentKey ?? latest.activeFollowUpIntentKey ?? null,
    summaryRevision: Math.max(latest.summaryRevision ?? 0, candidate.summaryRevision ?? 0),
    messageSequence: Math.max(latest.messageSequence ?? 0, candidate.messageSequence ?? 0),
    rollingSummary: summarySource.rollingSummary,
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
  const preserveVisitorPrompt = Boolean(latest.pendingPrompt && latest.pendingPrompt.type !== 'confirmation');
  return {
    ...latest,
    workflowStatus: workflowState.workflowStatus,
    phase: preserveVisitorPrompt ? latest.phase : workflowState.phase,
    pendingPrompt: preserveVisitorPrompt ? latest.pendingPrompt : workflowState.pendingPrompt,
    activeFollowUpIntentKey: latest.activeFollowUpIntentKey ?? candidate.activeFollowUpIntentKey ?? null,
  };
};

export const newConversationState = (): ConversationState => ({
  phase: 'DISCOVERY',
  catalogVersionId: null,
  candidateIntentKeys: [],
  selectedIntentKey: null,
  activeFollowUpIntentKey: null,
  intentScore: 0,
  intentConfidence: 0,
  intentEvidence: [],
  slotValues: {},
  slotProvenance: {},
  pendingPrompt: null,
  rollingSummary: '',
  summaryRevision: 0,
  messageSequence: 0,
  workflowStatus: 'none',
  contactConsent: 'unknown',
  consentVersion: null,
  consentCapturedAt: null,
});

export const composeConversationSummary = (state: ConversationState, latestVisitorMessage: string): string => {
  const slots = Object.entries(state.slotValues).filter(([key]) => key !== 'contact_consent').map(([key, value]) => `${key}=${value}`).join(', ');
  return [
    state.selectedIntentKey ? `Primary intent: ${state.selectedIntentKey} (${Math.round((state.intentConfidence ?? 0) * 100)}% confidence).` : 'Primary intent: unresolved.',
    state.activeFollowUpIntentKey ? `Active follow-up intent: ${state.activeFollowUpIntentKey}.` : '',
    slots ? `Visitor-provided requirements: ${slots}.` : 'Visitor-provided requirements: none captured yet.',
    `Consent: ${state.contactConsent}. Workflow: ${state.workflowStatus}.`,
    state.pendingPrompt ? `Next question: ${state.pendingPrompt.type}${state.pendingPrompt.slotKey ? `/${state.pendingPrompt.slotKey}` : ''}.` : 'Next question: none.',
    latestVisitorMessage ? `Latest visitor message: ${latestVisitorMessage.slice(-500)}` : '',
  ].filter(Boolean).join(' ');
};

export const prompt = (type: PendingPrompt['type'], intentKey: string | null, slotKey: string | null): PendingPrompt => ({ id: randomUUID(), type, intentKey, slotKey, issuedAt: new Date().toISOString() });

export const phaseFor = (input: { intentKey: string | null; missingSlot: string | null; consentPending: boolean; actionPending: boolean }): ConversationPhase => {
  if (input.actionPending) return 'ACTION_CONFIRMATION';
  if (input.consentPending) return 'CONSENT_PENDING';
  if (input.missingSlot === 'name' || input.missingSlot === 'email' || input.missingSlot === 'phone') return 'CONTACT_COLLECTION';
  if (input.missingSlot) return 'SLOT_COLLECTION';
  if (input.intentKey) return 'QUEUED';
  return 'DISCOVERY';
};

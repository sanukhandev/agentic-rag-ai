import { randomUUID } from 'node:crypto';
import type { ConversationPhase, ConversationState, IntentProgressState, PendingFollowUpOffer, PendingPrompt } from './types.js';

const workflowStatusRank: Record<ConversationState['workflowStatus'], number> = { none: 0, awaiting_customer: 1, queued: 1, processing: 2, human_review: 3, reconcile_required: 3, failed: 3, succeeded: 4 };

const turnOrder = (state: ConversationState): number => {
  const timestamp = state.lastTurnAt ? Date.parse(state.lastTurnAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : state.messageSequence ?? 0;
};

const newerTurnWins = (latest: ConversationState, candidate: ConversationState): boolean => {
  const latestOrder = turnOrder(latest);
  const candidateOrder = turnOrder(candidate);
  return candidateOrder > latestOrder || (candidateOrder === latestOrder && candidate.messageSequence > latest.messageSequence);
};

const mergePendingOffer = (latest: ConversationState, candidate: ConversationState): PendingFollowUpOffer | null => {
  const latestOffer = latest.pendingFollowUpOffer ?? null;
  const candidateOffer = candidate.pendingFollowUpOffer ?? null;
  if (latestOffer?.offerKey && latestOffer.offerKey === candidateOffer?.offerKey) return candidateOffer;
  if (!latestOffer && candidateOffer) return candidateOffer.issuedAt > (latest.lastTurnAt ?? '') ? candidateOffer : null;
  if (latestOffer && !candidateOffer) return newerTurnWins(latest, candidate) ? null : latestOffer;
  if (latestOffer && candidateOffer) return candidateOffer.issuedAt > latestOffer.issuedAt ? candidateOffer : latestOffer;
  return null;
};

export const consentVersionForState = (state: Pick<ConversationState, 'catalogVersionId' | 'selectedIntentKey'>): string => `contact-v1:${state.catalogVersionId ?? 'legacy'}:${state.selectedIntentKey ?? 'legacy'}`;

const hasScopedConsent = (state: ConversationState): boolean => state.contactConsent === 'granted' && state.consentVersion === consentVersionForState(state);

export const newIntentProgress = (): IntentProgressState => ({ version: 1, activeIntentKey: null, pausedIntentKeys: [], fulfilledIntentKeys: [], entries: {}, visitedIntentKeys: [], lastTransitionReason: null, journeyRevision: 0 });

const normalizeIntentProgress = (progress: IntentProgressState | undefined): IntentProgressState => {
  if (!progress || progress.version !== 1) return newIntentProgress();
  const entries = Object.fromEntries(Object.entries(progress.entries ?? {}).slice(0, 32).map(([key, entry]) => [key, { intentKey: entry.intentKey, status: entry.status, completedRequirementKeys: [...new Set((entry.completedRequirementKeys ?? []).slice(0, 64))], currentRequirementKey: entry.currentRequirementKey ?? null, revision: Math.max(0, Math.floor(entry.revision ?? 0)) }])) as IntentProgressState['entries'];
  return { version: 1, activeIntentKey: progress.activeIntentKey ?? null, pausedIntentKeys: [...new Set((progress.pausedIntentKeys ?? []).slice(0, 16))], fulfilledIntentKeys: [...new Set((progress.fulfilledIntentKeys ?? []).slice(0, 16))], entries, visitedIntentKeys: [...new Set((progress.visitedIntentKeys ?? []).slice(0, 32))], lastTransitionReason: progress.lastTransitionReason ?? null, ...(progress.lastDeclinedTransition ? { lastDeclinedTransition: progress.lastDeclinedTransition } : {}), journeyRevision: Math.max(0, Math.floor(progress.journeyRevision ?? 0)) };
};

const mergeIntentProgress = (latest: ConversationState, candidate: ConversationState): IntentProgressState => {
  const left = normalizeIntentProgress(latest.intentProgress);
  const right = normalizeIntentProgress(candidate.intentProgress);
  const winner = right.journeyRevision >= left.journeyRevision ? right : left;
  const entries = { ...left.entries };
  for (const [intentKey, entry] of Object.entries(right.entries)) {
    const existing = entries[intentKey];
    if (!existing || entry.revision >= existing.revision) entries[intentKey] = { ...entry, completedRequirementKeys: [...new Set(entry.completedRequirementKeys)] };
    else entries[intentKey] = { ...existing, completedRequirementKeys: [...new Set([...existing.completedRequirementKeys, ...entry.completedRequirementKeys])] };
  }
  return { ...winner, entries, pausedIntentKeys: [...new Set([...left.pausedIntentKeys, ...right.pausedIntentKeys])].slice(0, 16), fulfilledIntentKeys: [...new Set([...left.fulfilledIntentKeys, ...right.fulfilledIntentKeys])].slice(0, 16), visitedIntentKeys: [...new Set([...left.visitedIntentKeys, ...right.visitedIntentKeys])].slice(0, 32), journeyRevision: Math.max(left.journeyRevision, right.journeyRevision) };
};

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
  const candidateTurnIsNewer = newerTurnWins(latest, candidate);
  return {
    ...latest,
    ...candidate,
    workflowStatus: workflowState.workflowStatus,
    phase: workflowState.phase,
    pendingPrompt: candidateTurnIsNewer ? candidate.pendingPrompt : latest.pendingPrompt,
    pendingFollowUpOffer: mergePendingOffer(latest, candidate),
    slotValues,
    slotProvenance,
    intentScore: workflowState.intentScore ?? latest.intentScore ?? candidate.intentScore ?? 0,
    intentConfidence: workflowState.intentConfidence ?? latest.intentConfidence ?? candidate.intentConfidence ?? 0,
    intentEvidence: [...new Set([...(latest.intentEvidence ?? []), ...(candidate.intentEvidence ?? [])])],
    intentProgress: mergeIntentProgress(latest, candidate),
    activeFollowUpIntentKey: candidate.activeFollowUpIntentKey ?? latest.activeFollowUpIntentKey ?? null,
    summaryRevision: Math.max(latest.summaryRevision ?? 0, candidate.summaryRevision ?? 0),
    messageSequence: Math.max(latest.messageSequence ?? 0, candidate.messageSequence ?? 0),
    lastTurnAt: (latest.lastTurnAt ?? '') >= (candidate.lastTurnAt ?? '') ? latest.lastTurnAt ?? null : candidate.lastTurnAt ?? null,
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
    // Workflow callbacks do not own conversational offers; never let a stale callback erase a newer chat turn.
    pendingFollowUpOffer: latest.pendingFollowUpOffer ?? null,
    activeFollowUpIntentKey: latest.activeFollowUpIntentKey ?? candidate.activeFollowUpIntentKey ?? null,
    intentProgress: mergeIntentProgress(latest, candidate),
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
  intentProgress: newIntentProgress(),
  slotValues: {},
  slotProvenance: {},
  pendingPrompt: null,
  pendingFollowUpOffer: null,
  rollingSummary: '',
  summaryRevision: 0,
  messageSequence: 0,
  lastTurnAt: null,
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
    state.pendingFollowUpOffer ? `Pending follow-up offer: ${state.pendingFollowUpOffer.options.map((option) => option.key).join(', ')}.` : '',
    latestVisitorMessage ? `Latest visitor message: ${latestVisitorMessage.slice(-500)}` : '',
  ].filter(Boolean).join(' ');
};

export const prompt = (type: PendingPrompt['type'], intentKey: string | null, slotKey: string | null, requirementKey: string | null = null): PendingPrompt => ({ id: randomUUID(), type, intentKey, slotKey, requirementKey, issuedAt: new Date().toISOString() });

export const phaseFor = (input: { intentKey: string | null; missingSlot: string | null; consentPending: boolean; actionPending: boolean }): ConversationPhase => {
  if (input.actionPending) return 'ACTION_CONFIRMATION';
  if (input.consentPending) return 'CONSENT_PENDING';
  if (input.missingSlot === 'name' || input.missingSlot === 'email' || input.missingSlot === 'phone') return 'CONTACT_COLLECTION';
  if (input.missingSlot) return 'SLOT_COLLECTION';
  if (input.intentKey) return 'QUEUED';
  return 'DISCOVERY';
};

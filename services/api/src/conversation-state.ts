import { randomUUID } from 'node:crypto';
import type { ConversationPhase, ConversationState, PendingPrompt } from './types.js';

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

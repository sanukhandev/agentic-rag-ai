import type { IntentCatalogVersion, IntentProgressEntry } from './types.js';
import { catalogNextJourneyRequirement } from './intent-catalog.js';

export type TurnKind = 'INFORMATION_QUESTION' | 'SLOT_ANSWER' | 'MULTI_SLOT_ANSWER' | 'SLOT_CORRECTION' | 'INTENT_DISCOVERY' | 'INTENT_SWITCH' | 'CONSENT_RESPONSE' | 'DOCUMENT_RESPONSE' | 'FAREWELL' | 'SMALL_TALK';
export type JourneyStatus = 'CREATED' | 'ACTIVE' | 'WAITING_FOR_CUSTOMER' | 'WAITING_FOR_CONSENT' | 'WAITING_FOR_EXTERNAL_ACTION' | 'PAUSED' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'HUMAN_REVIEW';
export type JourneyPlan =
  | { type: 'ASK_REQUIREMENT'; requirementKey: string; reasonCode: 'required_fact_missing' | 'document_missing' }
  | { type: 'RETRIEVE_KNOWLEDGE'; reasonCode: 'informational_interrupt' }
  | { type: 'COMPLETE_JOURNEY'; reasonCode: 'requirements_satisfied' }
  | { type: 'RESUME_JOURNEY'; journeyId: string; reasonCode: 'return_to_pending_requirement' };

export const classifyTurn = (text: string, pendingRequirementKey?: string | null): TurnKind => {
  const normalized = text.trim().toLocaleLowerCase('en-US');
  if (/\b(bye|goodbye|thanks,? that is all|see you)\b/u.test(normalized)) return 'FAREWELL';
  if (/\b(what|which|how much|how many|tell me|can you explain)\b/u.test(normalized) && /\?/u.test(normalized)) return 'INFORMATION_QUESTION';
  if (/\b(correct|actually|instead|change that|no,? it is)\b/u.test(normalized)) return 'SLOT_CORRECTION';
  if (pendingRequirementKey && normalized.length > 0) return 'SLOT_ANSWER';
  return 'INTENT_DISCOVERY';
};

export const planNextJourneyStep = (catalog: IntentCatalogVersion, entry: IntentProgressEntry, documents: Array<{ intentKey?: string | null; catalogVersionId?: string | null; requirementKey?: string | null; expectedDocumentType?: string | null; status: string }> = [], turnKind?: TurnKind): JourneyPlan => {
  if (turnKind === 'INFORMATION_QUESTION') return { type: 'RETRIEVE_KNOWLEDGE', reasonCode: 'informational_interrupt' };
  const values = entry.slotValues ?? {};
  const next = catalogNextJourneyRequirement(catalog, entry.intentKey, values, entry.completedRequirementKeys, documents);
  if (next) return { type: 'ASK_REQUIREMENT', requirementKey: next.requirementKey, reasonCode: next.requirementType === 'document' ? 'document_missing' : 'required_fact_missing' };
  return { type: 'COMPLETE_JOURNEY', reasonCode: 'requirements_satisfied' };
};

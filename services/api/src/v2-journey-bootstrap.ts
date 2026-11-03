import { randomUUID } from 'node:crypto';
import { newIntentProgress } from './conversation-state.js';
import { newLifecycleState } from './lifecycle-state.js';
import { evaluateV2StageBoundary, type V2ActionGateContext, type V2StageBoundaryDecision } from './v2-action-gate.js';
import type { ConversationState, IntentCatalogV2Version, IntentProgressEntry, Session, UserIntentDocument } from './types.js';

export interface V2JourneyBootstrap {
  state: ConversationState;
  document: UserIntentDocument;
  created: boolean;
}

/**
 * Goal confirmation authorizes a local journey identity and initial stage,
 * not any external Lead, Salesforce, payment or contract operation.
 *
 * This runs BEFORE the V2 session/intent/message atomic commit.
 */
export const initializeConfirmedV2Journey = (
  state: ConversationState,
  document: UserIntentDocument,
  newId: () => string = randomUUID,
): V2JourneyBootstrap => {
  if (document.catalogSource !== 'v2' || !document.goalConfirmed
    || document.goalConfirmation?.status !== 'confirmed' || !document.businessGoalKey) {
    return { state, document, created: false };
  }
  const goalKey = document.businessGoalKey;
  const progress = state.intentProgress ?? newIntentProgress();
  const oldEntry = progress.entries[goalKey];
  if (document.opportunityId) {
    if (!oldEntry?.lifecycle || oldEntry.journeyId !== document.opportunityId
      || oldEntry.lifecycle.currentStage !== (document.currentStageKey === 'payment_invoice' ? 'billing_invoice' : document.currentStageKey)) {
      throw new Error('V2_JOURNEY_AUTHORITY_MISMATCH');
    }
    return { state, document, created: false };
  }
  if (oldEntry?.journeyId || document.currentStageKey !== null) {
    throw new Error('V2_JOURNEY_REQUIRES_RECONCILIATION');
  }
  const opportunityId = newId();
  const lifecycle = newLifecycleState();
  const entry: IntentProgressEntry = {
    intentKey: goalKey, journeyId: opportunityId, status: 'active',
    completedRequirementKeys: [], currentRequirementKey: null,
    slotValues: Object.fromEntries(Object.entries(document.verifiedFacts)
      .filter(([, fact]) => fact.source === 'visitor' || fact.source === 'node')
      .map(([key, fact]) => [key, fact.maskedValue])),
    lifecycle, revision: 0,
  };
  const nextProgress = {
    ...progress, activeIntentKey: goalKey, journeyRevision: progress.journeyRevision + 1,
    visitedIntentKeys: [...new Set([...progress.visitedIntentKeys, goalKey])],
    entries: { ...progress.entries, [goalKey]: entry },
    journeys: { ...(progress.journeys ?? {}), [opportunityId]: entry },
  };
  return {
    state: { ...state, activeFollowUpIntentKey: goalKey, intentProgress: nextProgress },
    document: { ...document, opportunityId, currentStageKey: 'lead_generation', stageRevision: lifecycle.stages.lead_generation.revision },
    created: true,
  };
};

/** Derive a gate context exclusively from persisted Node state, never model text. */
export const contextForConfirmedV2Action = (input: {
  session: Session;
  document: UserIntentDocument;
  catalog: IntentCatalogV2Version;
  expectedActionRevision: number;
  purposeConsentGranted: boolean;
  purposeConsentScope: string | null;
}): V2ActionGateContext | null => {
  const { session, document, catalog } = input;
  if (document.catalogSource !== 'v2' || !document.goalConfirmed
    || document.goalConfirmation?.status !== 'confirmed'
    || !document.businessGoalKey || !document.opportunityId || !document.currentStageKey
    || session.tenantId !== document.tenantId || session.id !== document.sessionId
    || catalog.tenantId !== session.tenantId || catalog.status !== 'published'
    || catalog.catalogVersionRef !== document.catalogVersionRef) return null;
  const entry = session.conversationState?.intentProgress?.entries[document.businessGoalKey];
  if (!entry?.lifecycle || entry.journeyId !== document.opportunityId) return null;
  return {
    tenantId: session.tenantId, sessionId: session.id, opportunityId: document.opportunityId,
    catalogVersionId: document.catalogVersionRef, currentStageKey: document.currentStageKey,
    confirmedGoalKey: document.businessGoalKey, goalConfirmed: true,
    verifiedRequirementKeys: Object.entries(document.verifiedFacts)
      .filter(([, fact]) => fact.maskedValue.trim().length > 0 && fact.evidenceRefs.length > 0)
      .map(([key]) => key),
    expectedActionRevision: input.expectedActionRevision,
    purposeConsentScope: input.purposeConsentScope,
    purposeConsentGranted: input.purposeConsentGranted,
    intentDocument: document, pinnedCatalogVersion: catalog,
    lifecycle: entry.lifecycle,
    expectedStageRevision: document.stageRevision, expectedLifecycleRevision: entry.lifecycle.revision,
  };
};

export const evaluateConfirmedV2ActionStage = (
  input: Parameters<typeof contextForConfirmedV2Action>[0],
): V2StageBoundaryDecision => {
  const context = contextForConfirmedV2Action(input);
  return context ? evaluateV2StageBoundary(context)
    : { accepted: false, reasons: ['v2_authoritative_journey_missing'], currentStageKey: null };
};

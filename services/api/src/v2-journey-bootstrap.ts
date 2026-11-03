import { randomUUID } from 'node:crypto';
import { newIntentProgress } from './conversation-state.js';
import { newLifecycleState } from './lifecycle-state.js';
import { evaluateV2StageBoundary, validateV2ActionConfirmation, v2ActionConsentScope, type V2ActionGateContext, type V2StageBoundaryDecision } from './v2-action-gate.js';
import type { ActionRequest, ConversationState, IntentCatalogV2Version, IntentProgressEntry, Session, Store, UserIntentDocument } from './types.js';

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


export type V2ActionAuthorizationResult = {
  applies: boolean;
  accepted: boolean;
  reasons: string[];
  canonicalCatalogVersionRef: string | null;
};

/**
 * The existing public action-confirm endpoint must not use legacy action
 * authorization when the conversation is using authoritative Catalog V2.
 * No consent may be synthesized from a 'confirmed:true' request or a
 * previously confirmed Business Goal.
 */
export const evaluatePersistedV2ActionConfirmation = async (
  store: Pick<Store, 'getUserIntentDocument' | 'listIntentCatalogV2Versions'>,
  session: Session,
  action: ActionRequest,
): Promise<V2ActionAuthorizationResult> => {
  const doc = await store.getUserIntentDocument(session.tenantId, session.id);
  const versions = await store.listIntentCatalogV2Versions(session.tenantId);
  const knownV2Action = versions.some(version => version.catalogVersionRef === action.catalogVersionId);
  if (doc?.catalogSource !== 'v2' && !knownV2Action) {
    return { applies: false, accepted: false, reasons: [], canonicalCatalogVersionRef: null };
  }
  if (!doc || doc.catalogSource !== 'v2') {
    return { applies: true, accepted: false, reasons: ['v2_intent_document_missing'], canonicalCatalogVersionRef: action.catalogVersionId ?? null };
  }
  const deny = (...reasons: string[]): V2ActionAuthorizationResult => ({
    applies: true, accepted: false, reasons, canonicalCatalogVersionRef: doc.catalogVersionRef,
  });
  if (session.tenantId !== action.tenantId || session.id !== action.sessionId
    || action.opportunityId !== doc.opportunityId || action.catalogVersionId !== doc.catalogVersionRef
    || !action.actionKey || !action.actionRevision) return deny('action_identity_mismatch');
  const pinned = versions.find(version => version.status === 'published'
    && version.catalogVersionRef === doc.catalogVersionRef);
  if (!pinned) return deny('catalog_publication_missing');
  const binding = pinned.catalog.sheets.ToolBindings.find(tool =>
    tool.enabled && tool.toolKey === action.actionKey && tool.registryKey === action.workflowKey
    && tool.goalKey === doc.businessGoalKey && tool.stageKey === doc.currentStageKey
    && tool.sideEffectClass !== 'read_only' && tool.consent === 'purpose_specific'
    && tool.confirmation === 'explicit_customer');
  if (!binding) return deny('action_not_authorized_by_pinned_catalog');
  const purposeScope = v2ActionConsentScope({ catalogVersionId: doc.catalogVersionRef }, action.actionKey);
  const state = session.conversationState;
  const purposeConsentGranted = state?.contactConsent === 'granted'
    && state.consentVersion === purposeScope && action.payload.contactConsent === true;
  const context = contextForConfirmedV2Action({
    session, document: doc, catalog: pinned, expectedActionRevision: action.actionRevision,
    purposeConsentGranted, purposeConsentScope: purposeConsentGranted ? purposeScope : null,
  });
  if (!context) return deny('v2_authoritative_journey_missing');
  const decision = validateV2ActionConfirmation(action, {
    ...context, pendingActionId: action.id, expectedActionKey: binding.toolKey, customerConfirmed: true,
  });
  return {
    applies: true, accepted: decision.accepted, reasons: decision.reasons,
    canonicalCatalogVersionRef: doc.catalogVersionRef,
  };
};

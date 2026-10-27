import { randomUUID } from 'node:crypto';
import type { IntentCatalogVersion, IntentProgressEntry, IntentProgressState } from './types.js';
import { catalogFollowUpRequirements, catalogJourneyRequirements, catalogNextFollowUpRequirement, catalogNextJourneyRequirement, journeyRequirementFulfilled } from './intent-catalog.js';

const MAX_INTENTS = 16;
const MAX_REQUIREMENTS = 64;

export type JourneyDecision = 'collect_requirement' | 'retrieve_knowledge' | 'offer_next_intent' | 'await_external_completion' | 'continue' | 'close_session';

export interface JourneyReducerInput {
  currentIntentKey: string | null;
  selectedIntentKey: string | null;
  transitionApproval?: boolean;
  declinedTransition?: { sourceIntentKey: string; targetIntentKey: string };
  slotValues: Record<string, string>;
  documents?: Array<{ intentKey?: string | null; catalogVersionId?: string | null; requirementKey?: string | null; expectedDocumentType?: string | null; status: string }>;
  knowledgeQuestion?: boolean;
  farewell?: boolean;
  followUp?: boolean;
  completedRequirementKeys?: string[];
}

export interface JourneyReducerResult {
  progress: IntentProgressState;
  decision: JourneyDecision;
  activeIntentKey: string | null;
  nextRequirement: ReturnType<typeof catalogNextJourneyRequirement>;
  offeredIntentKey?: string | null;
  transitionPromptKey?: string | null;
}

const entry = (intentKey: string, status: IntentProgressEntry['status'] = 'active'): IntentProgressEntry => ({ intentKey, journeyId: randomUUID(), status, completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 0 });

const ensureEntry = (progress: IntentProgressState, intentKey: string): IntentProgressEntry => {
  const current = progress.entries[intentKey];
  if (current) return current;
  const created = entry(intentKey);
  progress.entries[intentKey] = created;
  return created;
};

const catalogIntentExists = (version: IntentCatalogVersion, intentKey: string | null): intentKey is string => Boolean(intentKey && version.catalog.intents.some((intent) => intent.intentKey === intentKey && intent.active));

const transitionFor = (version: IntentCatalogVersion, sourceIntentKey: string, targetIntentKey: string) => version.catalog.journeyTransitions?.find((transition) => transition.sourceIntentKey === sourceIntentKey && transition.targetIntentKey === targetIntentKey) ?? null;

const markRequirements = (version: IntentCatalogVersion, progress: IntentProgressState, intentKey: string, input: JourneyReducerInput): IntentProgressEntry => {
  const current = ensureEntry(progress, intentKey);
  const completed = new Set(current.completedRequirementKeys);
  for (const key of input.completedRequirementKeys ?? []) completed.add(key);
  for (const requirement of catalogJourneyRequirements(version, intentKey)) if (journeyRequirementFulfilled(requirement, input.slotValues, completed, input.documents ?? [], version.id)) completed.add(requirement.requirementKey);
  current.completedRequirementKeys = [...completed].slice(0, MAX_REQUIREMENTS);
  current.currentRequirementKey = catalogNextJourneyRequirement(version, intentKey, input.slotValues, current.completedRequirementKeys, input.documents ?? [])?.requirementKey ?? null;
  if (input.followUp && !current.currentRequirementKey) {
    for (const requirement of catalogFollowUpRequirements(version, intentKey)) if (journeyRequirementFulfilled(requirement, input.slotValues, completed, input.documents ?? [], version.id)) completed.add(requirement.requirementKey);
    current.completedRequirementKeys = [...completed].slice(0, MAX_REQUIREMENTS);
    current.currentRequirementKey = catalogNextFollowUpRequirement(version, intentKey, input.slotValues, current.completedRequirementKeys, input.documents ?? [])?.requirementKey ?? null;
  }
  current.status = current.currentRequirementKey ? 'active' : 'fulfilled';
  current.revision += 1;
  return current;
};

export const reduceIntentJourney = (version: IntentCatalogVersion, previous: IntentProgressState | undefined, input: JourneyReducerInput): JourneyReducerResult => {
  const progress: IntentProgressState = previous?.version === 1
    ? { ...previous, pausedIntentKeys: [...previous.pausedIntentKeys], fulfilledIntentKeys: [...previous.fulfilledIntentKeys], visitedIntentKeys: [...previous.visitedIntentKeys], entries: Object.fromEntries(Object.entries(previous.entries).map(([key, value]) => [key, { ...value, journeyId: value.journeyId ?? randomUUID(), completedRequirementKeys: [...value.completedRequirementKeys], slotValues: { ...(value.slotValues ?? {}) }, slotProvenance: { ...(value.slotProvenance ?? {}) } }])) }
    : { version: 1, activeIntentKey: null, pausedIntentKeys: [], fulfilledIntentKeys: [], entries: {}, visitedIntentKeys: [], lastTransitionReason: null, journeyRevision: 0 };
  if (input.farewell) return { progress: { ...progress, activeIntentKey: null, lastTransitionReason: 'farewell', journeyRevision: progress.journeyRevision + 1 }, decision: 'close_session', activeIntentKey: null, nextRequirement: null };
  const currentIntentKey = catalogIntentExists(version, input.currentIntentKey) ? input.currentIntentKey : null;
  const selectedIntentKey = catalogIntentExists(version, input.selectedIntentKey) ? input.selectedIntentKey : null;
  const requestedIntentKey = selectedIntentKey ?? currentIntentKey;
  const requestedIntent = requestedIntentKey;
  const existingActiveIntentKey = progress.activeIntentKey && catalogIntentExists(version, progress.activeIntentKey) ? progress.activeIntentKey : null;
  if (input.declinedTransition && catalogIntentExists(version, input.declinedTransition.sourceIntentKey) && catalogIntentExists(version, input.declinedTransition.targetIntentKey)) {
    const activeIntent = input.declinedTransition.sourceIntentKey;
    const activeEntry = markRequirements(version, progress, activeIntent, input);
    progress.activeIntentKey = activeIntent;
    progress.visitedIntentKeys = [...new Set([...progress.visitedIntentKeys, activeIntent])].slice(-MAX_INTENTS);
    progress.lastDeclinedTransition = { ...input.declinedTransition, catalogVersionId: version.id };
    progress.lastTransitionReason = 'declined_transition';
    progress.journeyRevision += 1;
    const nextRequirement = catalogNextJourneyRequirement(version, activeIntent, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? [])
      ?? (input.followUp ? catalogNextFollowUpRequirement(version, activeIntent, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? []) : null);
    return { progress, decision: nextRequirement ? (nextRequirement.fulfillmentMode === 'external_confirmation_required' && nextRequirement.requirementType === 'document' ? 'await_external_completion' : 'collect_requirement') : 'continue', activeIntentKey: activeIntent, nextRequirement };
  }
  const candidateTransition = existingActiveIntentKey && requestedIntentKey && requestedIntentKey !== existingActiveIntentKey
    ? transitionFor(version, existingActiveIntentKey, requestedIntentKey)
    : null;
  if (candidateTransition && requestedIntent !== null && existingActiveIntentKey !== null && !input.transitionApproval) {
    const activeIntent = existingActiveIntentKey;
    const activeEntry = markRequirements(version, progress, activeIntent, input);
    progress.activeIntentKey = activeIntent;
    progress.visitedIntentKeys = [...new Set([...progress.visitedIntentKeys, activeIntent])].slice(-MAX_INTENTS);
    const activeRequirement = catalogNextJourneyRequirement(version, activeIntent, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? [])
      ?? (input.followUp ? catalogNextFollowUpRequirement(version, activeIntent, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? []) : null);
    if (activeRequirement) {
      activeEntry.currentRequirementKey = activeRequirement.requirementKey;
      progress.lastTransitionReason = 'requirement_pending';
      progress.journeyRevision += 1;
      return { progress, decision: activeRequirement.fulfillmentMode === 'external_confirmation_required' && activeRequirement.requirementType === 'document' ? 'await_external_completion' : 'collect_requirement', activeIntentKey: activeIntent, nextRequirement: activeRequirement };
    }
    if (candidateTransition.activationMode === 'offer' && !progress.visitedIntentKeys.includes(requestedIntent) && progress.visitedIntentKeys.length < candidateTransition.maxDepth) {
      activeEntry.status = 'fulfilled';
      progress.lastTransitionReason = 'offer_related_intent';
      progress.journeyRevision += 1;
      return { progress, decision: 'offer_next_intent', activeIntentKey: activeIntent, nextRequirement: null, offeredIntentKey: requestedIntent, transitionPromptKey: candidateTransition.promptKey };
    }
  }
  const activeIntentKey = input.transitionApproval && requestedIntentKey
    ? requestedIntentKey
    : candidateTransition
      ? existingActiveIntentKey ?? requestedIntentKey
      : selectedIntentKey && selectedIntentKey !== existingActiveIntentKey
        ? selectedIntentKey
        : existingActiveIntentKey ?? requestedIntentKey;
  if (!activeIntentKey) return { progress, decision: input.knowledgeQuestion ? 'retrieve_knowledge' : 'continue', activeIntentKey: null, nextRequirement: null };
  const activeEntry = markRequirements(version, progress, activeIntentKey, input);
  progress.activeIntentKey = activeIntentKey;
  progress.visitedIntentKeys = [...new Set([...progress.visitedIntentKeys, activeIntentKey])].slice(-MAX_INTENTS);
  if (input.knowledgeQuestion) {
    activeEntry.status = activeEntry.currentRequirementKey ? 'active' : 'fulfilled';
    progress.lastTransitionReason = 'knowledge_question';
    progress.journeyRevision += 1;
    return { progress, decision: 'retrieve_knowledge', activeIntentKey, nextRequirement: null };
  }
  const nextRequirement = catalogNextJourneyRequirement(version, activeIntentKey, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? [])
    ?? (input.followUp ? catalogNextFollowUpRequirement(version, activeIntentKey, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? []) : null);
  if (nextRequirement) {
    activeEntry.currentRequirementKey = nextRequirement.requirementKey;
    progress.lastTransitionReason = 'requirement_pending';
    progress.journeyRevision += 1;
    return { progress, decision: nextRequirement.fulfillmentMode === 'external_confirmation_required' && nextRequirement.requirementType === 'document' ? 'await_external_completion' : 'collect_requirement', activeIntentKey, nextRequirement };
  }
  activeEntry.status = 'fulfilled';
  progress.fulfilledIntentKeys = [...new Set([...progress.fulfilledIntentKeys, activeIntentKey])].slice(-MAX_INTENTS);
  if (currentIntentKey && currentIntentKey !== activeIntentKey && !progress.fulfilledIntentKeys.includes(currentIntentKey)) {
    const transition = transitionFor(version, activeIntentKey, currentIntentKey);
    if (transition?.activationMode === 'automatic' && !progress.visitedIntentKeys.includes(currentIntentKey) && progress.visitedIntentKeys.length < transition.maxDepth) {
      activeEntry.status = 'paused';
      progress.pausedIntentKeys = [...new Set([...progress.pausedIntentKeys, activeIntentKey])].slice(-MAX_INTENTS);
      progress.activeIntentKey = currentIntentKey;
      const next = markRequirements(version, progress, currentIntentKey, input);
      progress.lastTransitionReason = 'automatic_transition';
      progress.journeyRevision += 1;
      return { progress, decision: next.currentRequirementKey ? 'collect_requirement' : 'continue', activeIntentKey: currentIntentKey, nextRequirement: next.currentRequirementKey ? catalogNextJourneyRequirement(version, currentIntentKey, input.slotValues, next.completedRequirementKeys, input.documents ?? []) : null };
    }
    if (transition?.activationMode === 'offer') {
      progress.lastTransitionReason = 'offer_related_intent';
      progress.journeyRevision += 1;
      return { progress, decision: 'offer_next_intent', activeIntentKey, nextRequirement: null, offeredIntentKey: currentIntentKey, transitionPromptKey: transition.promptKey };
    }
  }
  progress.lastTransitionReason = 'intent_fulfilled';
  progress.journeyRevision += 1;
  return { progress, decision: 'continue', activeIntentKey, nextRequirement: null };
};

import type { IntentCatalogVersion, IntentProgressEntry, IntentProgressState } from './types.js';
import { catalogJourneyRequirements, catalogNextJourneyRequirement, journeyRequirementFulfilled } from './intent-catalog.js';

const MAX_INTENTS = 16;
const MAX_REQUIREMENTS = 64;

export type JourneyDecision = 'collect_requirement' | 'retrieve_knowledge' | 'offer_next_intent' | 'await_external_completion' | 'continue' | 'close_session';

export interface JourneyReducerInput {
  currentIntentKey: string | null;
  selectedIntentKey: string | null;
  slotValues: Record<string, string>;
  documents?: Array<{ requirementKey?: string | null; expectedDocumentType?: string | null; status: string }>;
  knowledgeQuestion?: boolean;
  farewell?: boolean;
  completedRequirementKeys?: string[];
}

export interface JourneyReducerResult {
  progress: IntentProgressState;
  decision: JourneyDecision;
  activeIntentKey: string | null;
  nextRequirement: ReturnType<typeof catalogNextJourneyRequirement>;
}

const entry = (intentKey: string, status: IntentProgressEntry['status'] = 'active'): IntentProgressEntry => ({ intentKey, status, completedRequirementKeys: [], currentRequirementKey: null, revision: 0 });

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
  for (const requirement of catalogJourneyRequirements(version, intentKey)) if (journeyRequirementFulfilled(requirement, input.slotValues, completed, input.documents ?? [])) completed.add(requirement.requirementKey);
  current.completedRequirementKeys = [...completed].slice(0, MAX_REQUIREMENTS);
  current.currentRequirementKey = catalogNextJourneyRequirement(version, intentKey, input.slotValues, current.completedRequirementKeys, input.documents ?? [])?.requirementKey ?? null;
  current.status = current.currentRequirementKey ? 'active' : 'fulfilled';
  current.revision += 1;
  return current;
};

export const reduceIntentJourney = (version: IntentCatalogVersion, previous: IntentProgressState | undefined, input: JourneyReducerInput): JourneyReducerResult => {
  const progress: IntentProgressState = previous?.version === 1
    ? { ...previous, pausedIntentKeys: [...previous.pausedIntentKeys], fulfilledIntentKeys: [...previous.fulfilledIntentKeys], visitedIntentKeys: [...previous.visitedIntentKeys], entries: Object.fromEntries(Object.entries(previous.entries).map(([key, value]) => [key, { ...value, completedRequirementKeys: [...value.completedRequirementKeys] }])) }
    : { version: 1, activeIntentKey: null, pausedIntentKeys: [], fulfilledIntentKeys: [], entries: {}, visitedIntentKeys: [], lastTransitionReason: null, journeyRevision: 0 };
  if (input.farewell) return { progress: { ...progress, activeIntentKey: null, lastTransitionReason: 'farewell', journeyRevision: progress.journeyRevision + 1 }, decision: 'close_session', activeIntentKey: null, nextRequirement: null };
  const currentIntentKey = catalogIntentExists(version, input.currentIntentKey) ? input.currentIntentKey : null;
  const selectedIntentKey = catalogIntentExists(version, input.selectedIntentKey) ? input.selectedIntentKey : null;
  const activeIntentKey = progress.activeIntentKey && catalogIntentExists(version, progress.activeIntentKey) ? progress.activeIntentKey : selectedIntentKey ?? currentIntentKey;
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
  const nextRequirement = catalogNextJourneyRequirement(version, activeIntentKey, input.slotValues, activeEntry.completedRequirementKeys, input.documents ?? []);
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
      return { progress, decision: 'offer_next_intent', activeIntentKey, nextRequirement: null };
    }
  }
  progress.lastTransitionReason = 'intent_fulfilled';
  progress.journeyRevision += 1;
  return { progress, decision: 'continue', activeIntentKey, nextRequirement: null };
};

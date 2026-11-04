import type { CatalogV2Document } from './catalog-v2.js';

/**
 * Deterministic customer-evidence resolver. Model-proposed signal IDs do not
 * contribute to scoring until Node independently observes a published signal.
 * Prior assistant messages and raw model interpretations are never evidence.
 */
export interface V2CustomerIntentTurn {
  messageId: string;
  text: string;
}

export interface V2ObservedIntentSignal {
  signalId: string;
  goalKey: string;
  sourceMessageId: string;
  source: 'current_turn' | 'prior_customer_turn';
  catalogVersionRef: string;
}

export interface V2ObservedIntentContext {
  observedSignals: V2ObservedIntentSignal[];
  currentSignalIds: string[];
  contextSignalIds: string[];
  candidateGoalKeys: string[];
  contextAnchorMessageId: string | null;
  contextSupported: boolean;
  initiation: 'explicit' | 'information' | 'ambiguous' | 'none';
  initiationSupported: boolean;
  ambiguous: boolean;
}

export interface V2IntentEvidenceRequest {
  catalog: CatalogV2Document;
  catalogVersionRef: string;
  currentMessage: string;
  currentMessageId: string;
  recentCustomerTurns: V2CustomerIntentTurn[];
  confirmedGoalKey?: string | null;
}

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase('en-US')
  .replace(/[’']/gu, "'").replace(/[-_]/gu, ' ').replace(/[^\p{L}\p{N}'\s]/gu, ' ')
  .replace(/\s+/gu, ' ').trim();

const containsPhrase = (text: string, phrase: string): boolean =>
  Boolean(phrase && (' ' + text + ' ').includes(' ' + phrase + ' '));

const hasInformationRequest = (message: string): boolean =>
  /^(?:(?:so|then|and|okay|ok|please)\s+)*(?:how|what|why|when|where|which|who|can you (?:explain|tell|show)|could you (?:explain|tell|show)|tell me|show me|explain|i (?:want|would like|need) (?:to )?(?:know|learn|understand|explore|compare)|i(?:'m| am) (?:just )?(?:exploring|looking|browsing))/u.test(message)
  || /\b(?:just (?:information|exploring|looking)|only (?:information|researching)|not (?:ready|yet)|before i decide)\b/u.test(message);

const hasRejection = (message: string): boolean =>
  /\b(?:don't|do not|not going to|no longer|changed my mind|cancel|stop|never mind|not interested|not ready|not yet|only (?:want|need) information)\b/u.test(message);

/** Do not let an unrelated negative preference erase a positive goal request.
 * Contrasting clauses have separate polarity; conservatively treat global
 * cancellations as a stop rather than an implicit new authorization. */
const contrastClauses = (message: string): string[] =>
  message.split(/\s*(?:[,;.]\s*)?\b(?:but|however|although|instead)\b\s*/u).map(part => part.trim()).filter(Boolean);
const globalCancellation = (message: string): boolean =>
  /^(?:no[.!]?|never mind[.!]?|stop[.!]?|cancel[.!]?|i changed my mind[.!]?|i'?m not interested[.!]?)$/u.test(message.trim());
const activeClauses = (message: string): string[] =>
  contrastClauses(message).filter(part => !hasRejection(part));
const hasInitiationRequest = (message: string): boolean =>
  /(?:^|\b)(?:i (?:want|would like|need|am ready|m ready) to|let's|let us|please|go ahead and|we (?:want|need) to|i(?:'m| am) ready to)\s+(?:go ahead (?:and |to )?|now )?(?:start|begin|register|form|incorporate|set up|open|establish|proceed(?: with)?|get started(?: with)?)\b/u.test(message)
  || /^(?:start|begin|register|form|incorporate|set up|open|establish|proceed|let's go ahead|let us go ahead)\b/u.test(message);

const isContextReference = (message: string): boolean =>
  /\b(?:the process|this process|that process|the setup|this setup|it|this|that|go ahead|proceed|get started|start|begin)\b/u.test(message);

const goalForTarget = (catalog: CatalogV2Document, target: string): string | null => {
  const goal = catalog.sheets.BusinessGoals.find(g => g.active && g.businessGoalKey === target);
  if (goal) return goal.businessGoalKey;
  const intent = catalog.sheets.TurnIntents.find(t => t.active && t.turnIntentKey === target);
  return intent?.businessGoalKey && catalog.sheets.BusinessGoals.some(g => g.active && g.businessGoalKey === intent.businessGoalKey)
    ? intent.businessGoalKey : null;
};

const observed = (catalog: CatalogV2Document, text: string): Array<{ signalId: string; goalKey: string }> => {
  const normalized = normalize(text);
  return catalog.sheets.IntentSignals.flatMap(signal => {
    if (signal.signalType === 'exclusion') return [];
    const goalKey = goalForTarget(catalog, signal.targetKey);
    if (!goalKey) return [];
    const alternatives = [signal.value, ...(signal.aliases ?? [])];
    return alternatives.some(alias => containsPhrase(normalized, normalize(alias)))
      ? [{ signalId: signal.signalId, goalKey }] : [];
  });
};

export const resolveV2IntentEvidence = (request: V2IntentEvidenceRequest): V2ObservedIntentContext => {
  const normalizedCurrent = normalize(request.currentMessage);
  const clauses = contrastClauses(normalizedCurrent);
  const positives = activeClauses(normalizedCurrent);
  const cancelled = globalCancellation(normalizedCurrent);
  const negativeGoalKeys = new Set(clauses.filter(hasRejection)
    .flatMap(part => observed(request.catalog, part).map(signal => signal.goalKey)));
  const explicit = !cancelled && positives.some(hasInitiationRequest);
  const information = !explicit && hasInformationRequest(normalizedCurrent);
  const rejected = cancelled || (positives.length === 0 && clauses.some(hasRejection));
  const initiation: V2ObservedIntentContext['initiation'] = rejected ? 'none'
    : information ? 'information' : explicit ? 'explicit'
    : isContextReference(normalizedCurrent) ? 'ambiguous' : 'none';

  // Only affirmatively expressed catalog signals contribute. A negated visa
  // preference never blocks an independently affirmative formation request.
  const currentSignals = cancelled ? [] : positives.flatMap(part => observed(request.catalog, part))
    .filter(signal => !negativeGoalKeys.has(signal.goalKey));
  const currentGoalKeys = [...new Set(currentSignals.map(signal => signal.goalKey))];
  const hasConflictingCurrentGoals = currentGoalKeys.length > 1;

  const current: V2ObservedIntentSignal[] = currentSignals.map(signal => ({
    ...signal, sourceMessageId: request.currentMessageId, source: 'current_turn',
    catalogVersionRef: request.catalogVersionRef,
  }));

  // Context can ground a *new explicit initiation*, never a knowledge question
  // or a bare "yes". A negation in the customer history invalidates old anchors.
  let anchorMessageId: string | null = null;
  let context: V2ObservedIntentSignal[] = [];
  let ambiguous = hasConflictingCurrentGoals;
  if (explicit && !hasConflictingCurrentGoals && currentGoalKeys.length === 0
      && isContextReference(normalizedCurrent)) {
    const previous = request.recentCustomerTurns.slice(-8).reverse();
    const recent: V2ObservedIntentSignal[] = [];
    const goals = new Set<string>();
    for (const turn of previous) {
      const normalized = normalize(turn.text);
      if (globalCancellation(normalized) || hasRejection(normalized)
        && activeClauses(normalized).length === 0) break;
      for (const signal of activeClauses(normalized).flatMap(part => observed(request.catalog, part))) {
        goals.add(signal.goalKey);
        recent.push({ ...signal, sourceMessageId: turn.messageId, source: 'prior_customer_turn',
          catalogVersionRef: request.catalogVersionRef });
      }
    }
    if (goals.size === 1 && recent.length > 0) {
      anchorMessageId = recent[0]!.sourceMessageId;
      context = recent.filter(signal => signal.sourceMessageId === anchorMessageId);
    } else if (goals.size > 1) ambiguous = true;
  }

  const all = [...current, ...context];
  const candidateGoalKeys = [...new Set(all.map(signal => signal.goalKey))];
  const contextSupported = context.length > 0;
  const initiationSupported = explicit && !ambiguous && candidateGoalKeys.length === 1
    && candidateGoalKeys[0] === (request.confirmedGoalKey ?? candidateGoalKeys[0]);

  return {
    observedSignals: all, currentSignalIds: current.map(signal => signal.signalId),
    contextSignalIds: context.map(signal => signal.signalId), candidateGoalKeys,
    contextAnchorMessageId: anchorMessageId, contextSupported, initiation,
    initiationSupported, ambiguous,
  };
};

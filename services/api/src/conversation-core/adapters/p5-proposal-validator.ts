import type { CatalogV2Document } from '../../conversation/catalog.js';
import type {
  CandidateActionProposal, ModelCandidate, ProposalValidator, SessionSnapshot, TrustedActor, VerifiedFact,
} from '../contracts.js';
import { P5PinnedCatalogReader } from './p5-catalog.js';

/** Must be loaded by Node from authenticated tenant/session records, never from GPT. */
export interface P5TrustedActionState {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly catalogVersionId: string;
  readonly goalKey: string;
  readonly stageKey: string;
  readonly confirmedGoal: boolean;
  readonly customerAuthorized: boolean;
  readonly consentGranted: boolean;
  readonly consentScope: string | null;
  readonly verifiedRequirementKeys: readonly string[];
  readonly verifiedArguments: Readonly<Record<string, string>>;
}

export interface P5ActionStateReader {
  load(actor: TrustedActor, snapshot: SessionSnapshot): Promise<P5TrustedActionState | null>;
}

export class P5ProposalError extends Error {
  constructor(readonly reason: string) {
    super('Unverifiable model fact proposal');
    this.name = 'P5ProposalError';
  }
}

const safeField = /^[a-z][a-z0-9._-]{1,79}$/u;
const forbidden = /(?:^|[._-])(?:password|secret|token|otp|cvv|pan)(?:$|[._-])/iu;
const rawContact = /(?:[^\s@]+@[^\s@]+\.[^\s@]+|\b\d{12,19}\b|\+\d[\d ()-]{7,}\d)/u;

/** An exact bounded customer-span check, not a word-overlap rule for GPT responses. */
function directCustomerSpan(message: string, proposed: string): boolean {
  const source = message.normalize('NFKC').toLocaleLowerCase('en-US');
  const value = proposed.normalize('NFKC').toLocaleLowerCase('en-US').trim();
  if (!value || value.length > 4000) return false;
  let from = 0;
  while (from < source.length) {
    const position = source.indexOf(value, from);
    if (position < 0) return false;
    const before = source[position - 1] ?? ' ';
    const after = source[position + value.length] ?? ' ';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return true;
    from = position + 1;
  }
  return false;
}

function authoritativeFactRequirements(catalog: CatalogV2Document, goalKey: string): Set<string> {
  return new Set(catalog.sheets.RequirementPolicies.filter(row => row.goalKey === goalKey
    && row.type === 'fact' && row.sourceOfTruth === 'customer').map(row => row.requirementKey));
}

/**
 * P5 never promotes assistant guesses, model confidence or keyword matches to
 * verified facts. The current masked customer message must contain every value.
 */
export class P5ProposalValidator implements ProposalValidator {
  constructor(
    private readonly reader: P5PinnedCatalogReader,
    private readonly actions?: P5ActionStateReader,
  ) {}

  async validateFacts(actor: TrustedActor, candidate: ModelCandidate, snapshot: SessionSnapshot,
    maskedCustomerMessage?: string, clientMessageId?: string): Promise<readonly VerifiedFact[]> {
    if (candidate.proposedFacts.length === 0) return [];
    if (!maskedCustomerMessage || !clientMessageId || candidate.goalCandidateKeys.length !== 1) {
      throw new P5ProposalError('unbound_customer_fact');
    }
    const catalog = await this.reader.load(actor, snapshot);
    const goalKey = candidate.goalCandidateKeys[0]!;
    if (!catalog.sheets.BusinessGoals.some(row => row.active && row.businessGoalKey === goalKey)) {
      throw new P5ProposalError('unpublished_goal');
    }
    const allowed = authoritativeFactRequirements(catalog, goalKey);
    const seen = new Set<string>();
    const facts: VerifiedFact[] = [];
    for (const fact of candidate.proposedFacts) {
      if (!safeField.test(fact.key) || forbidden.test(fact.key) || !allowed.has(fact.key)
        || fact.supportingTurnId !== clientMessageId || seen.has(fact.key)
        || rawContact.test(fact.value) || !directCustomerSpan(maskedCustomerMessage, fact.value)) {
        throw new P5ProposalError('unsupported_fact');
      }
      seen.add(fact.key);
      facts.push({
        key: fact.key, value: fact.value, source: 'customer',
        sourceReference: `customer-turn:${clientMessageId}`, revision: snapshot.revision + 1,
      });
    }
    return facts;
  }

  async validateActionProposal(actor: TrustedActor, candidate: ModelCandidate, snapshot: SessionSnapshot): Promise<CandidateActionProposal | null> {
    const proposed = candidate.actionProposal;
    if (!proposed) return null;
    if (!this.actions || candidate.goalCandidateKeys.length !== 1
      || Object.keys(proposed.input).length !== 0 || !safeField.test(proposed.actionKey)) return null;
    const catalog = await this.reader.load(actor, snapshot);
    const state = await this.actions.load(actor, snapshot);
    if (!state || state.tenantId !== actor.tenantId || state.sessionId !== actor.sessionId
      || state.catalogVersionId !== snapshot.catalogVersionId
      || state.goalKey !== candidate.goalCandidateKeys[0]
      || !state.confirmedGoal || !state.customerAuthorized || !state.consentGranted
      || state.consentScope !== `${snapshot.catalogVersionId}:${proposed.actionKey}`) return null;
    const binding = catalog.sheets.ToolBindings.find(row => row.toolKey === proposed.actionKey
      && row.goalKey === state.goalKey && row.stageKey === state.stageKey
      && row.enabled && row.sideEffectClass !== 'read_only'
      && row.consent === 'purpose_specific' && row.confirmation === 'explicit_customer'
      && row.registryKey !== null);
    if (!binding || !catalog.sheets.BusinessGoals.some(row => row.active && row.businessGoalKey === state.goalKey)) return null;
    if (!catalog.sheets.BusinessStages.some(row => row.active && row.stageKey === state.stageKey
      && row.businessGoalKey === state.goalKey)) return null;
    if (!catalog.sheets.WorkflowBindings.some(row => row.registryKey === binding.registryKey && row.enabled)) return null;
    const validated = new Set(state.verifiedRequirementKeys);
    const requirements = catalog.sheets.RequirementPolicies.filter(row =>
      row.goalKey === state.goalKey && row.stageKey === state.stageKey);
    const byKey = new Map(requirements.map(row => [row.requirementKey, row]));
    const entry = catalog.sheets.BusinessStages.find(row => row.businessGoalKey === state.goalKey && row.stageKey === state.stageKey);
    const required = [...binding.requiredKeys, ...(entry?.entryRequirements ?? [])];
    for (const key of required) {
      const policy = byKey.get(key);
      if (!policy) return null;
      // Confirmation and consent are independently checked above.
      if ((policy.type !== 'consent' && policy.type !== 'confirmation') && !validated.has(key)) return null;
      if (policy.dependencies.some(dependency => !validated.has(dependency))) return null;
      if (policy.type === 'fact') {
        const value = state.verifiedArguments[key];
        const stored = snapshot.verifiedFacts.find(fact => fact.key === key && fact.value === value
          && fact.source === 'customer' && fact.revision <= snapshot.revision);
        if (!value || !stored) return null;
      }
    }
    // This returns a proposed action for persistence only. It does not create
    // an action_request, outbox entry, provider job or verified completion.
    return { ...proposed, input: {} };
  }
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateV2PlanningProposal } from './v2-planning.js';
import type { CatalogV2Document } from './catalog-v2.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;
const context = { confirmedGoalKey: null, currentStageKey: 'lead_qualification', verifiedRequirementKeys: [], goalConfirmed: true, allowedToolKeys: ['knowledge.search', 'journey.read_state'] };
const base = {
  turnCategory: 'business_goal', primaryGoalKey: 'anc.company_formation', candidateGoalKeys: ['anc.company_formation'], matchedSignalIds: ['signal.company.register'], supportingTopicKeys: [], runnerUpScore: 20,
  nextMove: 'collect_requirement', nextQuestion: 'What business activity are you planning?', proposedToolKey: null, confidenceBand: 'high',
};

describe('v2 bounded intent and stage planning', () => {
  it('accepts catalog members and keeps scoring, stage coverage and next requirement separate', () => {
    const decision = validateV2PlanningProposal(base, catalog, context);
    expect(decision.accepted).toBe(true);
    expect(decision.score).toMatchObject({ evidenceScore: 80, thresholdMet: true, actionReadiness: { eligible: false } });
    expect(decision.currentStage?.missingEntryRequirements).toEqual(['business_activity', 'entity_type', 'visa_count', 'timeline']);
    expect(decision.nextRequirementKey).toBe('business_activity');
  });

  it('requires clarification for an ambiguous goal and does not advance requirements', () => {
    const decision = validateV2PlanningProposal({ ...base, runnerUpScore: 75 }, catalog, context);
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('ambiguous_goal');
    expect(decision.nextRequirementKey).toBeNull();
  });

  it('preserves the confirmed company goal during a knowledge detour', () => {
    const decision = validateV2PlanningProposal({ ...base, turnCategory: 'knowledge_advisory', primaryGoalKey: null, candidateGoalKeys: [], matchedSignalIds: ['signal.setup.options'], runnerUpScore: null, nextMove: 'answer_knowledge', nextQuestion: null, proposedToolKey: 'knowledge.search' }, catalog, { ...context, confirmedGoalKey: 'anc.company_formation', goalConfirmed: true });
    expect(decision.accepted).toBe(true);
    expect(decision.primaryGoalKey).toBe('anc.company_formation');
    expect(decision.preservedConfirmedGoal).toBe(true);
    expect(decision.proposedToolKey).toBe('knowledge.search');
  });

  it('rejects unknown catalog members and disabled tools without authorizing writes', () => {
    const unknown = validateV2PlanningProposal({ ...base, candidateGoalKeys: ['anc.unknown'] }, catalog, context);
    expect(unknown.accepted).toBe(false);
    expect(unknown.reasons).toContain('unknown_goal_candidate');
    const disabled = validateV2PlanningProposal({ ...base, proposedToolKey: 'account.propose_creation', nextMove: 'propose_action' }, catalog, { ...context, allowedToolKeys: ['account.propose_creation'] });
    expect(disabled.accepted).toBe(false);
    expect(disabled.proposedToolKey).toBeNull();
    expect(disabled.reasons).toContain('tool_not_allowed');
  });
});


describe('catalog-scoped optional topic validation', () => {
  it('drops an unknown or goal-unrelated optional topic without discarding valid goal evidence', () => {
    const decision = validateV2PlanningProposal({
      ...base, supportingTopicKeys: ['knowledge.unknown', 'knowledge.company_setup'],
    }, catalog, { ...context, observedText: 'I want to register a company.' });
    expect(decision.accepted).toBe(true);
    expect(decision.validatedTopicKeys).toEqual(['knowledge.company_setup']);
    expect(decision.rejectedTopicKeys).toEqual(['knowledge.unknown']);
    expect(decision.reasons).toContain('unknown_or_unrelated_topic');
    expect(decision.score?.thresholdMet).toBe(true);
    expect(decision.score?.actionReadiness.eligible).toBe(false);
  });

  it('does not let a topic error suppress unrelated signal or tool rejection', () => {
    const decision = validateV2PlanningProposal({ ...base,
      supportingTopicKeys: ['knowledge.unknown'], matchedSignalIds: ['signal.company.register'],
    }, catalog, { ...context, observedText: 'hello' });
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('unobserved_signal');
    expect(decision.rejectedTopicKeys).toEqual(['knowledge.unknown']);
  });
});

describe('authoritative customer-evidence validation', () => {
  it('scores reviewed aliases from Node evidence regardless of missing model signals', () => {
    const input = { ...base, matchedSignalIds: [], runnerUpScore: 80, nextMove: 'confirm_goal' };
    const result = validateV2PlanningProposal(input, catalog, {
      ...context, observedText: 'I want to form a company',
      serverObservedSignalIds: ['signal.company.register'], serverRunnerUpScore: 0,
    });
    expect(result.accepted).toBe(true);
    expect(result.score).toMatchObject({ evidenceScore: 80, ambiguous: false, thresholdMet: true });
    expect(result.validatedSignalIds).toEqual(['signal.company.register']);
  });

  it('does not allow fabricated model signals to increase authoritative goal score', () => {
    const result = validateV2PlanningProposal({ ...base, matchedSignalIds: ['signal.company.register', 'signal.fake'] }, catalog, {
      ...context, observedText: 'Hello', serverObservedSignalIds: [], serverRunnerUpScore: 0,
    });
    expect(result.score?.evidenceScore).toBe(0);
    expect(result.score?.thresholdMet).toBe(false);
    expect(result.rejectedSignalIds).toContain('signal.fake');
    expect(result.reasons).toContain('unobserved_signal');
  });

  it('accepts navigation without a Business Goal or implicit consent', () => {
    const result = validateV2PlanningProposal({
      ...base, primaryGoalKey: null, candidateGoalKeys: [], turnCategory: 'conversation_navigation',
      nextMove: 'ask_more_help', matchedSignalIds: [], runnerUpScore: null, supportingTopicKeys: [],
    }, catalog, { ...context, observedText: 'Hello', serverObservedSignalIds: [], serverRunnerUpScore: 0 });
    expect(result.accepted).toBe(true);
    expect(result.primaryGoalKey).toBeNull();
    expect(result.score).toBeNull();
    expect(result.proposedToolKey).toBeNull();
  });
});

describe('server-observed evidence gates for model planning', () => {
  it('accepts a genuinely observed signal without authorizing any side effect', () => {
    const decision = validateV2PlanningProposal(base, catalog, { ...context, observedText: 'I want to register a company for consulting.' });
    expect(decision.accepted).toBe(true);
    expect(decision.score?.evidenceScore).toBe(80);
    expect(decision.score?.actionReadiness.eligible).toBe(false);
  });
  it('rejects invented signal matches regardless of model confidence', () => {
    const decision = validateV2PlanningProposal(base, catalog, { ...context, observedText: 'Hello' });
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('unobserved_signal');
  });
});

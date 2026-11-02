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

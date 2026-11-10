import { describe, expect, it } from 'vitest';
import { authorizedPendingRequirement, type V2RequirementDecisionInput } from './conversation-decision.js';

const base: V2RequirementDecisionInput = {
  catalogSource: 'v2', goalConfirmed: false, businessGoalKey: 'anc.company_formation',
  currentStageKey: null, selectedRequirementKey: 'business_activity',
  priorRequirementKey: 'entity_type', goalDecision: null,
};

describe('V2 requirements never precede customer goal confirmation', () => {
  it('leaves information-only and candidate-goal turns without pending requirements', () => {
    expect(authorizedPendingRequirement(base)).toBeNull();
    expect(authorizedPendingRequirement({ ...base, businessGoalKey: null })).toBeNull();
  });
  it('does not bring a stale requirement into the initial confirmation turn', () => {
    expect(authorizedPendingRequirement({ ...base, goalDecision: 'confirmed' })).toBeNull();
  });
  it('allows requirements only after confirmed, stage-bound journey initialization', () => {
    expect(authorizedPendingRequirement({
      ...base, goalConfirmed: true, currentStageKey: 'lead_generation',
    })).toBe('business_activity');
  });
  it.each(['rejected', 'corrected'] as const)('clears pending requirements when goal is %s', decision => {
    expect(authorizedPendingRequirement({ ...base, goalConfirmed: true,
      currentStageKey: 'lead_generation', goalDecision: decision,
    })).toBeNull();
  });
  it('does not remove legacy requirements from legacy sessions', () => {
    expect(authorizedPendingRequirement({ ...base, catalogSource: 'legacy_v1' })).toBe('business_activity');
  });
});

import { describe, expect, it } from 'vitest';
import { completeLifecycleStage, newLifecycleState } from './lifecycle-state.js';

describe('ANCFZ lifecycle state', () => {
  it('advances only one stage at a time and retains evidence', () => {
    const state = completeLifecycleStage(newLifecycleState(), 'lead_generation', { consent: true, leadId: 'local-lead' });
    expect(state.currentStage).toBe('lead_qualification');
    expect(state.stages.lead_generation.evidence).toEqual({ consent: true, leadId: 'local-lead' });
    expect(() => completeLifecycleStage(state, 'package_selection', { quoteId: 'quote' })).toThrowError(/active lifecycle stage/);
  });

  it('rejects an empty or out-of-order completion', () => {
    expect(() => completeLifecycleStage(newLifecycleState(), 'lead_generation', {})).toThrowError(/evidence is required/);
    expect(() => completeLifecycleStage(newLifecycleState(), 'account_creation', { accountId: 'account' })).toThrowError(/active lifecycle stage/);
  });
});

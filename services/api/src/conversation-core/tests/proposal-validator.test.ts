import { describe, expect, it } from 'vitest';
import { ReadOnlyP2ProposalValidator } from '../adapters/proposal-validator.js';
import type { ModelCandidate, SessionSnapshot, TrustedActor } from '../contracts.js';

const actor: TrustedActor = { tenantId: 't', sessionId: 's', principalId: 'p', role: 'customer' };
const snapshot = {} as SessionSnapshot;
const base: ModelCandidate = { message: 'Hi', evidenceRefs: [], goalCandidateKeys: [], proposedFacts: [], actionProposal: null };

describe('P2 restricted proposal validation', () => {
  it('cannot fabricate or accept model facts before fact-level authorization exists', async () => {
    const validator = new ReadOnlyP2ProposalValidator();
    await expect(validator.validateFacts(actor, base, snapshot)).resolves.toEqual([]);
    await expect(validator.validateFacts(actor, {
      ...base, proposedFacts: [{ key: 'name', value: 'Unknown', supportingTurnId: 'assistant-turn' }],
    }, snapshot)).rejects.toThrow('unavailable');
  });

  it('never approves action execution in P2', async () => {
    const validator = new ReadOnlyP2ProposalValidator();
    await expect(validator.validateActionProposal(actor, {
      ...base, actionProposal: { actionKey: 'crm.lead.create', reason: 'model proposed', input: {} },
    }, snapshot)).resolves.toBeNull();
  });
});

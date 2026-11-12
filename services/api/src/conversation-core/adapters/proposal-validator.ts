import type {
  CandidateActionProposal, ModelCandidate, ProposalValidator, SessionSnapshot, TrustedActor, VerifiedFact,
} from '../contracts.js';

/**
 * P2 cannot validate model-derived business facts or action authorization yet.
 * Fail closed until P5 supplies schema-aware, evidence-backed validators.
 */
export class ReadOnlyP2ProposalValidator implements ProposalValidator {
  async validateFacts(_actor: TrustedActor, candidate: ModelCandidate, _snapshot: SessionSnapshot): Promise<readonly VerifiedFact[]> {
    if (candidate.proposedFacts.length !== 0) {
      throw new Error('Customer fact proposals are unavailable until authorized fact validation is installed');
    }
    return [];
  }

  async validateActionProposal(_actor: TrustedActor, _candidate: ModelCandidate, _snapshot: SessionSnapshot): Promise<CandidateActionProposal | null> {
    return null;
  }
}

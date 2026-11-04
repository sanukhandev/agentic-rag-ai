import { describe, expect, it } from 'vitest';
import { evaluateV2ClaimProvenance, type V2ClaimSource } from './v2-claim-provenance.js';

const source = (text: string): V2ClaimSource => ({
  citationId: 'approved-source-12345678',
  text,
  sourceVersion: 'version-12345678',
  kind: 'source',
});
// Return true here to isolate the lexical gate from the independent semantic check.
const semanticSupported = () => true;

describe('V2 per-source claim lexical overlap (temporary 40% threshold)', () => {
  it('accepts exactly two of five important tokens when the same source semantically supports the claim', () => {
    const result = evaluateV2ClaimProvenance(
      'Alpha beta gamma delta epsilon.',
      [source('Alpha beta zeta eta theta.')],
      () => false,
      semanticSupported,
    );
    expect(result.supported).toBe(true);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.citationIds).toEqual(['approved-source-12345678']);
  });

  it('rejects one of five overlapping tokens even when the semantic callback approves', () => {
    const result = evaluateV2ClaimProvenance(
      'Alpha kappa lambda omega sigma.',
      [source('Alpha beta zeta eta theta.')],
      () => false,
      semanticSupported,
    );
    expect(result.supported).toBe(false);
    expect(result.firstFailure).toEqual({ clauseOrdinal: 1, reason: 'insufficient_clause_source_overlap' });
  });

  it('retains hard numeric, negation, and provider-outcome checks', () => {
    const examples = [
      {
        claim: 'The package costs 900 credits.',
        evidence: 'The package costs 42 credits.',
        reason: 'numeric_value_not_in_cited_source',
      },
      {
        claim: 'The package does not include one visa.',
        evidence: 'The package includes one visa.',
        reason: 'claim_source_polarity_mismatch',
      },
      {
        claim: 'The account is created.',
        evidence: 'The account can be created after submitting documents.',
        reason: 'unverified_provider_outcome',
      },
    ];
    for (const item of examples) {
      const result = evaluateV2ClaimProvenance(item.claim, [source(item.evidence)], () => false, semanticSupported);
      expect(result.supported, item.claim).toBe(false);
      expect(result.firstFailure?.reason, item.claim).toBe(item.reason);
    }
  });
});

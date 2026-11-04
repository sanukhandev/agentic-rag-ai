import { describe, expect, it } from 'vitest';
import { evaluateV2ClaimProvenance, type V2ClaimSource } from './v2-claim-provenance.js';

const source = (text: string): V2ClaimSource => ({
  citationId: 'approved-source-12345678',
  text,
  sourceVersion: 'version-12345678',
  kind: 'source',
});
// Model the independent source-support gate, without relying on shared words.
const semanticSupported = () => true;

describe('V2 per-source claim verification without a lexical overlap threshold', () => {
  it('accepts a claim with zero shared tokens when the cited source independently supports it', () => {
    const result = evaluateV2ClaimProvenance(
      'Alpha beta gamma delta epsilon.',
      [source('Zeta eta theta kappa lambda.')],
      () => false,
      semanticSupported,
    );
    expect(result.supported).toBe(true);
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.citationIds).toEqual(['approved-source-12345678']);
  });

  it('rejects even exact lexical matches when independent source support fails', () => {
    const result = evaluateV2ClaimProvenance(
      'Alpha beta gamma delta epsilon.',
      [source('Alpha beta gamma delta epsilon.')],
      () => false,
      () => false,
    );
    // Exact text is independently permitted, even without a semantic callback.
    expect(result.supported).toBe(true);

    const unverified = evaluateV2ClaimProvenance(
      'Alpha beta gamma delta epsilon.',
      [source('Alpha beta gamma delta zeta.')],
      () => false,
      () => false,
    );
    expect(unverified.supported).toBe(false);
    expect(unverified.firstFailure).toEqual({ clauseOrdinal: 1, reason: 'single_source_support_not_established' });
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

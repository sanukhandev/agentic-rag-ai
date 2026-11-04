import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateV2ClaimProvenance } from './v2-claim-provenance.js';
import { HttpV2GroundingVerifier, proofsFromV2GroundingReview } from './v2-grounding-verifier.js';
import type { V2GroundingReviewClaim } from './v2-evidence.js';

const claim: V2GroundingReviewClaim = {
  claimId: '1', text: 'Provide travel identification and select technology advisory.',
  evidence: [{ citationId: 'source-1', sourceVersion: 'version-12345678', text: 'Submit your passport and choose software consulting.' }],
};
const supported = [{ claimId: '1', citationId: 'source-1', verdict: 'supported' as const }];
afterEach(() => vi.unstubAllGlobals());

describe('independent claim entailment is separate from lexical overlap', () => {
  it('allows a zero-overlap paraphrase only after valid source-bound independent evidence', () => {
    const proofs = proofsFromV2GroundingReview([claim], supported);
    expect(proofs).not.toBeNull();
    const evaluate = (sourceText: string, version = 'version-12345678') => evaluateV2ClaimProvenance(
      claim.text,
      [{ citationId: 'source-1', text: sourceText, sourceVersion: version, kind: 'source' }],
      () => false, () => false, proofs ?? [],
    );
    expect(evaluate(claim.evidence[0]!.text).supported).toBe(true);
    expect(evaluate('Different source text.').supported).toBe(false);
    expect(evaluate(claim.evidence[0]!.text, 'revoked-version').supported).toBe(false);
    expect(evaluateV2ClaimProvenance(claim.text,
      [{ citationId: 'source-1', text: claim.evidence[0]!.text, sourceVersion: 'version-12345678', kind: 'source' }],
      () => false, () => false).supported).toBe(false);
  });

  it('denies incomplete, contradictory, repeated and invented evidence references', () => {
    expect(proofsFromV2GroundingReview([claim], [{ claimId: '1', citationId: null, verdict: 'insufficient' }])).toBeNull();
    expect(proofsFromV2GroundingReview([claim], [{ claimId: '1', citationId: 'source-1', verdict: 'contradicted' }])).toBeNull();
    expect(proofsFromV2GroundingReview([claim], [{ claimId: '1', citationId: 'unknown', verdict: 'supported' }])).toBeNull();
    expect(proofsFromV2GroundingReview([claim], [...supported, ...supported])).toBeNull();
    expect(proofsFromV2GroundingReview([claim], [])).toBeNull();
  });

  it('preserves hard numeric and outcome gates even if independent verifier approves', () => {
    const reviewed = [{ ...claim, text: 'The account is created.' }];
    const proofs = proofsFromV2GroundingReview(reviewed, supported);
    expect(proofs).not.toBeNull();
    const result = evaluateV2ClaimProvenance('The account is created.',
      [{ citationId: 'source-1', text: claim.evidence[0]!.text, sourceVersion: 'version-12345678', kind: 'source' }],
      () => false, () => false, proofs ?? []);
    expect(result.supported).toBe(false);
    expect(result.firstFailure?.reason).toBe('unverified_provider_outcome');
  });

  it('calls only the authenticated private verifier endpoint with a bounded deadline', async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ results: supported }) }));
    vi.stubGlobal('fetch', fetchMock);
    const verifier = new HttpV2GroundingVerifier('http://model-gateway:8088', 'secret-12345678');
    const results = await verifier.verify({
      requestId: 'request-12345678', deadlineAt: new Date(Date.now() + 10_000).toISOString(), claims: [claim],
    });
    expect(results).toEqual(supported);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://model-gateway:8088/internal/v2/grounding/verify');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ 'x-internal-service-key': 'secret-12345678' });
  });
});

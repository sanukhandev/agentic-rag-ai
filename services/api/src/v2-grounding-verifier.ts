import { digestV2GroundingText, type V2GroundingProof } from './v2-claim-provenance.js';
import type { V2GroundingReviewClaim } from './v2-evidence.js';

export type V2GroundingVerdict = 'supported' | 'contradicted' | 'insufficient';
export interface V2GroundingReviewResult {
  claimId: string;
  citationId: string | null;
  verdict: V2GroundingVerdict;
}
export interface V2GroundingVerifier {
  verify(request: { requestId: string; deadlineAt: string; claims: V2GroundingReviewClaim[] }): Promise<V2GroundingReviewResult[]>;
}

/** Private, one-model-request, no-tools reviewer. Never accepts client-authored proofs. */
export class HttpV2GroundingVerifier implements V2GroundingVerifier {
  constructor(private readonly baseUrl: string, private readonly serviceKey: string, private readonly timeoutMs = 10_000) {
    if (!/^https?:\/\//u.test(baseUrl) || !serviceKey || timeoutMs < 1_000 || timeoutMs > 30_000) {
      throw new Error('V2 grounding verifier requires a private URL, service key and bounded timeout.');
    }
  }

  async verify(request: { requestId: string; deadlineAt: string; claims: V2GroundingReviewClaim[] }): Promise<V2GroundingReviewResult[]> {
    if (request.claims.length < 1 || request.claims.length > 8) throw new Error('V2_GROUNDING_CLAIM_LIMIT');
    const remaining = Date.parse(request.deadlineAt) - Date.now() - 1_000;
    if (!Number.isFinite(remaining) || remaining < 1_500) throw new Error('V2_GROUNDING_DEADLINE');
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/internal/v2/grounding/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service-key': this.serviceKey },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(Math.min(this.timeoutMs, remaining)),
    });
    if (!response.ok) throw new Error('V2_GROUNDING_PROVIDER_UNAVAILABLE');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('results' in value) || !Array.isArray(value.results)) {
      throw new Error('V2_GROUNDING_INVALID_RESULT');
    }
    return value.results.map((item: unknown) => {
      if (!item || typeof item !== 'object') throw new Error('V2_GROUNDING_INVALID_RESULT');
      const row = item as Record<string, unknown>;
      if (typeof row.claimId !== 'string' || (typeof row.citationId !== 'string' && row.citationId !== null)
        || !['supported', 'contradicted', 'insufficient'].includes(String(row.verdict))) throw new Error('V2_GROUNDING_INVALID_RESULT');
      return { claimId: row.claimId, citationId: row.citationId, verdict: row.verdict as V2GroundingVerdict };
    });
  }
}

/** Mint proofs only for a complete, non-duplicated, source-matched batch. */
export const proofsFromV2GroundingReview = (
  claims: V2GroundingReviewClaim[], results: V2GroundingReviewResult[],
): V2GroundingProof[] | null => {
  if (claims.length < 1 || claims.length > 8 || results.length !== claims.length) return null;
  const byId = new Map(results.map(result => [result.claimId, result]));
  if (byId.size !== results.length || new Set(claims.map(claim => claim.claimId)).size !== claims.length) return null;
  const proofs: V2GroundingProof[] = [];
  for (const claim of claims) {
    const result = byId.get(claim.claimId);
    if (!result || result.verdict !== 'supported' || !result.citationId) return null;
    const evidence = claim.evidence.find(item => item.citationId === result.citationId);
    if (!evidence || !evidence.sourceVersion.trim() || !evidence.text.trim()) return null;
    proofs.push({
      claimDigest: digestV2GroundingText(claim.text),
      citationId: evidence.citationId,
      sourceVersion: evidence.sourceVersion,
      sourceTextDigest: digestV2GroundingText(evidence.text),
    });
  }
  return proofs;
};

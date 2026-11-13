/**
 * Private, model-independent grounding contract.
 * It provides an entailment verdict, not an authorization to execute business actions.
 */
export interface ClaimEvidence {
  readonly citationId: string;
  readonly sourceVersion: string;
  readonly text: string;
}
export interface ClaimReview {
  readonly claimId: string;
  readonly text: string;
  readonly evidence: readonly ClaimEvidence[];
}
export interface GroundingVerdict {
  readonly claimId: string;
  readonly citationId: string | null;
  readonly verdict: 'supported' | 'contradicted' | 'insufficient';
}
export interface GroundingReviewer {
  verify(request: {
    requestId: string;
    deadlineAt: string;
    claims: readonly ClaimReview[];
  }): Promise<readonly GroundingVerdict[]>;
}

export class PrivateGroundingReviewer implements GroundingReviewer {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly timeoutMs = 10_000,
  ) {
    if (!/^https?:\/\//u.test(baseUrl) || !serviceKey
      || timeoutMs < 1_000 || timeoutMs > 30_000) throw new Error('Private grounding configuration is invalid');
  }

  async verify(request: {
    requestId: string; deadlineAt: string; claims: readonly ClaimReview[];
  }): Promise<readonly GroundingVerdict[]> {
    if (request.claims.length === 0 || request.claims.length > 8
      || new Set(request.claims.map(c => c.claimId)).size !== request.claims.length) {
      throw new Error('GROUNDING_CLAIM_LIMIT');
    }
    const remaining = Date.parse(request.deadlineAt) - Date.now() - 1000;
    if (!Number.isFinite(remaining) || remaining < 1500) throw new Error('GROUNDING_DEADLINE');
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/internal/conversation/grounding/verify`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-internal-service-key': this.serviceKey},
      body: JSON.stringify(request), signal: AbortSignal.timeout(Math.min(remaining, this.timeoutMs)),
    });
    if (!response.ok) throw new Error('GROUNDING_UNAVAILABLE');
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('results' in value)
      || !Array.isArray(value.results)) throw new Error('GROUNDING_INVALID');
    const results = value.results.map((raw: unknown): GroundingVerdict => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('GROUNDING_INVALID');
      const row = raw as Record<string, unknown>;
      if (typeof row.claimId !== 'string' || (typeof row.citationId !== 'string' && row.citationId !== null)
        || !['supported','contradicted','insufficient'].includes(String(row.verdict))) {
        throw new Error('GROUNDING_INVALID');
      }
      return {
        claimId: row.claimId, citationId: row.citationId,
        verdict: row.verdict as GroundingVerdict['verdict'],
      };
    });
    if (results.length !== request.claims.length
      || new Set(results.map(r => r.claimId)).size !== results.length
      || results.some(row => !request.claims.some(claim => claim.claimId === row.claimId)
        || (row.verdict === 'supported'
          ? !request.claims.find(claim => claim.claimId === row.claimId)?.evidence.some(e => e.citationId === row.citationId)
          : row.citationId !== null))) throw new Error('GROUNDING_INVALID');
    return results;
  }
}

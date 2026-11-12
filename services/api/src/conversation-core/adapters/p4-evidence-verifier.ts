import { presentKnowledgeText } from '../../knowledge.js';
import { sanitizeKnowledgeText } from '../../privacy.js';
import type { Store } from '../../types.js';
import { extractV2ConsequentialClauses } from '../../conversation/claim-provenance.js';
import type { V2GroundingVerifier } from '../../conversation/grounding-verifier.js';
import type { ClaimVerifier, ModelCandidate, SessionSnapshot, TrustedActor } from '../contracts.js';
import { P4EvidenceSigner, p4Digest } from './evidence-receipt.js';

export interface P4ClaimSupport { readonly text: string; readonly citationIds: readonly string[] }
export interface P4CandidateEvidence {
  readonly evidenceReceipts?: readonly { citationId: string; receipt: string }[];
  readonly claimSupports?: readonly P4ClaimSupport[];
}

const conversational = (text: string): boolean => /^(?:hi|hello|hey|thanks|thank you|welcome|good (?:morning|evening|afternoon)|could you|can you tell me|what would you|which option|please tell me|i can help|i can explain|i can check|what would you like|how can i help|i don't have verified information|i cannot verify|i'm unable to verify)\b/iu.test(text.trim());

type EvidenceStore = Pick<Store, 'getSource' | 'listSourceChunks'>;

/**
 * P4 fail-closed verifier: only receipts minted by Node during this exact turn
 * can support factual claims. Rechecks live source revision and chunk status,
 * then obtains an independent semantic entailment judgment via the existing
 * private grounding service. Does not use lexical overlap as a rejection gate.
 */
export class P4ClaimVerifier implements ClaimVerifier {
  constructor(private readonly signer: P4EvidenceSigner, private readonly store: EvidenceStore,
    private readonly grounding: V2GroundingVerifier) {}

  async verify(actor: TrustedActor, candidate: ModelCandidate, pinned: SessionSnapshot,
    scopeRef = ''): Promise<{ ok: boolean; reason?: string }> {
    const extended = candidate as ModelCandidate & P4CandidateEvidence;
    const receipts = extended.evidenceReceipts;
    const claims = extended.claimSupports;
    if (!scopeRef || !Array.isArray(receipts) || !Array.isArray(claims) || claims.length > 8
      || receipts.length > 24 || candidate.evidenceRefs.length > 8
      || pinned.tenantId !== actor.tenantId || pinned.sessionId !== actor.sessionId) {
      return { ok: false, reason: 'invalid_candidate' };
    }
    const cited = new Set(candidate.evidenceRefs);
    if (cited.size !== candidate.evidenceRefs.length || receipts.length !== cited.size) {
      return { ok: false, reason: 'evidence_mismatch' };
    }
    const sources = new Map<string, { versionId: string; content: string }>();
    try {
      for (const receipt of receipts) {
        const proof = this.signer.verify(scopeRef, actor.tenantId, receipt);
        if (!cited.has(proof.citationId) || sources.has(proof.citationId)) return { ok: false, reason: 'evidence_mismatch' };
        const source = await this.store.getSource(proof.sourceId);
        if (!source || source.tenantId !== actor.tenantId || source.audience !== 'public'
          || source.status !== 'active' || source.versionId !== proof.versionId) return { ok: false, reason: 'source_revoked' };
        const chunks = await this.store.listSourceChunks(proof.sourceId, actor.tenantId);
        const chunk = chunks.find(row => row.id === proof.citationId && row.tenantId === actor.tenantId
          && row.sourceId === proof.sourceId && row.versionId === proof.versionId);
        if (!chunk) return { ok: false, reason: 'chunk_revoked' };
        const content = sanitizeKnowledgeText(presentKnowledgeText(chunk.content)).slice(0, 1500).trim();
        if (!content || p4Digest(content) !== proof.textDigest) return { ok: false, reason: 'evidence_changed' };
        sources.set(proof.citationId, { versionId: source.versionId, content });
      }
    } catch { return { ok: false, reason: 'evidence_unavailable' }; }

    // Verify coverage of complete consequential clauses, not just self-declared
    // claims. Allow natural nonfactual dialogue without forced citations.
    const consequential = extractV2ConsequentialClauses(candidate.message, conversational);
    if (consequential.length > 8 || consequential.some(text => text.length > 1500)) {
      return { ok: false, reason: 'claim_budget' };
    }
    if (consequential.length === 0) {
      return claims.length === 0 && receipts.length === 0
        ? { ok: true } : { ok: false, reason: 'unused_evidence' };
    }
    if (claims.length === 0 || receipts.length === 0) return { ok: false, reason: 'missing_claim_proof' };
    const expected = consequential.every(part => claims.some(claim => candidate.message.includes(claim.text)
      && (claim.text.includes(part) || part.includes(claim.text))));
    if (!expected) return { ok: false, reason: 'unclaimed_consequential_text' };
    const reviewClaims = claims.map((claim, index) => ({
      claimId: String(index + 1), text: claim.text,
      evidence: claim.citationIds.map(id => {
        const source = sources.get(id);
        return source ? { citationId: id, sourceVersion: source.versionId, text: source.content } : null;
      }).filter((value): value is { citationId: string; sourceVersion: string; text: string } => value !== null),
    }));
    if (reviewClaims.some((claim, index) => claim.evidence.length === 0
      || claim.evidence.length !== claims[index]?.citationIds.length)) return { ok: false, reason: 'unknown_claim_citation' };
    try {
      const verdicts = await this.grounding.verify({
        requestId: actor.sessionId.slice(0, 128), deadlineAt: new Date(Date.now() + 10_000).toISOString(), claims: reviewClaims,
      });
      if (verdicts.length !== reviewClaims.length) return { ok: false, reason: 'invalid_grounding_result' };
      const mapped = new Map(verdicts.map(v => [v.claimId, v]));
      if (mapped.size !== verdicts.length) return { ok: false, reason: 'invalid_grounding_result' };
      for (const claim of reviewClaims) {
        const verdict = mapped.get(claim.claimId);
        if (!verdict || verdict.verdict !== 'supported' || !claim.evidence.some(row => row.citationId === verdict.citationId)) {
          return { ok: false, reason: 'unsupported_claim' };
        }
      }
      return { ok: true };
    } catch { return { ok: false, reason: 'grounding_unavailable' }; }
  }
}

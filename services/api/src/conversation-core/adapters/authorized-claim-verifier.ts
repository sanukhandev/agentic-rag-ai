import { presentKnowledgeText } from '../../knowledge.js';
import { sanitizeKnowledgeText } from '../../privacy.js';
import type { Store } from '../../types.js';
import { extractConsequentialClauses } from '../authorization/claim-policy.js';
import type { GroundingReviewer } from '../authorization/grounding.js';
import type { ClaimVerifier, ModelCandidate, SessionSnapshot, TrustedActor } from '../contracts.js';
import { P4EvidenceSigner, p4Digest } from './evidence-receipt.js';

interface SignedClaim { readonly text: string; readonly citationIds: readonly string[] }
interface ProvenCandidate extends ModelCandidate {
  readonly evidenceReceipts?: readonly { readonly citationId: string; readonly receipt: string }[];
  readonly claimSupports?: readonly SignedClaim[];
}

type EvidenceStore = Pick<Store, 'getSource' | 'listSourceChunks'>;

/**
 * Authoritative grounding boundary for the new engine:
 *   - receipt must be issued by Node for this turn and tenant
 *   - source must be current, public, and unrevoked at verification time
 *   - the full factual clause must be assigned to cited evidence
 *   - independent semantic entailment must accept that exact whole clause
 *
 * Natural greetings and clarifying questions do not need citations.
 */
export class EvidenceClaimVerifier implements ClaimVerifier {
  constructor(
    private readonly signer: P4EvidenceSigner,
    private readonly store: EvidenceStore,
    private readonly grounding: GroundingReviewer,
  ) {}

  async verify(actor: TrustedActor, model: ModelCandidate, session: SessionSnapshot, scopeRef = ''):
    Promise<{ ok: boolean; reason?: string }> {
    const candidate = model as ProvenCandidate;
    const receipts = candidate.evidenceReceipts;
    const claims = candidate.claimSupports;
    if (!scopeRef || !Array.isArray(receipts) || !Array.isArray(claims)
      || receipts.length > 24 || claims.length > 8 || model.evidenceRefs.length > 8
      || actor.tenantId !== session.tenantId || actor.sessionId !== session.sessionId) {
      return { ok: false, reason: 'invalid_candidate' };
    }
    const ids = new Set(model.evidenceRefs);
    if (ids.size !== model.evidenceRefs.length || receipts.length !== ids.size) {
      return { ok: false, reason: 'evidence_mismatch' };
    }
    const sources = new Map<string, { versionId: string; content: string }>();
    try {
      for (const row of receipts) {
        const proof = this.signer.verify(scopeRef, actor.tenantId, row);
        if (!ids.has(proof.citationId) || sources.has(proof.citationId)) {
          return { ok: false, reason: 'evidence_mismatch' };
        }
        const source = await this.store.getSource(proof.sourceId);
        if (!source || source.tenantId !== actor.tenantId || source.audience !== 'public'
          || source.status !== 'active' || source.versionId !== proof.versionId) {
          return { ok: false, reason: 'source_revoked' };
        }
        const chunks = await this.store.listSourceChunks(proof.sourceId, actor.tenantId);
        const chunk = chunks.find(c => c.id === proof.citationId && c.tenantId === actor.tenantId
          && c.sourceId === proof.sourceId && c.versionId === proof.versionId);
        if (!chunk) return { ok: false, reason: 'chunk_revoked' };
        const content = sanitizeKnowledgeText(presentKnowledgeText(chunk.content)).slice(0, 1500).trim();
        if (!content || p4Digest(content) !== proof.textDigest) {
          return { ok: false, reason: 'evidence_changed' };
        }
        sources.set(proof.citationId, { content, versionId: source.versionId });
      }
    } catch {
      return { ok: false, reason: 'evidence_unavailable' };
    }

    const consequential = extractConsequentialClauses(model.message);
    if (consequential.length > 8 || consequential.some(clause => clause.length > 1500)) {
      return { ok: false, reason: 'claim_budget' };
    }
    if (consequential.length === 0) {
      return claims.length === 0 && receipts.length === 0
        ? { ok: true } : { ok: false, reason: 'unused_evidence' };
    }
    if (claims.length === 0 || receipts.length === 0) {
      return { ok: false, reason: 'missing_claim_proof' };
    }
    const used = new Set<string>();
    const reviews = [];
    for (const [i, clause] of consequential.entries()) {
      const claim = claims.find(row => row.text === clause || row.text.includes(clause));
      if (!claim || !model.message.includes(claim.text)) {
        return { ok: false, reason: 'unclaimed_consequential_text' };
      }
      if (claim.citationIds.length === 0) return { ok: false, reason: 'unused_evidence' };
      const evidence = [];
      for (const id of claim.citationIds) {
        const source = sources.get(id);
        if (!source || !ids.has(id)) return { ok: false, reason: 'unknown_claim_citation' };
        used.add(id);
        evidence.push({ citationId: id, sourceVersion: source.versionId, text: source.content });
      }
      reviews.push({ claimId: String(i + 1), text: clause, evidence });
    }
    if ([...ids].some(id => !used.has(id))) return { ok: false, reason: 'unused_evidence' };
    try {
      const verdicts = await this.grounding.verify({
        requestId: actor.sessionId.slice(0, 128),
        deadlineAt: new Date(Date.now() + 10_000).toISOString(),
        claims: reviews,
      });
      if (verdicts.length !== reviews.length
        || new Set(verdicts.map(v => v.claimId)).size !== verdicts.length) {
        return { ok: false, reason: 'invalid_grounding_result' };
      }
      return reviews.every(review => verdicts.some(v =>
        v.claimId === review.claimId && v.verdict === 'supported'
        && review.evidence.some(e => e.citationId === v.citationId)))
        ? { ok: true } : { ok: false, reason: 'unsupported_claim' };
    } catch {
      return { ok: false, reason: 'grounding_unavailable' };
    }
  }
}

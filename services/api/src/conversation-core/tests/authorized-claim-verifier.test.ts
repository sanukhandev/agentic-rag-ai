import { describe, expect, it } from 'vitest';
import { P4EvidenceSigner } from '../adapters/evidence-receipt.js';
import { EvidenceClaimVerifier } from '../adapters/authorized-claim-verifier.js';
import type { ModelCandidate, SessionSnapshot, TrustedActor } from '../contracts.js';
import type { Store, Source, Chunk } from '../../types.js';
import type { GroundingReviewer } from '../authorization/grounding.js';

const actor: TrustedActor = { tenantId: 'tenant-1', sessionId: 'session-1', principalId: 'e'.repeat(64), role: 'customer' };
const scope = 'scoped-opaque-capability';
const source = { id: 'source-1', tenantId: actor.tenantId, audience: 'public', status: 'active', versionId: 'version-1', title: 'Official Guide' } as Source;
const chunk = { id: 'chunk-1', tenantId: actor.tenantId, sourceId: source.id, versionId: source.versionId,
  locator: 'section 1', content: 'Licensing requires a signed application form.' } as Chunk;
const evidence = { citationId: chunk.id, chunkId: chunk.id, sourceId: source.id, versionId: source.versionId,
  title: source.title, locator: chunk.locator, untrustedContent: chunk.content };
const snapshot = { tenantId: actor.tenantId, sessionId: actor.sessionId } as SessionSnapshot;
const candidate: ModelCandidate = {
  message: 'Licensing requires a signed application form.',
  evidenceRefs: [chunk.id], goalCandidateKeys: [], proposedFacts: [], actionProposal: null,
  claimSupports: [{ text: 'Licensing requires a signed application form.', citationIds: [chunk.id] }],
};
function fixture() {
  let now = 1_700_000_000_000;
  let current = source;
  let reviewed = true;
  const signer = new P4EvidenceSigner('signing-secret-must-be-at-least-thirty-two-characters', () => now);
  const proof = signer.issue(scope, actor.tenantId, evidence);
  const store = {
    async getSource(id: string) { return id === source.id ? current : null; },
    async listSourceChunks() { return [chunk]; },
  } as unknown as Pick<Store, 'getSource' | 'listSourceChunks'>;
  const grounding = {
    async verify(request: { claims: Array<{ claimId: string; evidence: Array<{ citationId: string }> }> }) {
      return request.claims.map(claim => ({ claimId: claim.claimId,
        citationId: claim.evidence[0]?.citationId ?? null,
        verdict: reviewed ? 'supported' : 'insufficient',
      }));
    },
  } as GroundingReviewer;
  const verifier = new EvidenceClaimVerifier(signer, store, grounding);
  const combined = { ...candidate, evidenceReceipts: [proof] };
  return { signer, proof, verifier, combined, setNow: (value: number) => { now = value; },
    revoke: () => { current = { ...current, status: 'revoked' }; },
    rejectMeaning: () => { reviewed = false; } };
}

describe('P4 on-turn evidence provenance and claim entailment', () => {
  it('accepts only a signed current-source citation and independently supported claim', async () => {
    const f = fixture();
    expect(await f.verifier.verify(actor, f.combined, snapshot, scope)).toEqual({ ok: true });
  });
  it('denies forged, cross-tenant and expired evidence receipts', async () => {
    const f = fixture();
    expect(await f.verifier.verify(actor, { ...f.combined, evidenceReceipts: [{ ...f.proof, receipt: 'forged' }] }, snapshot, scope)).toMatchObject({ ok: false });
    expect(await f.verifier.verify({ ...actor, tenantId: 'foreign' }, f.combined, snapshot, scope)).toMatchObject({ ok: false });
    f.setNow(1_700_000_120_001);
    expect(await f.verifier.verify(actor, f.combined, snapshot, scope)).toMatchObject({ ok: false });
  });
  it('rejects revoked source and insufficient semantic entailment', async () => {
    const f = fixture();
    f.revoke();
    expect(await f.verifier.verify(actor, f.combined, snapshot, scope)).toMatchObject({ ok: false, reason: 'source_revoked' });
    const g = fixture();
    g.rejectMeaning();
    expect(await g.verifier.verify(actor, g.combined, snapshot, scope)).toMatchObject({ ok: false, reason: 'unsupported_claim' });
  });
  it('allows pure greeting without invented references', async () => {
    const f = fixture();
    const reply = { ...candidate, message: 'Hello, how can I help?', evidenceRefs: [], claimSupports: [], evidenceReceipts: [] };
    expect(await f.verifier.verify(actor, reply, snapshot, scope)).toEqual({ ok: true });
  });
  it('refuses a small fragment masquerading as a complete supported claim', async () => {
    const f = fixture();
    const reply = { ...f.combined, claimSupports: [{ text: 'Licensing', citationIds: [chunk.id] }] };
    expect(await f.verifier.verify(actor, reply, snapshot, scope)).toMatchObject({ ok: false, reason: 'unclaimed_consequential_text' });
  });
  it('refuses unused evidence references', async () => {
    const f = fixture();
    const reply = { ...f.combined, claimSupports: [{ text: 'Licensing requires a signed application form.', citationIds: [] }] };
    expect(await f.verifier.verify(actor, reply, snapshot, scope)).toMatchObject({ ok: false, reason: 'unused_evidence' });
  });

  it('rejects uncited consequential business claims', async () => {
    const f = fixture();
    const reply = { ...candidate, message: 'Our company registration costs 100 AED.', evidenceRefs: [], claimSupports: [], evidenceReceipts: [] };
    expect(await f.verifier.verify(actor, reply, snapshot, scope)).toMatchObject({ ok: false });
  });
});

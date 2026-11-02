import { describe, expect, it } from 'vitest';
import { catalogV2VersionRef, type CatalogV2Document } from './catalog-v2.js';
import { deriveV2ActionReadiness, evaluateV2StageBoundary, evaluateV2StageTransition, V2_SEVEN_STAGE_KEYS, type V2StageCompletionEvidence, type V2ActionGateContext } from './v2-action-gate.js';
import type { ActionRequest, IntentCatalogV2Version, LifecycleState, UserIntentDocument } from './types.js';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;
const pin = catalogV2VersionRef(catalog);
const tenantId = 'tenant-test';
const sessionId = 'session-test';
const opportunityId = 'journey-test';
const goalKey = 'anc.company_formation';
const lifecycleKeys = ['lead_generation', 'lead_qualification', 'account_creation', 'package_selection', 'document_upload', 'billing_invoice', 'contract'] as const;
const allStageEvidence = (key: typeof V2_SEVEN_STAGE_KEYS[number]): V2StageCompletionEvidence => ({
  tenantId, sessionId, opportunityId, catalogVersionRef: pin, stageKey: key, stageRevision: 3,
  evidenceRef: 'trusted-record:' + key, operationStatus: 'completed', evidenceTier: key === 'lead_qualification' ? 'node_verified' : 'mock_verified',
  leadId: 'original-qualified-lead', qualificationStatus: 'qualified', accountLinkedLeadId: 'original-qualified-lead',
  accountConfirmation: true, packagePublished: true, packageEligible: true,
  sf02Verified: true, leadAttachmentVerified: true, accountAttachmentVerified: true,
  invoiceIssued: true, paymentCompleted: true, contractSigned: true, signedArtifactSha256: 'a'.repeat(64),
});
const makeContext = (index: number): V2ActionGateContext => {
  const key = V2_SEVEN_STAGE_KEYS[index]!;
  const stages = Object.fromEntries(lifecycleKeys.map((lifeKey, i) => [lifeKey, {
    stage: lifeKey, revision: 3, status: i < index ? 'completed' : i === index ? 'ready' : 'not_started',
    completedAt: i < index ? '2026-11-02T12:00:00Z' : null,
    evidence: i < index ? { ...allStageEvidence(V2_SEVEN_STAGE_KEYS[i]!) } : {},
  }])) as LifecycleState['stages'];
  return {
    tenantId, sessionId, opportunityId, catalogVersionId: pin, currentStageKey: key,
    confirmedGoalKey: goalKey, goalConfirmed: true, verifiedRequirementKeys: [],
    expectedActionRevision: 1, purposeConsentScope: null, purposeConsentGranted: false,
    expectedStageRevision: 3, expectedLifecycleRevision: 9,
    intentDocument: { tenantId, sessionId, opportunityId, catalogSource: 'v2', catalogVersionRef: pin,
      goalConfirmed: true, businessGoalKey: goalKey, currentStageKey: key, stageRevision: 3 } as UserIntentDocument,
    pinnedCatalogVersion: { tenantId, status: 'published', catalogVersionRef: pin, catalog } as IntentCatalogV2Version,
    lifecycle: { currentStage: lifecycleKeys[index]!, revision: 9, stages },
  };
};

describe('seven-stage policy matrix (Node-only, no provider I/O)', () => {
  it.each(V2_SEVEN_STAGE_KEYS.map((key, index) => ({ key, index })))(
    'accepts a trusted and correctly scoped completion for $key', ({ key, index }) => {
      const context = makeContext(index);
      expect(evaluateV2StageBoundary(context)).toMatchObject({ accepted: true, currentStageKey: key });
      const nextStageKey = V2_SEVEN_STAGE_KEYS[index + 1] ?? null;
      expect(evaluateV2StageTransition({ context, completion: allStageEvidence(key), nextStageKey }))
        .toMatchObject({ accepted: true, status: 'completed', nextStageKey, expectedLifecycleRevision: 9 });
    },
  );
  it.each(V2_SEVEN_STAGE_KEYS.map((key, index) => ({ key, index })))(
    'blocks missing provider/Node evidence on $key', ({ key, index }) => {
      const context = makeContext(index);
      const nextStageKey = V2_SEVEN_STAGE_KEYS[index + 1] ?? null;
      const completion = { ...allStageEvidence(key), evidenceTier: 'mock_verified' as const, evidenceRef: '' };
      expect(evaluateV2StageTransition({ context, completion, nextStageKey })).toMatchObject({
        accepted: false, reasons: ['stage_completion_unverified'],
      });
    },
  );
  it('blocks unconfirmed goals, wrong tenant, stale revisions, unpublished versions and replayed journey evidence', () => {
    const clean = makeContext(3);
    const cases: Array<[string, V2ActionGateContext]> = [
      ['goal_not_confirmed', { ...clean, intentDocument: { ...clean.intentDocument!, goalConfirmed: false } }],
      ['persisted_identity_mismatch', { ...clean, sessionId: 'other-session' }],
      ['stage_revision_stale', { ...clean, expectedStageRevision: 4 }],
      ['catalog_not_published_or_pinned', { ...clean, pinnedCatalogVersion: { ...clean.pinnedCatalogVersion!, status: 'draft' } }],
      ['stage_evidence_scope_mismatch', { ...clean, lifecycle: {
        ...clean.lifecycle!, stages: { ...clean.lifecycle!.stages, lead_qualification: {
          ...clean.lifecycle!.stages.lead_qualification,
          evidence: { ...clean.lifecycle!.stages.lead_qualification.evidence, opportunityId: 'previous-journey' },
        } },
      } }],
    ];
    for (const [reason, context] of cases) expect(evaluateV2StageBoundary(context).reasons).toContain(reason);
  });
  it('enforces exactly the next stage, including billing_invoice/payment_invoice alias', () => {
    const context = makeContext(4);
    expect(evaluateV2StageTransition({ context, completion: allStageEvidence('document_upload'), nextStageKey: 'contract' }))
      .toMatchObject({ accepted: false, reasons: ['stage_transition_out_of_order'] });
    const invoiceContext = makeContext(5);
    expect(evaluateV2StageBoundary(invoiceContext).accepted).toBe(true);
  });
  it('requires the same qualified lead for account creation and separate invoice/payment flags', () => {
    const accountContext = makeContext(2);
    expect(evaluateV2StageTransition({ context: accountContext, nextStageKey: 'package_selection',
      completion: { ...allStageEvidence('account_creation'), leadId: 'another-lead', accountLinkedLeadId: 'another-lead' } })
      .toMatchObject({ accepted: false, reasons: ['qualified_lead_mismatch'] });
    const paymentContext = makeContext(5);
    for (const flag of ['invoiceIssued', 'paymentCompleted'] as const) {
      expect(evaluateV2StageTransition({ context: paymentContext, nextStageKey: 'contract',
        completion: { ...allStageEvidence('payment_invoice'), [flag]: false } }).reasons)
        .toContain('invoice_or_payment_incomplete');
    }
  });
  it('requires SF-02 attachments and an actual signed artifact, never legal-registration data', () => {
    const docs = makeContext(4);
    expect(evaluateV2StageTransition({ context: docs, nextStageKey: 'payment_invoice',
      completion: { ...allStageEvidence('document_upload'), sf02Verified: false } }).reasons)
      .toContain('sf02_attachments_unverified');
    const contract = makeContext(6);
    expect(evaluateV2StageTransition({ context: contract, nextStageKey: null,
      completion: { ...allStageEvidence('contract'), signedArtifactSha256: '' } }).reasons)
      .toContain('contract_signature_unverified');
    expect(evaluateV2StageTransition({ context: contract, nextStageKey: null,
      completion: allStageEvidence('contract') }).accepted).toBe(true);
  });
});


describe('canonical action-state readiness projection', () => {
  const action = (state: ActionRequest['state']): ActionRequest => ({ state } as ActionRequest);
  it.each([
    [null, false, undefined, false, 'eligible'],
    [null, true, undefined, false, 'proposed'],
    ['awaiting_confirmation', false, undefined, false, 'awaiting_confirmation'],
    ['approved', false, undefined, false, 'approved'],
    ['processing', false, undefined, false, 'dispatched'],
    ['processing', false, 'accepted', false, 'pending_provider'],
    ['completed', false, 'completed', false, 'reconcile_required'],
    ['completed', false, 'completed', true, 'completed'],
    ['failed', false, undefined, false, 'failed'],
    ['reconcile_required', false, undefined, false, 'reconcile_required'],
  ] as const)('maps %s to %s only when trusted completion allows it', (state, proposed, providerStatus, verified, status) => {
    expect(deriveV2ActionReadiness({ action: state === null ? null : action(state),
      proposalPresent: proposed, providerStatus, providerCompletionVerified: verified })).toBe(status);
  });
});

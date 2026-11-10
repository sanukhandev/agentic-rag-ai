import { describe, expect, it } from 'vitest';
import { deriveV2ProviderEvidenceStatus, validateV2VerifiedProviderCompletion, v2StageCompletionEligible } from './provider-evidence.js';
import { validateV2ProviderCorrelation, v2CatalogVersionRefSchema } from './provider-correlation.js';
import type { ActionRequest } from '../types.js';

const action: ActionRequest = {
  id: 'action-12345678', tenantId: 'tenant-12345678', sessionId: 'session-12345678', workflowKey: 'crm.account.create', intentKey: 'anc.company_formation', catalogVersionId: 'catalog-12345678', opportunityId: 'opportunity-12345678', actionKey: 'account.propose_creation', actionRevision: 2, idempotencyKey: 'action-key', state: 'processing', opaqueReference: 'opaque-action', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null,
};

const correlation = { tenantId: action.tenantId, idempotencyKey: action.idempotencyKey, sessionId: action.sessionId, opportunityId: action.opportunityId!, catalogVersionId: action.catalogVersionId!, actionKey: action.actionKey!, actionRevision: action.actionRevision! };

describe('v2 provider evidence and callback correlation', () => {
  it('accepts the canonical published Catalog V2 reference used by actions', () => {
    expect(v2CatalogVersionRefSchema.parse('anc:r2:' + 'a'.repeat(64))).toBe('anc:r2:' + 'a'.repeat(64));
  });

  it('requires every trusted identity component for v2 callbacks', () => {
    expect(validateV2ProviderCorrelation(action, correlation)).toBeNull();
    const reasons: Record<keyof typeof correlation, string> = { tenantId: 'tenant_mismatch', idempotencyKey: 'idempotency_mismatch', sessionId: 'session_mismatch', opportunityId: 'opportunity_mismatch', catalogVersionId: 'catalog_revision_mismatch', actionKey: 'action_identity_mismatch', actionRevision: 'action_revision_mismatch' };
    for (const key of Object.keys(correlation) as Array<keyof typeof correlation>) {
      const invalid = { ...correlation, [key]: key === 'actionRevision' ? 1 : 'wrong-value' };
      expect(validateV2ProviderCorrelation(action, invalid)).toBe(reasons[key]);
    }
  });

  it('maps transport and dispatch states without claiming provider verification', () => {
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'awaiting_confirmation', providerStatus: null })).toBe('transport_received');
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'processing', providerStatus: 'accepted' })).toBe('dispatched');
    expect(v2StageCompletionEligible('dispatched')).toBe(false);
  });

  it('fails closed on asserted verification without terminal completion or trusted record verification', () => {
    const completed: ActionRequest = { ...action, state: 'completed' };
    const proof = { action: completed, correlation, providerStatus: 'completed', evidenceTier: 'provider_record_verified' as const,
      recordVerificationAccepted: true, providerRecordRef: 'salesforce:001-verified' };
    expect(validateV2VerifiedProviderCompletion(proof)).toMatchObject({ accepted: true, status: 'provider_record_verified' });
    expect(validateV2VerifiedProviderCompletion({ ...proof, recordVerificationAccepted: false })).toMatchObject({
      accepted: false, reasons: ['provider_record_not_authenticated'],
    });
    expect(validateV2VerifiedProviderCompletion({ ...proof, action })).toMatchObject({
      accepted: false, reasons: ['operation_not_completed'],
    });
    expect(validateV2VerifiedProviderCompletion({ ...proof, correlation: { ...correlation, opportunityId: 'prior-journey' } }))
      .toMatchObject({ accepted: false, reasons: ['opportunity_mismatch'] });
    expect(validateV2VerifiedProviderCompletion({ ...proof, providerStatus: 'processing' }))
      .toMatchObject({ accepted: false, reasons: ['operation_not_completed'] });
    expect(validateV2VerifiedProviderCompletion({ ...proof, expectedProviderRecordRef: 'different-id' }))
      .toMatchObject({ accepted: false, reasons: ['provider_record_not_authenticated'] });
  });
  it('only explicit provider or mock evidence permits stage completion', () => {
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'completed', providerStatus: 'completed', evidenceTier: 'provider_record_verified' })).toBe('provider_record_verified');
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'completed', providerStatus: 'completed', evidenceTier: 'mock_verified' })).toBe('mock_verified');
    expect(v2StageCompletionEligible('provider_record_verified')).toBe(true);
    expect(v2StageCompletionEligible('mock_verified')).toBe(true);
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'reconcile_required', providerStatus: 'reconcile_required', evidenceTier: 'provider_record_verified' })).toBe('reconciliation_required');
    expect(v2StageCompletionEligible('reconciliation_required')).toBe(false);
  });
});

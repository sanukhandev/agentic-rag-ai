import { describe, expect, it } from 'vitest';
import { deriveV2ProviderEvidenceStatus, v2StageCompletionEligible } from './v2-provider-evidence.js';
import { validateV2ProviderCorrelation } from './v2-provider-correlation.js';
import type { ActionRequest } from './types.js';

const action: ActionRequest = {
  id: 'action-12345678', tenantId: 'tenant-12345678', sessionId: 'session-12345678', workflowKey: 'crm.account.create', intentKey: 'anc.company_formation', catalogVersionId: 'catalog-12345678', opportunityId: 'opportunity-12345678', actionKey: 'account.propose_creation', actionRevision: 2, idempotencyKey: 'action-key', state: 'processing', opaqueReference: 'opaque-action', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null,
};

const correlation = { sessionId: action.sessionId, opportunityId: action.opportunityId, catalogVersionId: action.catalogVersionId!, actionKey: action.actionKey!, actionRevision: action.actionRevision! };

describe('v2 provider evidence and callback correlation', () => {
  it('requires every trusted identity component for v2 callbacks', () => {
    expect(validateV2ProviderCorrelation(action, correlation)).toBeNull();
    const reasons: Record<keyof typeof correlation, string> = { sessionId: 'session_mismatch', opportunityId: 'opportunity_mismatch', catalogVersionId: 'catalog_revision_mismatch', actionKey: 'action_identity_mismatch', actionRevision: 'action_revision_mismatch' };
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

  it('only explicit provider or mock evidence permits stage completion', () => {
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'completed', providerStatus: 'completed', evidenceTier: 'provider_record_verified' })).toBe('provider_record_verified');
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'completed', providerStatus: 'completed', evidenceTier: 'mock_verified' })).toBe('mock_verified');
    expect(v2StageCompletionEligible('provider_record_verified')).toBe(true);
    expect(v2StageCompletionEligible('mock_verified')).toBe(true);
    expect(deriveV2ProviderEvidenceStatus({ actionState: 'reconcile_required', providerStatus: 'reconcile_required', evidenceTier: 'provider_record_verified' })).toBe('reconciliation_required');
    expect(v2StageCompletionEligible('reconciliation_required')).toBe(false);
  });
});

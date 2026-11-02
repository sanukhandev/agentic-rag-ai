import { z } from 'zod';
import type { ActionRequest } from './types.js';
import { validateV2ProviderCorrelation, type V2ProviderCorrelation } from './v2-provider-correlation.js';

export const v2ProviderEvidenceStatusSchema = z.enum(['transport_received', 'dispatched', 'provider_record_verified', 'mock_verified', 'reconciliation_required']);
export type V2ProviderEvidenceStatus = z.infer<typeof v2ProviderEvidenceStatusSchema>;

export const deriveV2ProviderEvidenceStatus = (input: { actionState: ActionRequest['state']; providerStatus?: string | null; evidenceTier?: unknown }): V2ProviderEvidenceStatus => {
  if (input.actionState === 'reconcile_required' || input.actionState === 'failed' || input.providerStatus === 'reconcile_required' || input.providerStatus === 'failed') return 'reconciliation_required';
  // A successful HTTP transport or self-asserted evidence tier is not a completed operation.
  if (input.actionState === 'completed' && input.providerStatus === 'completed'
    && (input.evidenceTier === 'provider_record_verified' || input.evidenceTier === 'mock_verified')) return input.evidenceTier;
  if (input.providerStatus === 'accepted' || input.providerStatus === 'processing' || input.providerStatus === 'completed' || ['approved', 'processing', 'completed'].includes(input.actionState)) return 'dispatched';
  return 'transport_received';
};

export const v2StageCompletionEligible = (status: V2ProviderEvidenceStatus): boolean => status === 'provider_record_verified' || status === 'mock_verified';


/**
 * The callback authenticator / provider read-back must already have verified
 * the provider record, independently of the callback's claimed evidence tier.
 * Used after provider-specific payload validation, not as a replacement for it.
 */
export const validateV2VerifiedProviderCompletion = (input: {
  action: ActionRequest;
  correlation: V2ProviderCorrelation;
  providerStatus: string;
  evidenceTier: unknown;
  recordVerificationAccepted: boolean;
  providerRecordRef: string | null;
  expectedProviderRecordRef?: string | null;
}): { accepted: boolean; status: V2ProviderEvidenceStatus; reasons: string[] } => {
  const mismatch = validateV2ProviderCorrelation(input.action, input.correlation);
  if (mismatch) return { accepted: false, status: 'reconciliation_required', reasons: [mismatch] };
  if (!input.recordVerificationAccepted || !input.providerRecordRef
    || (input.expectedProviderRecordRef && input.expectedProviderRecordRef !== input.providerRecordRef))
    return { accepted: false, status: 'reconciliation_required', reasons: ['provider_record_not_authenticated'] };
  if (input.action.state !== 'completed' || input.providerStatus !== 'completed') return {
    accepted: false,
    status: input.action.state === 'reconcile_required' || input.action.state === 'failed' ? 'reconciliation_required' : 'dispatched',
    reasons: ['operation_not_completed'],
  };
  const status = deriveV2ProviderEvidenceStatus({ actionState: input.action.state, providerStatus: input.providerStatus, evidenceTier: input.evidenceTier });
  return { accepted: v2StageCompletionEligible(status), status, reasons: v2StageCompletionEligible(status) ? [] : ['provider_evidence_unverified'] };
};

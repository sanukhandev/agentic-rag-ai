import { z } from 'zod';
import type { ActionRequest } from './types.js';

export const v2ProviderEvidenceStatusSchema = z.enum(['transport_received', 'dispatched', 'provider_record_verified', 'mock_verified', 'reconciliation_required']);
export type V2ProviderEvidenceStatus = z.infer<typeof v2ProviderEvidenceStatusSchema>;

export const deriveV2ProviderEvidenceStatus = (input: { actionState: ActionRequest['state']; providerStatus?: string | null; evidenceTier?: unknown }): V2ProviderEvidenceStatus => {
  if (input.actionState === 'reconcile_required' || input.providerStatus === 'reconcile_required') return 'reconciliation_required';
  if (input.evidenceTier === 'provider_record_verified' || input.evidenceTier === 'mock_verified') return input.evidenceTier;
  if (input.providerStatus === 'accepted' || input.providerStatus === 'processing' || input.providerStatus === 'completed' || ['approved', 'processing', 'completed'].includes(input.actionState)) return 'dispatched';
  return 'transport_received';
};

export const v2StageCompletionEligible = (status: V2ProviderEvidenceStatus): boolean => status === 'provider_record_verified' || status === 'mock_verified';

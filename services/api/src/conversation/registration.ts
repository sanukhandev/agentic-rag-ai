export type V2LegalRegistrationStatus = 'not_verified' | 'pending' | 'verified';

export interface V2LegalRegistrationState {
  status: V2LegalRegistrationStatus;
  evidenceRef: string | null;
}

export interface V2JourneyCompletionState {
  journeyStatus: 'pending' | 'fulfilled';
  legalRegistration: V2LegalRegistrationState;
  reasons: string[];
}

export const deriveV2JourneyCompletion = (input: {
  contractStatus: 'draft' | 'sent' | 'viewed' | 'signed' | 'declined' | 'reconciliation_required';
  contractEvidenceTier: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required';
  signedArtifactRef?: string | null;
  registrationStatus?: V2LegalRegistrationStatus;
  registrationEvidenceRef?: string | null;
}): V2JourneyCompletionState => {
  const journeyComplete = input.contractStatus === 'signed'
    && ['provider_record_verified', 'mock_verified'].includes(input.contractEvidenceTier)
    && Boolean(input.signedArtifactRef);
  const legalRegistration = input.registrationStatus === 'verified' && input.registrationEvidenceRef
    ? { status: 'verified' as const, evidenceRef: input.registrationEvidenceRef }
    : input.registrationStatus === 'pending'
      ? { status: 'pending' as const, evidenceRef: null }
      : { status: 'not_verified' as const, evidenceRef: null };
  return {
    journeyStatus: journeyComplete ? 'fulfilled' : 'pending',
    legalRegistration,
    reasons: [
      ...(journeyComplete ? [] : ['contract_not_verified']),
      ...(legalRegistration.status === 'verified' ? [] : ['legal_registration_not_verified']),
    ],
  };
};

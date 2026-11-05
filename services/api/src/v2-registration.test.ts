import { describe, expect, it } from 'vitest';
import { deriveV2JourneyCompletion } from './v2-registration.js';

describe('v2 journey and legal registration separation', () => {
  it('fulfills the journey after verified contract while keeping legal registration unverified', () => {
    expect(deriveV2JourneyCompletion({ contractStatus: 'signed', contractEvidenceTier: 'mock_verified', signedArtifactRef: 'mock-artifact-1' })).toEqual({ journeyStatus: 'fulfilled', legalRegistration: { status: 'not_verified', evidenceRef: null }, reasons: ['legal_registration_not_verified'] });
  });

  it('requires authoritative registration evidence before reporting legal registration', () => {
    expect(deriveV2JourneyCompletion({ contractStatus: 'signed', contractEvidenceTier: 'provider_record_verified', signedArtifactRef: 'provider-artifact-1', registrationStatus: 'pending', registrationEvidenceRef: 'n8n-execution-only' }).legalRegistration).toEqual({ status: 'pending', evidenceRef: null });
    expect(deriveV2JourneyCompletion({ contractStatus: 'signed', contractEvidenceTier: 'provider_record_verified', signedArtifactRef: 'provider-artifact-1', registrationStatus: 'verified', registrationEvidenceRef: null }).legalRegistration.status).toBe('not_verified');
    expect(deriveV2JourneyCompletion({ contractStatus: 'signed', contractEvidenceTier: 'provider_record_verified', signedArtifactRef: 'provider-artifact-1', registrationStatus: 'verified', registrationEvidenceRef: 'registration-record-1' }).legalRegistration).toEqual({ status: 'verified', evidenceRef: 'registration-record-1' });
  });

  it('does not fulfill the journey from a draft, declined, unsigned or unverified contract', () => {
    for (const contractStatus of ['draft', 'sent', 'viewed', 'declined', 'reconciliation_required'] as const) expect(deriveV2JourneyCompletion({ contractStatus, contractEvidenceTier: 'mock_verified', signedArtifactRef: 'mock-artifact-1' }).journeyStatus).toBe('pending');
    expect(deriveV2JourneyCompletion({ contractStatus: 'signed', contractEvidenceTier: 'reconciliation_required', signedArtifactRef: 'mock-artifact-1' }).journeyStatus).toBe('pending');
    expect(deriveV2JourneyCompletion({ contractStatus: 'signed', contractEvidenceTier: 'mock_verified', signedArtifactRef: null }).journeyStatus).toBe('pending');
  });
});

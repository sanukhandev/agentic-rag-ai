import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildV2AccountProviderRequest, DeterministicV2AccountProvider, V2OtpChallengeService, validateV2AccountProviderResult, type V2OtpVerificationResult } from './v2-account-provider.js';
import type { ActionRequest, CrmLead } from './types.js';

const tenantId = randomUUID();
const sessionId = randomUUID();
const opportunityId = randomUUID();
const catalogVersionId = randomUUID();
const actionId = randomUUID();
const leadId = randomUUID();
const action = (overrides: Partial<ActionRequest> = {}): ActionRequest => ({
  id: actionId, tenantId, sessionId, workflowKey: 'crm.account.convert', intentKey: 'account.registration', catalogVersionId, opportunityId, actionKey: 'account.create', actionRevision: 1, idempotencyKey: 'v2-account-idempotency-1', state: 'approved', opaqueReference: 'opaque-account-action', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null, ...overrides,
});
const lead = (overrides: Partial<CrmLead> = {}): CrmLead => ({
  id: leadId, tenantId, actionId, sessionId, intent: 'anc.company_formation', intentScore: 90, intentConfidence: 0.95, catalogVersionId, score: 90, validationPass: true, qualificationStatus: 'qualified', leadData: {}, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SANDBOX-LEAD', remoteCrm: 'salesforce-sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
});
const verifiedOtp = (overrides: Partial<Extract<V2OtpVerificationResult, { status: 'verified' }>> = {}): Extract<V2OtpVerificationResult, { status: 'verified' }> => ({ status: 'verified', challengeId: randomUUID(), tenantId, sessionId, opportunityId, leadId, ...overrides });

describe('v2 stage 3 account provider and OTP boundary', () => {
  it('binds OTP to the tenant, session, opportunity and lead, expires, locks and is one-time', () => {
    const service = new V2OtpChallengeService('test-secret', 1_000, 2);
    const now = new Date('2026-10-30T10:00:00.000Z');
    const challenge = service.issue({ tenantId, sessionId, opportunityId, leadId, code: '123456', now });
    expect(JSON.stringify(challenge)).not.toContain('123456');
    expect(service.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId, sessionId, opportunityId, leadId, challengeId: challenge.challengeId, code: '000000' }, now).status).toBe('invalid');
    expect(service.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId, sessionId, opportunityId, leadId, challengeId: challenge.challengeId, code: '000000' }, now).status).toBe('locked');
    const expired = service.issue({ tenantId, sessionId, opportunityId, leadId, code: '123456', now });
    expect(service.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId, sessionId, opportunityId, leadId, challengeId: expired.challengeId, code: '123456' }, new Date(now.getTime() + 1_001)).status).toBe('expired');
    const usable = service.issue({ tenantId, sessionId, opportunityId, leadId, code: '123456', now });
    const verified = service.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId, sessionId, opportunityId, leadId, challengeId: usable.challengeId, code: '123456' }, now);
    expect(verified.status).toBe('verified');
    expect(service.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId, sessionId, opportunityId, leadId, challengeId: usable.challengeId, code: '123456' }, now).status).toBe('already_used');
  });

  it('rejects cross-context OTP use and account requests without qualification, lead verification or confirmation', () => {
    const service = new V2OtpChallengeService('test-secret');
    const challenge = service.issue({ tenantId, sessionId, opportunityId, leadId, code: '123456' });
    expect(service.verify({ schemaVersion: 2, operation: 'otp.verify', tenantId: randomUUID(), sessionId, opportunityId, leadId, challengeId: challenge.challengeId, code: '123456' }).status).toBe('context_mismatch');
    const otp = verifiedOtp({ challengeId: challenge.challengeId });
    expect(() => buildV2AccountProviderRequest({ action: action({ payload: { contactConsent: false } }), lead: lead(), providerType: 'deterministic_mock', otp, explicitConfirmation: true })).toThrow('CONSENT');
    expect(() => buildV2AccountProviderRequest({ action: action(), lead: lead({ qualificationStatus: 'pending' }), providerType: 'deterministic_mock', otp, explicitConfirmation: true })).toThrow('QUALIFICATION');
    expect(() => buildV2AccountProviderRequest({ action: action(), lead: lead({ leadId: null, remoteCrm: null }), providerType: 'deterministic_mock', otp, explicitConfirmation: true })).toThrow('LEAD');
    expect(() => buildV2AccountProviderRequest({ action: action(), lead: lead(), providerType: 'deterministic_mock', otp, explicitConfirmation: false })).toThrow('CONFIRMATION');
    expect(() => buildV2AccountProviderRequest({ action: action({ state: 'awaiting_confirmation' }), lead: lead(), providerType: 'deterministic_mock', otp, explicitConfirmation: true })).toThrow('DISPATCHABLE');
  });

  it('creates only an opaque, idempotent mock account result after all gates pass', () => {
    const request = buildV2AccountProviderRequest({ action: action(), lead: lead(), providerType: 'deterministic_mock', otp: verifiedOtp(), explicitConfirmation: true });
    expect(JSON.stringify(request)).not.toContain('example.com');
    expect(request).toMatchObject({ operation: 'account.create_or_link', payloadRef: leadId, contactConsent: true, explicitConfirmation: true, otpVerified: true });
    const provider = new DeterministicV2AccountProvider();
    const first = provider.execute(request);
    const second = provider.execute(request);
    expect(second).toMatchObject({ deduplicated: true, remoteAccountId: first.remoteAccountId, remoteContactId: first.remoteContactId, remoteOpportunityId: first.remoteOpportunityId });
    expect(validateV2AccountProviderResult(request, first)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'mock_verified' });
  });

  it('requires exact callback correlation and independent sandbox evidence', () => {
    const request = buildV2AccountProviderRequest({ action: action(), lead: lead(), providerType: 'salesforce_sandbox', otp: verifiedOtp(), explicitConfirmation: true });
    const mock = new DeterministicV2AccountProvider().execute({ ...request, providerType: 'deterministic_mock' });
    const sandbox = { ...mock, providerType: 'salesforce_sandbox' as const, evidenceTier: 'provider_record_verified' as const };
    expect(validateV2AccountProviderResult(request, { ...sandbox, actionId: randomUUID() })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['actionId_mismatch'] });
    expect(validateV2AccountProviderResult(request, { ...sandbox, remoteOpportunityId: 'unknown' })).toMatchObject({ accepted: false, status: 'reconciliation_required' });
    expect(validateV2AccountProviderResult(request, sandbox)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'provider_record_verified' });
  });
});

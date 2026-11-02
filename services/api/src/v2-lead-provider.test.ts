import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildV2LeadProviderRequest, DeterministicV2LeadProvider, validateV2LeadProviderResult } from './v2-lead-provider.js';
import type { ActionRequest, CrmLead } from './types.js';

const tenantId = randomUUID();
const sessionId = randomUUID();
const opportunityId = randomUUID();
const catalogVersionId = randomUUID();
const actionId = randomUUID();
const leadId = randomUUID();

const action = (overrides: Partial<ActionRequest> = {}): ActionRequest => ({
  id: actionId, tenantId, sessionId, workflowKey: 'crm.lead.create', intentKey: 'anc.company_formation', catalogVersionId, opportunityId, actionKey: 'lead.create', actionRevision: 1, idempotencyKey: 'v2-lead-idempotency-1', state: 'approved', opaqueReference: 'opaque-lead-action', payload: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]', contactConsent: true }, createdAt: new Date().toISOString(), result: null, ...overrides,
});

const lead: CrmLead = {
  id: leadId, tenantId, actionId, sessionId, intent: 'anc.company_formation', intentScore: 90, intentConfidence: 0.95, catalogVersionId, score: 90, validationPass: true, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

describe('v2 stage 1 lead provider contract', () => {
  it('binds the provider request to trusted identity and sends only an opaque payload reference', () => {
    const request = buildV2LeadProviderRequest({ action: action(), lead, providerType: 'deterministic_mock' });
    expect(request).toMatchObject({ operation: 'lead.create_or_dedupe', providerType: 'deterministic_mock', tenantId, sessionId, opportunityId, actionId, payloadRef: leadId, notificationRequested: true });
    expect(JSON.stringify(request)).not.toContain('alice@example.com');
  });

  it('rejects missing consent, wrong action identity and incomplete lead contact', () => {
    expect(() => buildV2LeadProviderRequest({ action: action({ payload: { contactConsent: false } }), lead, providerType: 'deterministic_mock' })).toThrow('CONSENT');
    expect(() => buildV2LeadProviderRequest({ action: action({ sessionId: randomUUID() }), lead, providerType: 'deterministic_mock' })).toThrow('IDENTITY');
    expect(() => buildV2LeadProviderRequest({ action: action(), lead: { ...lead, validationPass: false }, providerType: 'deterministic_mock' })).toThrow('CONTACT');
  });

  it('returns an explicit mock-verified result and deduplicates retries', () => {
    const provider = new DeterministicV2LeadProvider();
    const request = buildV2LeadProviderRequest({ action: action(), lead, providerType: 'deterministic_mock' });
    const first = provider.execute(request);
    const second = provider.execute(request);
    expect(second).toEqual(first);
    expect(validateV2LeadProviderResult(request, first)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'mock_verified' });
    expect(first.externalLeadId).toMatch(/^mock-lead-[a-f0-9]{24}$/u);
  });

  it('requires independent provider evidence and exact correlation before stage completion', () => {
    const request = buildV2LeadProviderRequest({ action: action(), lead, providerType: 'salesforce_sandbox' });
    const result = { ...new DeterministicV2LeadProvider().execute({ ...request, providerType: 'deterministic_mock' }), providerType: 'salesforce_sandbox' as const, evidenceTier: 'provider_record_verified' as const };
    expect(validateV2LeadProviderResult(request, { ...result, notificationStatus: 'unknown' })).toMatchObject({ accepted: false, stageCompletionEligible: false, status: 'reconciliation_required' });
    expect(validateV2LeadProviderResult(request, { ...result, actionId: randomUUID() })).toMatchObject({ accepted: false, reasons: ['actionId_mismatch'] });
    expect(validateV2LeadProviderResult(request, result)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'provider_record_verified' });
  });
});

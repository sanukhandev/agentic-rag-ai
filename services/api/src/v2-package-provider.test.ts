import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildV2QuoteProviderRequest, DeterministicV2QuoteProvider, validateV2QuoteProviderResult } from './v2-package-provider.js';
import { newConversationState, newIntentProgress } from './conversation-state.js';
import type { PackageOffering, PackageSelection, Session } from './types.js';

const tenantId = randomUUID();
const sessionId = randomUUID();
const opportunityId = randomUUID();
const catalogVersionId = randomUUID();
const selectionId = randomUUID();
const offeringId = randomUUID();
const session = (): Session => ({ id: sessionId, tenantId, channel: 'web', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), conversationState: { ...newConversationState(), catalogVersionId, selectedIntentKey: 'anc.company_formation', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.company_formation', entries: { 'anc.company_formation': { intentKey: 'anc.company_formation', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1 } } } } } as unknown as Session);
const offering = (overrides: Partial<PackageOffering> = {}): PackageOffering => ({ id: offeringId, tenantId, catalogVersionId, packageKey: 'starter-package', name: 'Starter', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 2, officeRequirement: null, inclusions: ['company setup'], priceMinor: 125000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'approved', requiredDocuments: [], exclusions: [], availability: 'approved', approvalStatus: 'approved', sourceRefs: ['pricebook:ancfz-v1'], createdAt: new Date().toISOString(), ...overrides });
const selection = (overrides: Partial<PackageSelection> = {}): PackageSelection => ({ id: selectionId, tenantId, sessionId, opportunityId, packageOfferingId: offeringId, quoteId: null, status: 'proposed', confirmedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides });

describe('v2 stage 4 package and quote provider boundary', () => {
  it('requires approved eligible package, active versioned price and matching opportunity', () => {
    const request = buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering(), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' });
    expect(request).toMatchObject({ operation: 'quote.create', catalogVersionId, amountMinor: 125000, currency: 'AED', eligibilityVerified: true, priceSourceVersion: 'pricebook:ancfz-v1' });
    expect(() => buildV2QuoteProviderRequest({ session: session(), selection: selection({ opportunityId: randomUUID() }), offering: offering(), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' })).toThrow('OPPORTUNITY');
    expect(() => buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering({ approvalStatus: 'unavailable' }), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' })).toThrow('APPROVED');
    expect(() => buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering({ pricingEffectiveTo: new Date(Date.now() - 1_000).toISOString() }), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' })).toThrow('PRICE');
    expect(() => buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering(), priceSourceVersion: 'pricebook:ancfz-v1', eligible: false, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' })).toThrow('ELIGIBLE');
  });

  it('rejects missing or stale price sources and preserves quote expiration', () => {
    expect(() => buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering({ sourceRefs: [] }), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' })).toThrow('SOURCE');
    expect(() => buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering({ catalogVersionId: randomUUID() }), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' })).toThrow('CATALOG');
    const now = new Date('2026-10-30T10:00:00.000Z');
    const request = buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering(), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock', now, validityMs: 60_000 });
    expect(request.validUntil).toBe('2026-10-30T10:01:00.000Z');
  });

  it('returns an idempotent mock quote and keeps selected package identity', () => {
    const request = buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering(), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'deterministic_mock' });
    const provider = new DeterministicV2QuoteProvider();
    const first = provider.execute(request);
    const second = provider.execute(request);
    expect(second).toEqual(first);
    expect(first.quoteId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(validateV2QuoteProviderResult(request, first)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'mock_verified' });
  });

  it('rejects stale or altered quote evidence before selection confirmation', () => {
    const request = buildV2QuoteProviderRequest({ session: session(), selection: selection(), offering: offering(), priceSourceVersion: 'pricebook:ancfz-v1', eligible: true, idempotencyKey: 'quote-idempotency-1', providerType: 'pricebook_sandbox' });
    const mock = new DeterministicV2QuoteProvider().execute({ ...request, providerType: 'deterministic_mock' });
    const sandbox = { ...mock, providerType: 'pricebook_sandbox' as const, evidenceTier: 'provider_record_verified' as const };
    expect(validateV2QuoteProviderResult(request, { ...sandbox, amountMinor: 1 })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['amountMinor_mismatch'] });
    expect(validateV2QuoteProviderResult(request, { ...sandbox, priceSourceRefs: ['pricebook:old'] })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['price_source_mismatch'] });
    expect(validateV2QuoteProviderResult(request, sandbox)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'provider_record_verified' });
  });
});

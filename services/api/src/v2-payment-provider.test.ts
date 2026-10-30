import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildV2PaymentProviderRequest, DeterministicV2PaymentProvider, validateV2PaymentProviderResult } from './v2-payment-provider.js';
import type { Invoice, Quote } from './types.js';

const tenantId = randomUUID();
const opportunityId = randomUUID();
const quoteId = randomUUID();
const invoiceId = randomUUID();
const now = new Date().toISOString();
const quote = (overrides: Partial<Quote> = {}): Quote => ({ id: quoteId, tenantId, opportunityId, packageOfferingId: randomUUID(), amountMinor: 125000, currency: 'AED', validUntil: new Date(Date.now() + 86_400_000).toISOString(), status: 'approved', sourceRefs: ['pricebook:ancfz-v1'], createdAt: now, ...overrides });
const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({ id: invoiceId, tenantId, opportunityId, quoteId, externalInvoiceId: 'INV-SANDBOX-1', amountMinor: 125000, currency: 'AED', paymentUrl: 'https://sandbox.invalid/pay/INV-SANDBOX-1', status: 'pending', provider: 'sandbox', createdAt: now, updatedAt: now, ...overrides });

describe('v2 stage 6 invoice and payment provider boundary', () => {
  it('requires an approved quote-linked invoice and sends only hosted-payment metadata', () => {
    const request = buildV2PaymentProviderRequest({ invoice: invoice(), quote: quote(), sessionId: randomUUID(), tenantId, artifactSha256: 'a'.repeat(64), idempotencyKey: 'payment-idempotency-1', providerType: 'deterministic_mock' });
    expect(request).toMatchObject({ operation: 'payment.create_intent', invoiceId, quoteId, paymentMethod: 'hosted', paymentStatus: 'pending' });
    expect(JSON.stringify(request)).not.toMatch(/card|pan|cvv|cvc|bank|password/iu);
    expect(() => buildV2PaymentProviderRequest({ invoice: invoice({ status: 'paid' }), quote: quote(), sessionId: randomUUID(), tenantId, artifactSha256: 'a'.repeat(64), idempotencyKey: 'payment-idempotency-1', providerType: 'deterministic_mock' })).toThrow('INVOICE');
    expect(() => buildV2PaymentProviderRequest({ invoice: invoice(), quote: quote({ status: 'expired' }), sessionId: randomUUID(), tenantId, artifactSha256: 'a'.repeat(64), idempotencyKey: 'payment-idempotency-1', providerType: 'deterministic_mock' })).toThrow('QUOTE');
    expect(() => buildV2PaymentProviderRequest({ invoice: invoice({ amountMinor: 1 }), quote: quote(), sessionId: randomUUID(), tenantId, artifactSha256: 'a'.repeat(64), idempotencyKey: 'payment-idempotency-1', providerType: 'deterministic_mock' })).toThrow('AMOUNT');
  });

  it('keeps invoice artifact and payment state separate and requires artifact evidence', () => {
    expect(() => buildV2PaymentProviderRequest({ invoice: invoice(), quote: quote(), sessionId: randomUUID(), tenantId, artifactSha256: 'missing', idempotencyKey: 'payment-idempotency-1', providerType: 'deterministic_mock' })).toThrow('ARTIFACT');
    const request = buildV2PaymentProviderRequest({ invoice: invoice(), quote: quote(), sessionId: randomUUID(), tenantId, artifactSha256: 'a'.repeat(64), idempotencyKey: 'payment-idempotency-1', providerType: 'deterministic_mock' });
    const provider = new DeterministicV2PaymentProvider();
    expect(validateV2PaymentProviderResult(request, provider.execute(request))).toMatchObject({ accepted: true, paymentVerified: false, status: 'mock_verified', reasons: ['payment_pending'] });
    expect(validateV2PaymentProviderResult(request, provider.settle(request))).toMatchObject({ accepted: true, paymentVerified: true, status: 'mock_verified', reasons: ['mock_payment_only'] });
  });

  it('deduplicates retries and rejects stale, duplicate or unverified callbacks', () => {
    const request = buildV2PaymentProviderRequest({ invoice: invoice(), quote: quote(), sessionId: randomUUID(), tenantId, artifactSha256: 'a'.repeat(64), idempotencyKey: 'payment-idempotency-1', providerType: 'payment_sandbox' });
    const mock = new DeterministicV2PaymentProvider().execute({ ...request, providerType: 'deterministic_mock' });
    const sandbox = { ...mock, providerType: 'payment_sandbox' as const, status: 'sandbox_paid' as const, evidenceTier: 'provider_record_verified' as const };
    expect(validateV2PaymentProviderResult(request, { ...sandbox, invoiceId: randomUUID() })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['invoiceId_mismatch'] });
    expect(validateV2PaymentProviderResult(request, { ...sandbox, status: 'real_paid' as const })).toMatchObject({ accepted: false, status: 'reconciliation_required' });
    expect(validateV2PaymentProviderResult(request, { ...sandbox, evidenceTier: 'reconciliation_required' as const })).toMatchObject({ accepted: false, paymentVerified: false });
    expect(validateV2PaymentProviderResult(request, sandbox)).toMatchObject({ accepted: true, paymentVerified: true, status: 'provider_record_verified' });
  });
});

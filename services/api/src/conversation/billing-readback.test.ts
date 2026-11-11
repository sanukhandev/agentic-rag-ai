import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Invoice, Quote } from '../types.js';
import { HttpLiveBillingReadbackProvider, verifyLiveInvoiceReadback, verifyLivePaymentReadback } from './billing-readback.js';

const tenantId = randomUUID(), opportunityId = randomUUID(), quoteId = randomUUID(), invoiceId = randomUUID();
const quote: Quote = { id: quoteId, tenantId, opportunityId, packageOfferingId: randomUUID(), amountMinor: 125000, currency: 'AED', validUntil: new Date(Date.now() + 86400000).toISOString(), status: 'approved', sourceRefs: ['published-price'], createdAt: new Date().toISOString() };
const invoice: Invoice = { id: invoiceId, tenantId, opportunityId, quoteId, externalInvoiceId: null, amountMinor: 125000, currency: 'AED', paymentUrl: null, status: 'pending', provider: 'sandbox-pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const issued = { kind: 'invoice', provider: 'billing_live', tenantId, opportunityId, quoteId, invoiceId, externalInvoiceId: 'ext-invoice-001', amountMinor: 125000, currency: 'AED', artifactSha256: 'a'.repeat(64), deliveryStatus: 'sent', hostedPaymentUrl: 'https://payments.example.com/checkout/123' };
const pending = { ...invoice, externalInvoiceId: 'ext-invoice-001', paymentUrl: issued.hostedPaymentUrl };
const settled = { kind: 'payment', provider: 'billing_live', tenantId, opportunityId, invoiceId, externalInvoiceId: 'ext-invoice-001', paymentId: 'payment-123', amountMinor: 125000, currency: 'AED', status: 'paid', settledAt: new Date().toISOString() };

describe('live Stage 6 readback gates', () => {
  it('accepts an independently read-back, scoped, sent invoice', () => {
    expect(verifyLiveInvoiceReadback(invoice, quote, 'ext-invoice-001', issued).artifactSha256).toBe('a'.repeat(64));
  });
  it('rejects unsent PDFs, altered amounts, wrong opportunity and an invalid hosted link', () => {
    for (const changed of [{ deliveryStatus: 'draft' }, { amountMinor: 1 }, { opportunityId: randomUUID() }, { hostedPaymentUrl: 'http://bad.invalid/pay' }]) {
      expect(() => verifyLiveInvoiceReadback(invoice, quote, 'ext-invoice-001', { ...issued, ...changed })).toThrow();
    }
  });
  it('requires a settled payment for the same invoice and exact amount and currency', () => {
    expect(verifyLivePaymentReadback(pending, quote, 'payment-123', settled).status).toBe('paid');
    for (const changed of [{ status: 'pending' }, { amountMinor: 1 }, { currency: 'USD' }, { invoiceId: randomUUID() }, { paymentId: 'other-payment' }, { settledAt: new Date(Date.now() + 86400000).toISOString() }]) {
      expect(() => verifyLivePaymentReadback(pending, quote, 'payment-123', { ...settled, ...changed })).toThrow();
    }
    expect(() => verifyLivePaymentReadback({ ...pending, status: 'paid' }, quote, 'payment-123', settled)).toThrow();
  });
  it('reads only a fixed HTTPS billing gateway and no callback-controlled URL', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(issued), { status: 200 })) as unknown as typeof fetch;
    const provider = new HttpLiveBillingReadbackProvider('https://billing.example.com', 'test-readback-bearer-token-12345', fetcher);
    await expect(provider.readInvoice('ext-invoice-001')).resolves.toMatchObject({ invoiceId });
    expect(fetcher).toHaveBeenCalledWith('https://billing.example.com/v1/invoices/ext-invoice-001', expect.objectContaining({ method: 'GET', redirect: 'error' }));
    expect(() => new HttpLiveBillingReadbackProvider('http://localhost:4000', 'test-readback-bearer-token-12345')).toThrow();
    await expect(provider.readPayment('../../metadata')).rejects.toThrow('BILLING_RECORD_ID_INVALID');
  });
});

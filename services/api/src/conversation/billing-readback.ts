import { z } from 'zod';
import type { Invoice, Quote } from '../types.js';

/**
 * Billing gateway adapter. Responses must come from an independent, authenticated
 * provider GET/readback; never from an n8n POST response or customer assertion.
 * A tenant's billing integration may normalize provider-specific records to
 * these contracts behind a trusted server-to-server gateway.
 */
const ref = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,199}$/u);
const guid = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const currency = z.string().regex(/^[A-Z]{3}$/u);

export const liveInvoiceReadbackSchema = z.object({
  kind: z.literal('invoice'),
  provider: z.literal('billing_live'),
  tenantId: guid,
  opportunityId: guid,
  quoteId: guid,
  invoiceId: guid,
  externalInvoiceId: ref,
  amountMinor: z.number().int().positive(),
  currency,
  artifactSha256: digest,
  deliveryStatus: z.literal('sent'),
  hostedPaymentUrl: z.string().url().max(2_000).refine(url => url.startsWith('https://')),
}).strict();

export const livePaymentReadbackSchema = z.object({
  kind: z.literal('payment'),
  provider: z.literal('billing_live'),
  tenantId: guid,
  opportunityId: guid,
  invoiceId: guid,
  externalInvoiceId: ref,
  paymentId: ref,
  amountMinor: z.number().int().positive(),
  currency,
  status: z.literal('paid'),
  settledAt: z.string().datetime({ offset: true }),
}).strict();

export type LiveInvoiceReadback = z.infer<typeof liveInvoiceReadbackSchema>;
export type LivePaymentReadback = z.infer<typeof livePaymentReadbackSchema>;

export interface LiveBillingReadbackProvider {
  readInvoice(externalInvoiceId: string): Promise<unknown>;
  readPayment(paymentId: string): Promise<unknown>;
}

export const verifyLiveInvoiceReadback = (invoice: Invoice, quote: Quote, providerRecordId: string, record: unknown): LiveInvoiceReadback => {
  const parsed = liveInvoiceReadbackSchema.safeParse(record);
  if (!parsed.success) throw new Error('BILLING_INVOICE_READBACK_INVALID');
  const evidence = parsed.data;
  if (evidence.tenantId !== invoice.tenantId || evidence.opportunityId !== invoice.opportunityId
    || evidence.invoiceId !== invoice.id || evidence.quoteId !== invoice.quoteId || evidence.externalInvoiceId !== providerRecordId
    || quote.id !== invoice.quoteId || quote.tenantId !== invoice.tenantId || quote.opportunityId !== invoice.opportunityId
    || evidence.amountMinor !== invoice.amountMinor || evidence.amountMinor !== quote.amountMinor
    || evidence.currency !== invoice.currency || evidence.currency !== quote.currency) throw new Error('BILLING_INVOICE_READBACK_MISMATCH');
  if (invoice.externalInvoiceId && invoice.externalInvoiceId !== providerRecordId) throw new Error('BILLING_INVOICE_ID_CONFLICT');
  return evidence;
};

export const verifyLivePaymentReadback = (invoice: Invoice, quote: Quote, providerRecordId: string, record: unknown): LivePaymentReadback => {
  const parsed = livePaymentReadbackSchema.safeParse(record);
  if (!parsed.success) throw new Error('BILLING_PAYMENT_READBACK_INVALID');
  const evidence = parsed.data;
  if (invoice.status !== 'pending' || !invoice.externalInvoiceId
    || evidence.tenantId !== invoice.tenantId || evidence.opportunityId !== invoice.opportunityId
    || evidence.invoiceId !== invoice.id || evidence.externalInvoiceId !== invoice.externalInvoiceId
    || evidence.paymentId !== providerRecordId || quote.id !== invoice.quoteId
    || quote.tenantId !== invoice.tenantId || quote.opportunityId !== invoice.opportunityId
    || evidence.amountMinor !== invoice.amountMinor || evidence.amountMinor !== quote.amountMinor
    || evidence.currency !== invoice.currency || evidence.currency !== quote.currency
    || Date.parse(evidence.settledAt) > Date.now() + 60_000) throw new Error('BILLING_PAYMENT_READBACK_MISMATCH');
  return evidence;
};

export class HttpLiveBillingReadbackProvider implements LiveBillingReadbackProvider {
  private readonly base: string;
  constructor(baseUrl: string, private readonly bearerToken: string, private readonly fetcher: typeof fetch = fetch) {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.port || /^(?:localhost|.*\.localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|\[)/iu.test(parsed.hostname)
      || bearerToken.length < 16) throw new Error('BILLING_READBACK_CONFIGURATION_INVALID');
    this.base = parsed.href.replace(/\/$/u, '');
  }
  private async read(resource: 'invoices' | 'payments', recordId: string): Promise<unknown> {
    if (!ref.safeParse(recordId).success) throw new Error('BILLING_RECORD_ID_INVALID');
    const response = await this.fetcher(`${this.base}/v1/${resource}/${encodeURIComponent(recordId)}`, {
      method: 'GET', headers: { authorization: `Bearer ${this.bearerToken}`, accept: 'application/json' },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('BILLING_READBACK_UNAVAILABLE');
    const body = await response.text();
    if (body.length > 16_384) throw new Error('BILLING_READBACK_OVERSIZED');
    try { return JSON.parse(body) as unknown; } catch { throw new Error('BILLING_READBACK_NOT_JSON'); }
  }
  readInvoice(externalInvoiceId: string): Promise<unknown> { return this.read('invoices', externalInvoiceId); }
  readPayment(paymentId: string): Promise<unknown> { return this.read('payments', paymentId); }
}

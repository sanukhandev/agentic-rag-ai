import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Invoice, Quote } from './types.js';

const id = z.string().uuid();
const opaque = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,199}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const currency = z.string().regex(/^[A-Z]{3}$/u);

export const v2PaymentProviderRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('payment.create_intent'),
  providerType: z.enum(['payment_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  quoteId: id,
  invoiceId: id,
  externalInvoiceId: opaque,
  amountMinor: z.number().int().positive(),
  currency,
  invoiceArtifactSha256: sha256,
  idempotencyKey: opaque,
  paymentMethod: z.literal('hosted'),
  invoiceStatus: z.literal('pending'),
  paymentStatus: z.literal('pending'),
}).strict();

export type V2PaymentProviderRequest = z.infer<typeof v2PaymentProviderRequestSchema>;

export const v2PaymentProviderResultSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('payment.create_intent'),
  providerType: z.enum(['payment_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  quoteId: id,
  invoiceId: id,
  externalInvoiceId: opaque,
  paymentId: opaque,
  amountMinor: z.number().int().positive(),
  currency,
  status: z.enum(['pending', 'mock_paid', 'sandbox_paid', 'real_paid', 'failed', 'reconciliation_required']),
  evidenceTier: z.enum(['provider_record_verified', 'mock_verified', 'reconciliation_required']),
  idempotencyKey: opaque,
}).strict();

export type V2PaymentProviderResult = z.infer<typeof v2PaymentProviderResultSchema>;

export const buildV2PaymentProviderRequest = (input: { invoice: Invoice; quote: Quote; sessionId: string; tenantId: string; artifactSha256: string; idempotencyKey: string; providerType: 'payment_sandbox' | 'deterministic_mock' }): V2PaymentProviderRequest => {
  const { invoice, quote } = input;
  if (invoice.tenantId !== input.tenantId || quote.tenantId !== input.tenantId || invoice.quoteId !== quote.id || invoice.opportunityId !== quote.opportunityId) throw new Error('V2_PAYMENT_IDENTITY_MISMATCH');
  if (invoice.status !== 'pending' || !invoice.externalInvoiceId || !invoice.paymentUrl || !/^https:\/\//u.test(invoice.paymentUrl)) throw new Error('V2_PAYMENT_INVOICE_NOT_READY');
  if (quote.status !== 'approved' || Date.parse(quote.validUntil) <= Date.now()) throw new Error('V2_PAYMENT_QUOTE_NOT_ACTIVE');
  if (invoice.amountMinor !== quote.amountMinor || invoice.currency !== quote.currency) throw new Error('V2_PAYMENT_AMOUNT_MISMATCH');
  if (!/^[a-f0-9]{64}$/u.test(input.artifactSha256)) throw new Error('V2_PAYMENT_ARTIFACT_REQUIRED');
  return v2PaymentProviderRequestSchema.parse({ schemaVersion: 2, operation: 'payment.create_intent', providerType: input.providerType, tenantId: input.tenantId, sessionId: input.sessionId, opportunityId: invoice.opportunityId, quoteId: quote.id, invoiceId: invoice.id, externalInvoiceId: invoice.externalInvoiceId, amountMinor: invoice.amountMinor, currency: invoice.currency, invoiceArtifactSha256: input.artifactSha256, idempotencyKey: input.idempotencyKey, paymentMethod: 'hosted', invoiceStatus: 'pending', paymentStatus: 'pending' });
};

export type V2PaymentProviderValidation = { accepted: boolean; paymentVerified: boolean; status: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required'; reasons: string[] };

export const validateV2PaymentProviderResult = (request: V2PaymentProviderRequest, resultInput: unknown): V2PaymentProviderValidation => {
  const parsed = v2PaymentProviderResultSchema.safeParse(resultInput);
  if (!parsed.success) return { accepted: false, paymentVerified: false, status: 'reconciliation_required', reasons: ['result_invalid'] };
  const result = parsed.data;
  const fields = ['tenantId', 'sessionId', 'opportunityId', 'quoteId', 'invoiceId', 'externalInvoiceId', 'amountMinor', 'currency', 'idempotencyKey', 'operation'] as const;
  const mismatches = fields.filter((field) => result[field] !== request[field]);
  if (mismatches.length) return { accepted: false, paymentVerified: false, status: 'reconciliation_required', reasons: mismatches.map((field) => `${field}_mismatch`) };
  if (result.providerType !== request.providerType) return { accepted: false, paymentVerified: false, status: 'reconciliation_required', reasons: ['provider_type_mismatch'] };
  if (result.status === 'failed' || result.status === 'reconciliation_required') return { accepted: false, paymentVerified: false, status: 'reconciliation_required', reasons: ['payment_not_verified'] };
  if (request.providerType === 'deterministic_mock') {
    if (!['pending', 'mock_paid'].includes(result.status) || result.evidenceTier !== 'mock_verified') return { accepted: false, paymentVerified: false, status: 'reconciliation_required', reasons: ['mock_status_or_evidence_mismatch'] };
    return { accepted: true, paymentVerified: result.status === 'mock_paid', status: 'mock_verified', reasons: result.status === 'pending' ? ['payment_pending'] : ['mock_payment_only'] };
  }
  if (!['pending', 'sandbox_paid'].includes(result.status) || result.evidenceTier !== 'provider_record_verified') return { accepted: false, paymentVerified: false, status: 'reconciliation_required', reasons: ['sandbox_status_or_evidence_mismatch'] };
  return { accepted: true, paymentVerified: result.status === 'sandbox_paid', status: 'provider_record_verified', reasons: result.status === 'pending' ? ['payment_pending'] : [] };
};

export class DeterministicV2PaymentProvider {
  private readonly results = new Map<string, V2PaymentProviderResult>();

  public execute(requestInput: V2PaymentProviderRequest): V2PaymentProviderResult {
    const request = v2PaymentProviderRequestSchema.parse(requestInput);
    const key = `${request.tenantId}:${request.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return existing;
    const paymentId = `mockpay_${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 32)}`;
    const result = v2PaymentProviderResultSchema.parse({ schemaVersion: 2, operation: request.operation, providerType: request.providerType, tenantId: request.tenantId, sessionId: request.sessionId, opportunityId: request.opportunityId, quoteId: request.quoteId, invoiceId: request.invoiceId, externalInvoiceId: request.externalInvoiceId, paymentId, amountMinor: request.amountMinor, currency: request.currency, status: 'pending', evidenceTier: 'mock_verified', idempotencyKey: request.idempotencyKey });
    this.results.set(key, result);
    return result;
  }

  public settle(request: V2PaymentProviderRequest): V2PaymentProviderResult {
    const current = this.execute(request);
    const settled = { ...current, status: 'mock_paid' as const };
    this.results.set(`${request.tenantId}:${request.idempotencyKey}`, settled);
    return settled;
  }
}

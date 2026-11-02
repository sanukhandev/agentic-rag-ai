import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PackageOffering, PackageSelection, Session } from './types.js';

const id = z.string().uuid();
const opaque = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,199}$/u);
const currency = z.string().regex(/^[A-Z]{3}$/u);

export const v2QuoteProviderRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('quote.create'),
  providerType: z.enum(['pricebook_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  catalogVersionId: id,
  selectionId: id,
  packageOfferingId: id,
  packageKey: opaque,
  amountMinor: z.number().int().nonnegative(),
  currency,
  priceSourceVersion: opaque,
  priceSourceRefs: z.array(opaque).min(1).max(32),
  validUntil: z.string().datetime({ offset: true }),
  idempotencyKey: opaque,
  eligibilityVerified: z.literal(true),
}).strict();

export type V2QuoteProviderRequest = z.infer<typeof v2QuoteProviderRequestSchema>;

export const v2QuoteProviderResultSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('quote.create'),
  providerType: z.enum(['pricebook_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  catalogVersionId: id,
  selectionId: id,
  packageOfferingId: id,
  quoteId: id,
  amountMinor: z.number().int().nonnegative(),
  currency,
  priceSourceVersion: opaque,
  priceSourceRefs: z.array(opaque).min(1).max(32),
  validUntil: z.string().datetime({ offset: true }),
  idempotencyKey: opaque,
  evidenceTier: z.enum(['provider_record_verified', 'mock_verified', 'reconciliation_required']),
}).strict();

export type V2QuoteProviderResult = z.infer<typeof v2QuoteProviderResultSchema>;

const activePrice = (offering: PackageOffering, now: Date): boolean => Boolean(offering.priceMinor !== null && offering.currency && (!offering.pricingEffectiveFrom || Date.parse(offering.pricingEffectiveFrom) <= now.getTime()) && (!offering.pricingEffectiveTo || Date.parse(offering.pricingEffectiveTo) > now.getTime()));

export const buildV2QuoteProviderRequest = (input: {
  session: Session;
  selection: PackageSelection;
  offering: PackageOffering;
  priceSourceVersion: string;
  eligible: boolean;
  idempotencyKey: string;
  now?: Date;
  validityMs?: number;
  providerType: 'pricebook_sandbox' | 'deterministic_mock';
}): V2QuoteProviderRequest => {
  const now = input.now ?? new Date();
  const validUntil = new Date(now.getTime() + (input.validityMs ?? 7 * 24 * 60 * 60_000));
  if (input.selection.tenantId !== input.session.tenantId || input.offering.tenantId !== input.session.tenantId || input.selection.sessionId !== input.session.id) throw new Error('V2_QUOTE_TENANT_OR_SESSION_MISMATCH');
  const activeIntentKey = input.session.conversationState?.activeFollowUpIntentKey ?? input.session.conversationState?.intentProgress?.activeIntentKey ?? input.session.conversationState?.selectedIntentKey;
  if (input.selection.opportunityId !== (activeIntentKey ? input.session.conversationState?.intentProgress?.entries[activeIntentKey]?.journeyId : null)) throw new Error('V2_QUOTE_OPPORTUNITY_NOT_ACTIVE');
  if (input.selection.packageOfferingId !== input.offering.id) throw new Error('V2_QUOTE_PACKAGE_MISMATCH');
  if (input.selection.status === 'rejected') throw new Error('V2_QUOTE_SELECTION_REJECTED');
  if (!input.eligible) throw new Error('V2_QUOTE_PACKAGE_NOT_ELIGIBLE');
  if (input.offering.approvalStatus !== 'approved') throw new Error('V2_QUOTE_PACKAGE_NOT_APPROVED');
  if (!activePrice(input.offering, now) || input.offering.priceMinor === null || !input.offering.currency) throw new Error('V2_QUOTE_PRICE_NOT_ACTIVE');
  if (!input.priceSourceVersion.trim() || input.offering.sourceRefs.length === 0) throw new Error('V2_QUOTE_PRICE_SOURCE_REQUIRED');
  if (!Number.isInteger(input.validityMs ?? 7 * 24 * 60 * 60_000) || (input.validityMs ?? 7 * 24 * 60 * 60_000) <= 0) throw new Error('V2_QUOTE_VALIDITY_INVALID');
  const catalogVersionId = input.offering.catalogVersionId ?? input.session.conversationState?.catalogVersionId;
  if (!catalogVersionId) throw new Error('V2_QUOTE_CATALOG_VERSION_REQUIRED');
  if (input.offering.catalogVersionId && input.session.conversationState?.catalogVersionId && input.offering.catalogVersionId !== input.session.conversationState.catalogVersionId) throw new Error('V2_QUOTE_CATALOG_VERSION_MISMATCH');
  return v2QuoteProviderRequestSchema.parse({ schemaVersion: 2, operation: 'quote.create', providerType: input.providerType, tenantId: input.session.tenantId, sessionId: input.session.id, opportunityId: input.selection.opportunityId, catalogVersionId, selectionId: input.selection.id, packageOfferingId: input.offering.id, packageKey: input.offering.packageKey, amountMinor: input.offering.priceMinor, currency: input.offering.currency, priceSourceVersion: input.priceSourceVersion, priceSourceRefs: input.offering.sourceRefs, validUntil: validUntil.toISOString(), idempotencyKey: input.idempotencyKey, eligibilityVerified: true });
};

export type V2QuoteProviderValidation = { accepted: boolean; stageCompletionEligible: boolean; status: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required'; reasons: string[] };

export const validateV2QuoteProviderResult = (request: V2QuoteProviderRequest, resultInput: unknown): V2QuoteProviderValidation => {
  const parsed = v2QuoteProviderResultSchema.safeParse(resultInput);
  if (!parsed.success) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['result_invalid'] };
  const result = parsed.data;
  const fields = ['tenantId', 'sessionId', 'opportunityId', 'catalogVersionId', 'selectionId', 'packageOfferingId', 'amountMinor', 'currency', 'priceSourceVersion', 'validUntil', 'idempotencyKey', 'operation'] as const;
  const mismatches = fields.filter((field) => result[field] !== request[field]);
  if (mismatches.length) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: mismatches.map((field) => `${field}_mismatch`) };
  if (result.providerType !== request.providerType) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_type_mismatch'] };
  if (result.priceSourceRefs.join('|') !== request.priceSourceRefs.join('|')) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['price_source_mismatch'] };
  if (result.evidenceTier === 'reconciliation_required') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_evidence_incomplete'] };
  if (request.providerType === 'deterministic_mock' && result.evidenceTier !== 'mock_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['mock_evidence_tier_mismatch'] };
  if (request.providerType === 'pricebook_sandbox' && result.evidenceTier !== 'provider_record_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['sandbox_evidence_tier_mismatch'] };
  return { accepted: true, stageCompletionEligible: true, status: result.evidenceTier, reasons: [] };
};

export class DeterministicV2QuoteProvider {
  private readonly results = new Map<string, V2QuoteProviderResult>();

  public execute(requestInput: V2QuoteProviderRequest): V2QuoteProviderResult {
    const request = v2QuoteProviderRequestSchema.parse(requestInput);
    const key = `${request.tenantId}:${request.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return existing;
    const digest = createHash('sha256').update(request.idempotencyKey).digest('hex');
    const quoteId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const result = v2QuoteProviderResultSchema.parse({
      schemaVersion: request.schemaVersion,
      operation: request.operation,
      providerType: request.providerType,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      opportunityId: request.opportunityId,
      catalogVersionId: request.catalogVersionId,
      selectionId: request.selectionId,
      packageOfferingId: request.packageOfferingId,
      quoteId,
      amountMinor: request.amountMinor,
      currency: request.currency,
      priceSourceVersion: request.priceSourceVersion,
      priceSourceRefs: request.priceSourceRefs,
      validUntil: request.validUntil,
      idempotencyKey: request.idempotencyKey,
      evidenceTier: 'mock_verified',
    });
    this.results.set(key, result);
    return result;
  }
}

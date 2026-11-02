import { createHash } from 'node:crypto';
import { z } from 'zod';
import { activeOpportunityId } from './business-lifecycle.js';
import type { CrmAccount, Session, SupportingDocument } from './types.js';

const id = z.string().uuid();
const opaque = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,199}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const v2DocumentProviderRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('document.attach_sf02'),
  providerType: z.enum(['salesforce_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  catalogVersionId: id,
  documentId: id,
  leadId: id,
  documentSha256: sha256,
  remoteAccountId: opaque,
  remoteContactId: opaque,
  remoteOpportunityId: opaque,
  payloadRef: id,
  idempotencyKey: opaque,
  ocrStatus: z.literal('completed'),
  reviewStatus: z.literal('completed'),
  uploadConsentAt: z.string().datetime({ offset: true }),
}).strict();

export type V2DocumentProviderRequest = z.infer<typeof v2DocumentProviderRequestSchema>;

export const v2DocumentProviderResultSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('document.attach_sf02'),
  providerType: z.enum(['salesforce_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  catalogVersionId: id,
  documentId: id,
  leadId: id,
  attachmentId: opaque,
  remoteAccountId: opaque,
  remoteContactId: opaque,
  remoteOpportunityId: opaque,
  idempotencyKey: opaque,
  attachmentStatus: z.enum(['verified', 'reconciliation_required']),
  evidenceTier: z.enum(['provider_record_verified', 'mock_verified', 'reconciliation_required']),
}).strict();

export type V2DocumentProviderResult = z.infer<typeof v2DocumentProviderResultSchema>;

export const buildV2DocumentProviderRequest = (input: {
  session: Session;
  document: SupportingDocument;
  account: CrmAccount;
  idempotencyKey: string;
  providerType: 'salesforce_sandbox' | 'deterministic_mock';
}): V2DocumentProviderRequest => {
  const { session, document, account } = input;
  const activeOpportunity = activeOpportunityId(session);
  if (document.tenantId !== session.tenantId || account.tenantId !== session.tenantId || document.sessionId !== session.id || account.opportunityId !== document.opportunityId || account.opportunityId !== activeOpportunity) throw new Error('V2_DOCUMENT_IDENTITY_MISMATCH');
  if (!document.opportunityId || !document.leadId || document.status !== 'completed' || !document.consentAt) throw new Error('V2_DOCUMENT_REVIEW_REQUIRED');
  if (account.status !== 'verified' || !account.remoteAccountId || !account.remoteContactId || !account.remoteOpportunityId) throw new Error('V2_DOCUMENT_TARGET_NOT_VERIFIED');
  const catalogVersionId = document.catalogVersionId ?? session.conversationState?.catalogVersionId;
  if (!catalogVersionId) throw new Error('V2_DOCUMENT_CATALOG_VERSION_REQUIRED');
  if (account.leadId !== document.leadId) throw new Error('V2_DOCUMENT_LEAD_MISMATCH');
  return v2DocumentProviderRequestSchema.parse({
    schemaVersion: 2,
    operation: 'document.attach_sf02',
    providerType: input.providerType,
    tenantId: session.tenantId,
    sessionId: session.id,
    opportunityId: document.opportunityId,
    catalogVersionId,
    documentId: document.id,
    leadId: document.leadId,
    documentSha256: document.sha256,
    remoteAccountId: account.remoteAccountId,
    remoteContactId: account.remoteContactId,
    remoteOpportunityId: account.remoteOpportunityId,
    payloadRef: document.id,
    idempotencyKey: input.idempotencyKey,
    ocrStatus: 'completed',
    reviewStatus: 'completed',
    uploadConsentAt: document.consentAt,
  });
};

export type V2DocumentProviderValidation = { accepted: boolean; stageCompletionEligible: boolean; status: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required'; reasons: string[] };

export const validateV2DocumentProviderResult = (request: V2DocumentProviderRequest, resultInput: unknown): V2DocumentProviderValidation => {
  const parsed = v2DocumentProviderResultSchema.safeParse(resultInput);
  if (!parsed.success) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['result_invalid'] };
  const result = parsed.data;
  const fields = ['tenantId', 'sessionId', 'opportunityId', 'catalogVersionId', 'documentId', 'leadId', 'remoteAccountId', 'remoteContactId', 'remoteOpportunityId', 'idempotencyKey', 'operation'] as const;
  const mismatches = fields.filter((field) => result[field] !== request[field]);
  if (mismatches.length) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: mismatches.map((field) => `${field}_mismatch`) };
  if (result.providerType !== request.providerType) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_type_mismatch'] };
  if (result.attachmentStatus !== 'verified' || result.evidenceTier === 'reconciliation_required') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['attachment_evidence_incomplete'] };
  if (request.providerType === 'deterministic_mock' && result.evidenceTier !== 'mock_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['mock_evidence_tier_mismatch'] };
  if (request.providerType === 'salesforce_sandbox' && result.evidenceTier !== 'provider_record_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['sandbox_evidence_tier_mismatch'] };
  return { accepted: true, stageCompletionEligible: true, status: result.evidenceTier, reasons: [] };
};

export class DeterministicV2DocumentProvider {
  private readonly results = new Map<string, V2DocumentProviderResult>();

  public execute(requestInput: V2DocumentProviderRequest): V2DocumentProviderResult {
    const request = v2DocumentProviderRequestSchema.parse(requestInput);
    const key = `${request.tenantId}:${request.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return existing;
    const digest = createHash('sha256').update(`${request.documentId}:${request.idempotencyKey}`).digest('hex');
    const result = v2DocumentProviderResultSchema.parse({
      schemaVersion: request.schemaVersion,
      operation: request.operation,
      providerType: request.providerType,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      opportunityId: request.opportunityId,
      catalogVersionId: request.catalogVersionId,
      documentId: request.documentId,
      leadId: request.leadId,
      attachmentId: `mock-attachment-${digest.slice(0, 24)}`,
      remoteAccountId: request.remoteAccountId,
      remoteContactId: request.remoteContactId,
      remoteOpportunityId: request.remoteOpportunityId,
      idempotencyKey: request.idempotencyKey,
      attachmentStatus: 'verified',
      evidenceTier: 'mock_verified',
    });
    this.results.set(key, result);
    return result;
  }
}

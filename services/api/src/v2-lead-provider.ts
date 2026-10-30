import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionRequest, CrmLead } from './types.js';

const id = z.string().uuid();
const opaque = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u);

export const v2LeadProviderRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('lead.create_or_dedupe'),
  providerType: z.enum(['salesforce_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  catalogVersionId: id,
  actionId: id,
  actionKey: opaque,
  actionRevision: z.number().int().positive(),
  idempotencyKey: opaque,
  opaqueReference: opaque,
  payloadRef: id,
  notificationRequested: z.literal(true),
}).strict();

export type V2LeadProviderRequest = z.infer<typeof v2LeadProviderRequestSchema>;

export const v2LeadProviderResultSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('lead.create_or_dedupe'),
  providerType: z.enum(['salesforce_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  catalogVersionId: id,
  actionId: id,
  actionKey: opaque,
  actionRevision: z.number().int().positive(),
  idempotencyKey: opaque,
  externalLeadId: opaque,
  deduplicated: z.boolean(),
  notificationStatus: z.enum(['accepted', 'not_sent', 'unknown']),
  evidenceTier: z.enum(['provider_record_verified', 'mock_verified', 'reconciliation_required']),
}).strict();

export type V2LeadProviderResult = z.infer<typeof v2LeadProviderResultSchema>;

export type V2LeadProviderValidation = {
  accepted: boolean;
  stageCompletionEligible: boolean;
  status: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required';
  reasons: string[];
};

export const buildV2LeadProviderRequest = (input: {
  action: ActionRequest;
  lead: CrmLead;
  providerType: 'salesforce_sandbox' | 'deterministic_mock';
}): V2LeadProviderRequest => {
  const { action, lead, providerType } = input;
  if (!['approved', 'processing'].includes(action.state)) throw new Error('V2_LEAD_ACTION_NOT_DISPATCHABLE');
  if (action.tenantId !== lead.tenantId || action.sessionId !== lead.sessionId || action.id !== lead.actionId) throw new Error('V2_LEAD_IDENTITY_MISMATCH');
  if (!action.opportunityId || !action.catalogVersionId || !action.actionKey || !action.actionRevision) throw new Error('V2_LEAD_BINDING_INCOMPLETE');
  if (action.payload.contactConsent !== true) throw new Error('V2_LEAD_CONSENT_REQUIRED');
  if (!lead.validationPass || !lead.leadData.name || !lead.leadData.email || !lead.leadData.phone) throw new Error('V2_LEAD_CONTACT_INCOMPLETE');
  return v2LeadProviderRequestSchema.parse({
    schemaVersion: 2,
    operation: 'lead.create_or_dedupe',
    providerType,
    tenantId: action.tenantId,
    sessionId: action.sessionId,
    opportunityId: action.opportunityId,
    catalogVersionId: action.catalogVersionId,
    actionId: action.id,
    actionKey: action.actionKey,
    actionRevision: action.actionRevision,
    idempotencyKey: action.idempotencyKey,
    opaqueReference: action.opaqueReference,
    payloadRef: lead.id,
    notificationRequested: true,
  });
};

export const validateV2LeadProviderResult = (request: V2LeadProviderRequest, resultInput: unknown): V2LeadProviderValidation => {
  const parsed = v2LeadProviderResultSchema.safeParse(resultInput);
  if (!parsed.success) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['result_invalid'] };
  const result = parsed.data;
  const mismatches = (['tenantId', 'sessionId', 'opportunityId', 'catalogVersionId', 'actionId', 'actionKey', 'actionRevision', 'idempotencyKey', 'operation'] as const)
    .filter((field) => result[field] !== request[field]);
  if (mismatches.length) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: mismatches.map((field) => `${field}_mismatch`) };
  if (result.providerType !== request.providerType) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_type_mismatch'] };
  if (result.notificationStatus === 'unknown' || result.evidenceTier === 'reconciliation_required') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_evidence_incomplete'] };
  if (request.providerType === 'deterministic_mock' && result.evidenceTier !== 'mock_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['mock_evidence_tier_mismatch'] };
  if (request.providerType === 'salesforce_sandbox' && result.evidenceTier !== 'provider_record_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['sandbox_evidence_tier_mismatch'] };
  return { accepted: true, stageCompletionEligible: true, status: result.evidenceTier, reasons: result.notificationStatus === 'not_sent' ? ['notification_not_sent'] : [] };
};

export class DeterministicV2LeadProvider {
  private readonly results = new Map<string, V2LeadProviderResult>();

  execute(requestInput: V2LeadProviderRequest): V2LeadProviderResult {
    const request = v2LeadProviderRequestSchema.parse(requestInput);
    const existing = this.results.get(`${request.tenantId}:${request.idempotencyKey}`);
    if (existing) return existing;
    const externalLeadId = `mock-lead-${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 24)}`;
    const result = v2LeadProviderResultSchema.parse({
      schemaVersion: request.schemaVersion,
      operation: request.operation,
      providerType: request.providerType,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      opportunityId: request.opportunityId,
      catalogVersionId: request.catalogVersionId,
      actionId: request.actionId,
      actionKey: request.actionKey,
      actionRevision: request.actionRevision,
      idempotencyKey: request.idempotencyKey,
      externalLeadId,
      deduplicated: false,
      notificationStatus: 'accepted',
      evidenceTier: 'mock_verified',
    });
    this.results.set(`${request.tenantId}:${request.idempotencyKey}`, result);
    return result;
  }
}

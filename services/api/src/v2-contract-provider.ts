import { createHash } from 'node:crypto';
import { z } from 'zod';
import { activeOpportunityId } from './business-lifecycle.js';
import type { Contract, CrmAccount, Invoice, PackageSelection, Session } from './types.js';

const id = z.string().uuid();
const opaque = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{3,199}$/u);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const v2ContractProviderRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('contract.send_for_signature'),
  providerType: z.enum(['signature_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  contractId: id,
  packageSelectionId: id,
  invoiceId: id,
  templateKey: opaque,
  contractArtifactSha256: sha256,
  remoteAccountId: opaque,
  remoteContactId: opaque,
  remoteOpportunityId: opaque,
  signingUrl: z.string().url().max(2_000),
  signatoryRef: opaque,
  signingExpiresAt: z.string().datetime({ offset: true }),
  customerApproval: z.literal(true),
  paymentVerified: z.literal(true),
  paymentEvidenceTier: z.enum(['provider_record_verified', 'mock_verified']),
  idempotencyKey: opaque,
}).strict();

export type V2ContractProviderRequest = z.infer<typeof v2ContractProviderRequestSchema>;

export const v2ContractProviderResultSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('contract.send_for_signature'),
  providerType: z.enum(['signature_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  contractId: id,
  packageSelectionId: id,
  invoiceId: id,
  remoteContractId: opaque,
  signatoryRef: opaque,
  status: z.enum(['sent', 'viewed', 'signed', 'declined', 'reconciliation_required']),
  signatureEvidence: z.enum(['none', 'provider_record_verified', 'mock_verified', 'reconciliation_required']),
  signedArtifactSha256: sha256.nullable(),
  idempotencyKey: opaque,
}).strict();

export type V2ContractProviderResult = z.infer<typeof v2ContractProviderResultSchema>;

export const buildV2ContractProviderRequest = (input: {
  session: Session;
  contract: Contract;
  selection: PackageSelection;
  invoice: Invoice;
  account: CrmAccount;
  artifactSha256: string;
  signatoryRef: string;
  signingExpiresAt: string;
  customerApproval: boolean;
  paymentEvidenceTier: 'provider_record_verified' | 'mock_verified';
  idempotencyKey: string;
  providerType: 'signature_sandbox' | 'deterministic_mock';
}): V2ContractProviderRequest => {
  const { session, contract, selection, invoice, account } = input;
  if (contract.tenantId !== session.tenantId || selection.tenantId !== session.tenantId || invoice.tenantId !== session.tenantId || account.tenantId !== session.tenantId || contract.opportunityId !== selection.opportunityId || contract.opportunityId !== invoice.opportunityId || contract.opportunityId !== account.opportunityId || contract.opportunityId !== activeOpportunityId(session)) throw new Error('V2_CONTRACT_IDENTITY_MISMATCH');
  if (contract.status !== 'draft' || selection.status !== 'confirmed' || invoice.status !== 'paid') throw new Error('V2_CONTRACT_PREREQUISITES_INCOMPLETE');
  if (contract.packageSelectionId !== selection.id || contract.invoiceId !== invoice.id) throw new Error('V2_CONTRACT_LINKAGE_MISMATCH');
  if (account.status !== 'verified' || !account.remoteAccountId || !account.remoteContactId || !account.remoteOpportunityId) throw new Error('V2_CONTRACT_ACCOUNT_NOT_VERIFIED');
  if (!input.customerApproval) throw new Error('V2_CONTRACT_APPROVAL_REQUIRED');
  if (!/^[a-f0-9]{64}$/u.test(input.artifactSha256)) throw new Error('V2_CONTRACT_ARTIFACT_REQUIRED');
  if (Date.parse(input.signingExpiresAt) <= Date.now()) throw new Error('V2_CONTRACT_SIGNING_EXPIRED');
  return v2ContractProviderRequestSchema.parse({ schemaVersion: 2, operation: 'contract.send_for_signature', providerType: input.providerType, tenantId: session.tenantId, sessionId: session.id, opportunityId: contract.opportunityId, contractId: contract.id, packageSelectionId: selection.id, invoiceId: invoice.id, templateKey: contract.templateKey, contractArtifactSha256: input.artifactSha256, remoteAccountId: account.remoteAccountId, remoteContactId: account.remoteContactId, remoteOpportunityId: account.remoteOpportunityId, signingUrl: contract.signingUrl ?? 'https://sandbox.invalid/sign/pending', signatoryRef: input.signatoryRef, signingExpiresAt: input.signingExpiresAt, customerApproval: true, paymentVerified: true, paymentEvidenceTier: input.paymentEvidenceTier, idempotencyKey: input.idempotencyKey });
};

export type V2ContractProviderValidation = { accepted: boolean; stageCompletionEligible: boolean; status: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required'; reasons: string[] };

export const validateV2ContractProviderResult = (request: V2ContractProviderRequest, resultInput: unknown): V2ContractProviderValidation => {
  const parsed = v2ContractProviderResultSchema.safeParse(resultInput);
  if (!parsed.success) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['result_invalid'] };
  const result = parsed.data;
  const fields = ['tenantId', 'sessionId', 'opportunityId', 'contractId', 'packageSelectionId', 'invoiceId', 'signatoryRef', 'idempotencyKey', 'operation'] as const;
  const mismatches = fields.filter((field) => result[field] !== request[field]);
  if (mismatches.length) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: mismatches.map((field) => `${field}_mismatch`) };
  if (result.providerType !== request.providerType) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_type_mismatch'] };
  if (result.status === 'reconciliation_required' || result.status === 'declined' || result.signatureEvidence === 'reconciliation_required') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['signature_not_verified'] };
  if (result.status === 'signed' && result.signedArtifactSha256 === null) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['signed_artifact_missing'] };
  const signed = result.status === 'signed' && result.signedArtifactSha256 !== null;
  if (request.providerType === 'deterministic_mock' && !['none', 'mock_verified'].includes(result.signatureEvidence)) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['mock_evidence_tier_mismatch'] };
  if (request.providerType === 'signature_sandbox' && !['none', 'provider_record_verified'].includes(result.signatureEvidence)) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['sandbox_evidence_tier_mismatch'] };
  return { accepted: true, stageCompletionEligible: signed, status: result.signatureEvidence === 'none' ? 'reconciliation_required' : result.signatureEvidence, reasons: signed ? [] : ['signature_pending'] };
};

export class DeterministicV2ContractProvider {
  private readonly results = new Map<string, V2ContractProviderResult>();

  public execute(requestInput: V2ContractProviderRequest): V2ContractProviderResult {
    const request = v2ContractProviderRequestSchema.parse(requestInput);
    const key = `${request.tenantId}:${request.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return existing;
    const remoteContractId = `mock-contract-${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 24)}`;
    const result = v2ContractProviderResultSchema.parse({ schemaVersion: 2, operation: request.operation, providerType: request.providerType, tenantId: request.tenantId, sessionId: request.sessionId, opportunityId: request.opportunityId, contractId: request.contractId, packageSelectionId: request.packageSelectionId, invoiceId: request.invoiceId, remoteContractId, signatoryRef: request.signatoryRef, status: 'sent', signatureEvidence: 'none', signedArtifactSha256: null, idempotencyKey: request.idempotencyKey });
    this.results.set(key, result);
    return result;
  }

  public sign(request: V2ContractProviderRequest): V2ContractProviderResult {
    const current = this.execute(request);
    const signedArtifactSha256 = createHash('sha256').update(`${current.remoteContractId}:${request.contractArtifactSha256}`).digest('hex');
    const signed = { ...current, status: 'signed' as const, signatureEvidence: 'mock_verified' as const, signedArtifactSha256 };
    this.results.set(`${request.tenantId}:${request.idempotencyKey}`, signed);
    return signed;
  }
}

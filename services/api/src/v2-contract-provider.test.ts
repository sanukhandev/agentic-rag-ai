import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newConversationState, newIntentProgress } from './conversation-state.js';
import { buildV2ContractProviderRequest, DeterministicV2ContractProvider, validateV2ContractProviderResult } from './v2-contract-provider.js';
import type { Contract, CrmAccount, Invoice, PackageSelection, Session } from './types.js';

const tenantId = randomUUID();
const sessionId = randomUUID();
const opportunityId = randomUUID();
const selectionId = randomUUID();
const invoiceId = randomUUID();
const contractId = randomUUID();
const quoteId = randomUUID();
const now = new Date().toISOString();
const session = (): Session => ({ id: sessionId, tenantId, channel: 'web', status: 'active', createdAt: now, updatedAt: now, conversationState: { ...newConversationState(), selectedIntentKey: 'anc.company_formation', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.company_formation', entries: { 'anc.company_formation': { intentKey: 'anc.company_formation', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1 } } } } } as unknown as Session);
const selection = (overrides: Partial<PackageSelection> = {}): PackageSelection => ({ id: selectionId, tenantId, sessionId, opportunityId, packageOfferingId: randomUUID(), quoteId, status: 'confirmed', confirmedAt: now, createdAt: now, updatedAt: now, ...overrides });
const invoice = (overrides: Partial<Invoice> = {}): Invoice => ({ id: invoiceId, tenantId, opportunityId, quoteId, externalInvoiceId: 'INV-SANDBOX-1', amountMinor: 125000, currency: 'AED', paymentUrl: 'https://sandbox.invalid/pay/INV-SANDBOX-1', status: 'paid', provider: 'mock', createdAt: now, updatedAt: now, ...overrides });
const account = (overrides: Partial<CrmAccount> = {}): CrmAccount => ({ id: randomUUID(), tenantId, opportunityId, leadId: randomUUID(), remoteAccountId: '001-SANDBOX', remoteContactId: '003-SANDBOX', remoteOpportunityId: '006-SANDBOX', status: 'verified', conversionRule: 'qualification_verified', verifiedAt: now, createdAt: now, updatedAt: now, ...overrides });
const contract = (overrides: Partial<Contract> = {}): Contract => ({ id: contractId, tenantId, opportunityId, packageSelectionId: selectionId, invoiceId, externalContractId: null, templateKey: 'ancfz-company-formation-v1', signingUrl: 'https://sandbox.invalid/sign/contract-1', status: 'draft', provider: 'mock', createdAt: now, updatedAt: now, ...overrides });
const request = (providerType: 'signature_sandbox' | 'deterministic_mock' = 'deterministic_mock') => buildV2ContractProviderRequest({ session: session(), contract: contract(), selection: selection(), invoice: invoice(), account: account(), artifactSha256: 'a'.repeat(64), signatoryRef: 'signatory-ref-1', signingExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), customerApproval: true, paymentEvidenceTier: 'mock_verified', idempotencyKey: 'contract-idempotency-1', providerType });

describe('v2 stage 7 contract and signature provider boundary', () => {
  it('requires verified prior stages, customer approval and an unexpired signing request', () => {
    expect(request()).toMatchObject({ operation: 'contract.send_for_signature', customerApproval: true, paymentVerified: true });
    expect(() => buildV2ContractProviderRequest({ session: session(), contract: contract({ status: 'sent' }), selection: selection(), invoice: invoice(), account: account(), artifactSha256: 'a'.repeat(64), signatoryRef: 'signatory-ref-1', signingExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), customerApproval: true, paymentEvidenceTier: 'mock_verified', idempotencyKey: 'contract-idempotency-1', providerType: 'deterministic_mock' })).toThrow('PREREQUISITES');
    expect(() => buildV2ContractProviderRequest({ session: session(), contract: contract(), selection: selection({ status: 'proposed' }), invoice: invoice(), account: account(), artifactSha256: 'a'.repeat(64), signatoryRef: 'signatory-ref-1', signingExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), customerApproval: true, paymentEvidenceTier: 'mock_verified', idempotencyKey: 'contract-idempotency-1', providerType: 'deterministic_mock' })).toThrow('PREREQUISITES');
    expect(() => buildV2ContractProviderRequest({ session: session(), contract: contract(), selection: selection(), invoice: invoice(), account: account(), artifactSha256: 'a'.repeat(64), signatoryRef: 'signatory-ref-1', signingExpiresAt: new Date(Date.now() - 1_000).toISOString(), customerApproval: true, paymentEvidenceTier: 'mock_verified', idempotencyKey: 'contract-idempotency-1', providerType: 'deterministic_mock' })).toThrow('EXPIRED');
    expect(() => buildV2ContractProviderRequest({ session: session(), contract: contract(), selection: selection(), invoice: invoice(), account: account(), artifactSha256: 'a'.repeat(64), signatoryRef: 'signatory-ref-1', signingExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), customerApproval: false, paymentEvidenceTier: 'mock_verified', idempotencyKey: 'contract-idempotency-1', providerType: 'deterministic_mock' })).toThrow('APPROVAL');
  });

  it('keeps sent and signed distinct and verifies a deterministic signature only after explicit sign', () => {
    const provider = new DeterministicV2ContractProvider();
    const input = request();
    const sent = provider.execute(input);
    expect(validateV2ContractProviderResult(input, sent)).toMatchObject({ accepted: true, stageCompletionEligible: false, reasons: ['signature_pending'] });
    const signed = provider.sign(input);
    expect(validateV2ContractProviderResult(input, signed)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'mock_verified' });
    expect(signed.signedArtifactSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(provider.sign(input)).toEqual(signed);
  });

  it('rejects wrong signatory, invalid signature state, decline and replay-like callback evidence', () => {
    const input = request('signature_sandbox');
    const mock = new DeterministicV2ContractProvider().sign({ ...input, providerType: 'deterministic_mock' });
    const sandbox = { ...mock, providerType: 'signature_sandbox' as const, signatureEvidence: 'provider_record_verified' as const };
    expect(validateV2ContractProviderResult(input, { ...sandbox, signatoryRef: 'wrong-signatory' })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['signatoryRef_mismatch'] });
    expect(validateV2ContractProviderResult(input, { ...sandbox, status: 'declined' as const })).toMatchObject({ accepted: false, stageCompletionEligible: false });
    expect(validateV2ContractProviderResult(input, { ...sandbox, signedArtifactSha256: null })).toMatchObject({ accepted: false, stageCompletionEligible: false });
    expect(validateV2ContractProviderResult(input, sandbox)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'provider_record_verified' });
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { newConversationState, newIntentProgress } from './conversation-state.js';
import { buildV2DocumentProviderRequest, DeterministicV2DocumentProvider, validateV2DocumentProviderResult } from './v2-document-provider.js';
import type { CrmAccount, Session, SupportingDocument } from './types.js';

const tenantId = randomUUID();
const sessionId = randomUUID();
const opportunityId = randomUUID();
const catalogVersionId = randomUUID();
const documentId = randomUUID();
const leadId = randomUUID();
const now = new Date().toISOString();
const session = (): Session => ({ id: sessionId, tenantId, channel: 'web', status: 'active', createdAt: now, updatedAt: now, conversationState: { ...newConversationState(), catalogVersionId, selectedIntentKey: 'anc.company_formation', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.company_formation', entries: { 'anc.company_formation': { intentKey: 'anc.company_formation', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1 } } } } } as unknown as Session);
const account = (overrides: Partial<CrmAccount> = {}): CrmAccount => ({ id: randomUUID(), tenantId, opportunityId, leadId, remoteAccountId: '001-SANDBOX', remoteContactId: '003-SANDBOX', remoteOpportunityId: '006-SANDBOX', status: 'verified', conversionRule: 'qualification_verified', verifiedAt: now, createdAt: now, updatedAt: now, ...overrides });
const document = (overrides: Partial<SupportingDocument> = {}): SupportingDocument => ({ id: documentId, tenantId, sessionId, leadId, opportunityId, intentKey: 'anc.company_formation', catalogVersionId, fileName: 'identity.pdf', mimeType: 'application/pdf', sizeBytes: 64, sha256: 'a'.repeat(64), requirementKey: 'identity_document', expectedDocumentType: 'identity_document', storageKey: `${tenantId}/${documentId}.pdf`, status: 'completed', workflowKey: 'anc.document.ocr.extract', storeExtractedText: false, extractedText: null, summary: 'reviewed', errorCode: null, consentAt: now, createdAt: now, updatedAt: now, ...overrides });

describe('v2 stage 5 document and SF-02 provider boundary', () => {
  it('requires completed OCR/review, upload consent, verified target and matching opportunity', () => {
    const request = buildV2DocumentProviderRequest({ session: session(), document: document(), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' });
    expect(request).toMatchObject({ operation: 'document.attach_sf02', documentId, leadId, ocrStatus: 'completed', reviewStatus: 'completed' });
    expect(JSON.stringify(request)).not.toContain('identity.pdf');
    expect(() => buildV2DocumentProviderRequest({ session: session(), document: document({ status: 'processing' }), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' })).toThrow('REVIEW');
    expect(() => buildV2DocumentProviderRequest({ session: session(), document: document(), account: account({ status: 'pending' }), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' })).toThrow('TARGET');
    expect(() => buildV2DocumentProviderRequest({ session: session(), document: document({ opportunityId: randomUUID() }), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' })).toThrow('IDENTITY');
  });

  it('rejects wrong Lead or missing catalog version before any attachment request', () => {
    expect(() => buildV2DocumentProviderRequest({ session: session(), document: document(), account: account({ leadId: randomUUID() }), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' })).toThrow('LEAD');
    expect(() => buildV2DocumentProviderRequest({ session: session(), document: document({ catalogVersionId: null }), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' })).not.toThrow();
    const noCatalogSession = session();
    noCatalogSession.conversationState = { ...noCatalogSession.conversationState!, catalogVersionId: null };
    expect(() => buildV2DocumentProviderRequest({ session: noCatalogSession, document: document({ catalogVersionId: null }), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' })).toThrow('CATALOG');
  });

  it('deduplicates SF-02 mock attachment and requires verified callback evidence', () => {
    const request = buildV2DocumentProviderRequest({ session: session(), document: document(), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'deterministic_mock' });
    const provider = new DeterministicV2DocumentProvider();
    const first = provider.execute(request);
    const second = provider.execute(request);
    expect(second).toEqual(first);
    expect(first.attachmentId).toMatch(/^mock-attachment-[a-f0-9]{24}$/u);
    expect(validateV2DocumentProviderResult(request, first)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'mock_verified' });
  });

  it('rejects wrong-record, duplicate-correlated and delayed/incomplete callbacks', () => {
    const request = buildV2DocumentProviderRequest({ session: session(), document: document(), account: account(), idempotencyKey: 'document-idempotency-1', providerType: 'salesforce_sandbox' });
    const mock = new DeterministicV2DocumentProvider().execute({ ...request, providerType: 'deterministic_mock' });
    const sandbox = { ...mock, providerType: 'salesforce_sandbox' as const, evidenceTier: 'provider_record_verified' as const };
    expect(validateV2DocumentProviderResult(request, { ...sandbox, remoteAccountId: '001-WRONG' })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['remoteAccountId_mismatch'] });
    expect(validateV2DocumentProviderResult(request, { ...sandbox, attachmentStatus: 'reconciliation_required' as const })).toMatchObject({ accepted: false, status: 'reconciliation_required' });
    expect(validateV2DocumentProviderResult(request, { ...sandbox, documentId: randomUUID() })).toMatchObject({ accepted: false, status: 'reconciliation_required', reasons: ['documentId_mismatch'] });
    expect(validateV2DocumentProviderResult(request, sandbox)).toMatchObject({ accepted: true, stageCompletionEligible: true, status: 'provider_record_verified' });
  });
});

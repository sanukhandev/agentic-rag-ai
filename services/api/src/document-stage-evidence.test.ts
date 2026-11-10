import { describe, expect, it } from 'vitest';
import { requiredDocumentSetComplete, requiredSf02DocumentSetComplete } from './document-stage-evidence.js';
import { randomUUID } from 'node:crypto';
import { v2DocumentProviderRequestSchema, DeterministicV2DocumentProvider } from './conversation/document-provider.js';
import type { SupportingDocument } from './types.js';

const scope = { tenantId: 'tenant-a', sessionId: 'session-a', opportunityId: 'opportunity-a', intentKey: 'anc.company_formation', catalogVersionId: 'catalog-a' };
const document = (type: string, status: SupportingDocument['status'] = 'completed'): SupportingDocument => ({
  id: type, ...scope, leadId: null, fileName: type + '.pdf', mimeType: 'application/pdf',
  sizeBytes: 120, sha256: 'f'.repeat(64), requirementKey: type, expectedDocumentType: type,
  storageKey: type, status, workflowKey: 'mock-ocr', storeExtractedText: false,
  extractedText: null, summary: null, errorCode: null, consentAt: new Date().toISOString(),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

describe('Stage 5 required document set completion', () => {
  it('requires every distinct package document to be processed', () => {
    const passport = document('passport');
    const license = document('trade_license');
    expect(requiredDocumentSetComplete(['passport', 'trade_license'], [passport], scope)).toBe(false);
    expect(requiredDocumentSetComplete(['passport', 'trade_license'], [passport, { ...license, status: 'processing' }], scope)).toBe(false);
    expect(requiredDocumentSetComplete(['passport', 'trade_license'], [passport, license], scope)).toBe(true);
  });
  it('rejects cross-tenant, session, opportunity, intent and catalog document substitution', () => {
    const types = ['passport'];
    for (const key of ['tenantId', 'sessionId', 'opportunityId', 'intentKey', 'catalogVersionId'] as const) {
      expect(requiredDocumentSetComplete(types, [{ ...document('passport'), [key]: 'wrong' }], scope)).toBe(false);
    }
  });
  it('requires trusted SF-02 readback on every required document and Lead/Account attachment', () => {
    const scoped = { tenantId: randomUUID(), sessionId: randomUUID(), opportunityId: randomUUID(),
      catalogVersionId: randomUUID(), intentKey: 'anc.company_formation' };
    const leadId = randomUUID();
    const upload = { ...document('passport'), ...scoped, id: randomUUID(), leadId };
    const request = v2DocumentProviderRequestSchema.parse({
      schemaVersion: 2, operation: 'document.attach_sf02', providerType: 'deterministic_mock',
      tenantId: scoped.tenantId, sessionId: scoped.sessionId, opportunityId: scoped.opportunityId,
      catalogVersionId: scoped.catalogVersionId, documentId: upload.id, leadId,
      documentSha256: upload.sha256, remoteAccountId: 'mock-account-12345',
      remoteContactId: 'mock-contact-12345', remoteOpportunityId: 'mock-opportunity-12345',
      payloadRef: upload.id, idempotencyKey: 'sf02-dedupe-key', ocrStatus: 'completed',
      reviewStatus: 'completed', uploadConsentAt: upload.consentAt,
    });
    const result = new DeterministicV2DocumentProvider().execute(request);
    const readback = { tenantId: request.tenantId, sessionId: request.sessionId,
      opportunityId: request.opportunityId, idempotencyKey: request.idempotencyKey,
      providerType: request.providerType, recordRef: result.attachmentId,
      evidenceTier: 'mock_verified' as const, verificationStatus: 'verified' as const };
    expect(requiredSf02DocumentSetComplete(['passport'], [upload], scoped, [])).toBe(false);
    expect(requiredSf02DocumentSetComplete(['passport'], [upload], scoped, [{ request, result, readback }])).toBe(true);
    expect(requiredSf02DocumentSetComplete(['passport'], [upload], scoped,
      [{ request, result, readback: { ...readback, opportunityId: randomUUID() } }])).toBe(false);
    expect(requiredSf02DocumentSetComplete(['passport'], [upload], scoped,
      [{ request, result: { ...result, leadAttachmentId: '' }, readback }])).toBe(false);
  });
  it('never interprets an empty or duplicate requirements list as completed', () => {
    expect(requiredDocumentSetComplete([], [document('passport')], scope)).toBe(false);
    expect(requiredDocumentSetComplete(['passport', 'passport'], [document('passport')], scope)).toBe(false);
  });
});

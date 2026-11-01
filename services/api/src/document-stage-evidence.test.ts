import { describe, expect, it } from 'vitest';
import { requiredDocumentSetComplete } from './document-stage-evidence.js';
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
  it('never interprets an empty or duplicate requirements list as completed', () => {
    expect(requiredDocumentSetComplete([], [document('passport')], scope)).toBe(false);
    expect(requiredDocumentSetComplete(['passport', 'passport'], [document('passport')], scope)).toBe(false);
  });
});

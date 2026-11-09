import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeAdminDocumentDetails, composeDocumentSummary, documentSha256, hasSupportingDocumentSignature, normalizeCrmRequirement, PrivateDocumentStorage } from './document-intake.js';
import type { CrmLead, SupportingDocument } from './types.js';

const lead: CrmLead = { id: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333', sessionId: '44444444-4444-4444-8444-444444444444', intent: 'anc.license.quote', intentScore: 80, intentConfidence: 0.8, catalogVersionId: null, score: 70, validationPass: true, leadData: {}, conversation: [{ role: 'user', content: 'We need a company setup next month', createdAt: new Date().toISOString() }], summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

describe('supporting document intake', () => {
  it('normalizes requirements into concise deduplicated statements', () => {
    expect(normalizeCrmRequirement('Hello there!')).toBeNull();
    const normalized = composeDocumentSummary({ ...lead, conversation: [
      { role: 'user', content: 'Hello! I am exploring options for setting up a new company.', createdAt: new Date().toISOString() },
      { role: 'user', content: 'I am exploring options for setting up a new company!', createdAt: new Date().toISOString() },
      { role: 'user', content: 'Please help me compare packages.', createdAt: new Date().toISOString() },
    ] }, []);
    expect(normalized).toContain('Visitor requirements: I am exploring options for setting up a new company. | Help me compare packages.');
    expect(normalized.match(/exploring options for setting up a new company/giu)).toHaveLength(1);
    expect(normalized).not.toContain('Hello');
  });

  it('formats completed OCR exports for the authorized Admin boundary only', () => {
    const completed: SupportingDocument = { id: '55555555-5555-4555-8555-555555555555', tenantId: lead.tenantId, sessionId: lead.sessionId, leadId: lead.id, fileName: 'passport.jpg', mimeType: 'image/jpeg', sizeBytes: 10, sha256: 'a'.repeat(64), storageKey: `${lead.tenantId}/passport.jpg`, status: 'completed', workflowKey: 'anc.document.ocr.extract', storeExtractedText: false, extractedText: null, summary: 'Full name: [NAME_1] | Document number: [ID_1]', errorCode: null, consentAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), expectedDocumentType: 'identity_document', requirementKey: 'identity_document', opportunityId: null, catalogVersionId: null };
    const pending = { ...completed, id: '66666666-6666-4666-8666-666666666666', status: 'processing' as const, summary: 'Should not be shown' };
    const details = composeAdminDocumentDetails([completed, pending], (value) => value.replace('[NAME_1]', 'Synthetic Customer').replace('[ID_1]', 'ID-123'));
    expect(details).toContain('document type: identity_document');
    expect(details).toContain('OCR details: Full name: Synthetic Customer | Document number: ID-123');
    expect(details).not.toContain('Should not be shown');
  });

  it('validates signatures and composes a bounded metadata summary from completed OCR', () => {
    const pdf = Buffer.from('%PDF-1.7 business requirements');
    expect(hasSupportingDocumentSignature('application/pdf', pdf)).toBe(true);
    expect(hasSupportingDocumentSignature('image/png', pdf)).toBe(false);
    expect(documentSha256(pdf)).toHaveLength(64);
    const document: SupportingDocument = { id: '55555555-5555-4555-8555-555555555555', tenantId: lead.tenantId, sessionId: lead.sessionId, leadId: lead.id, fileName: 'requirements.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: documentSha256(pdf), storageKey: `${lead.tenantId}/55555555-5555-4555-8555-555555555555.pdf`, status: 'completed', workflowKey: 'anc.document.ocr.extract', storeExtractedText: true, extractedText: '[EMAIL_1]', summary: 'OCR extracted business requirements', errorCode: null, consentAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const summary = composeDocumentSummary(lead, [document]);
    expect(summary).toContain('Supporting documents: document type: document; status: completed');
    expect(summary).not.toContain('requirements.pdf');
    expect(summary).not.toContain('OCR extracted business requirements');
  });

  it('keeps files private and rejects traversal keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-documents-'));
    const storage = new PrivateDocumentStorage(root);
    const key = storage.key(lead.tenantId, '55555555-5555-4555-8555-555555555555', 'application/pdf');
    try {
      await storage.write(key, Buffer.from('%PDF-1.7 private'));
      expect(await storage.read(key)).toEqual(Buffer.from('%PDF-1.7 private'));
      await expect(storage.write('../escape', Buffer.from('x'))).rejects.toThrow();
      await storage.purge(key);
      expect(await storage.read(key)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

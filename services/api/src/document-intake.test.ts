import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeDocumentSummary, documentSha256, hasSupportingDocumentSignature, PrivateDocumentStorage } from './document-intake.js';
import type { CrmLead, SupportingDocument } from './types.js';

const lead: CrmLead = { id: '11111111-1111-4111-8111-111111111111', tenantId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333', sessionId: '44444444-4444-4444-8444-444444444444', intent: 'anc.license.quote', intentScore: 80, intentConfidence: 0.8, catalogVersionId: null, score: 70, validationPass: true, leadData: {}, conversation: [{ role: 'user', content: 'We need a company setup next month', createdAt: new Date().toISOString() }], summary: null, summaryStatus: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

describe('supporting document intake', () => {
  it('validates signatures and composes a bounded summary from completed OCR', () => {
    const pdf = Buffer.from('%PDF-1.7 business requirements');
    expect(hasSupportingDocumentSignature('application/pdf', pdf)).toBe(true);
    expect(hasSupportingDocumentSignature('image/png', pdf)).toBe(false);
    expect(documentSha256(pdf)).toHaveLength(64);
    const document: SupportingDocument = { id: '55555555-5555-4555-8555-555555555555', tenantId: lead.tenantId, sessionId: lead.sessionId, leadId: lead.id, fileName: 'requirements.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: documentSha256(pdf), storageKey: `${lead.tenantId}/55555555-5555-4555-8555-555555555555.pdf`, status: 'completed', workflowKey: 'anc.document.ocr.extract', storeExtractedText: true, extractedText: '[EMAIL_1]', summary: 'OCR extracted business requirements', errorCode: null, consentAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(composeDocumentSummary(lead, [document])).toContain('Supporting documents: requirements.pdf: OCR extracted business requirements');
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

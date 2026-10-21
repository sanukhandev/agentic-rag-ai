import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryStore } from './store-memory.js';

describe('supporting document API', () => {
  it('requires consent, queues one idempotent job, and persists an OCR callback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-document-api-'));
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANC Test', slug: 'anc-test' });
    const catalog = { tenantScope: 'anc-test', intents: [{ intentKey: 'anc.document.supporting_upload', displayName: 'Upload a document', description: 'supporting document', category: 'support', workflowKey: 'anc.document.ocr.extract', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: true, active: true, priority: 1, versionNote: '' }], signals: [], slots: [], relations: [], qualityRules: [], workflowBindings: [{ workflowKey: 'anc.document.ocr.extract', n8nWorkflowId: 'ocr-test', webhookPath: 'anc-test-document-ocr-wf-1', payloadContract: 'anc-document-ocr-v1', sideEffectClass: 'document_processing', active: true }], documentSettings: { schemaVersion: 'anc-document-policy-v1', enabled: true, storageBackend: 'local_private_volume', processingProvider: 'python_pytesseract', workflowKey: 'anc.document.ocr.extract', requireUploadConsent: true, maxFileBytes: 15 * 1024 * 1024, maxFilesPerRequest: 1, maxPdfPages: 20, ocrLanguages: ['eng'], allowedMimeTypes: ['application/pdf'], retentionPolicy: 'tenant_configured', allowPublicDocumentUrls: false, allowAutomaticKnowledgeIngestion: false, allowPersonalIdentityDocumentsByDefault: false, summaryRendering: 'conversation_plus_redacted_document_excerpts', notes: '' }, documentPolicies: [{ intentKey: 'anc.document.supporting_upload', enabled: true, workflowKey: 'anc.document.ocr.extract', requestMode: 'explicit_upload' as const, required: false, requestPromptKey: 'document.ask_supporting', allowedDocumentTypes: ['trade_license'], allowUserInitiated: true, consentRequired: true, preservePrimaryIntent: true, storeExtractedText: true, summaryTarget: 'crm_leads.summary', autoCreateLead: false, autoIndexInRag: false, notes: '' }] };
    await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'ocr.json', sourceHash: 'a'.repeat(64), parserVersion: 'test', catalog });
    const runtime = createApp({ store, nodeEnv: 'test', jwtSecret: 'document-test-secret', n8nCallbackSecret: 'document-n8n-secret', ingestionWorkerSecret: 'document-worker-secret', documentStorageRoot: root });
    const api = request(runtime.app);
    try {
      const session = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'anc-test' }).expect(201);
      const sessionId = session.body.sessionId as string;
      const contentBase64 = Buffer.from('%PDF-1.7 business requirements').toString('base64');
      await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license.pdf', mimeType: 'application/pdf', contentBase64 }).expect(422);
      const upload = await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license.pdf', mimeType: 'application/pdf', contentBase64, processingConsent: true }).expect(202);
      const duplicate = await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license-copy.pdf', mimeType: 'application/pdf', contentBase64, processingConsent: true }).expect(202);
      expect(duplicate.body.idempotent).toBe(true);
      const claimed = await api.post('/api/v1/internal/document-jobs/claim-next').set('x-ingestion-worker-secret', 'document-worker-secret').expect(200);
      expect(claimed.body.job.id).toBe(upload.body.jobId);
      const documentId = upload.body.document.id as string;
      const input = await api.get(`/api/v1/internal/document-jobs/${upload.body.jobId}/input`).set('x-ingestion-worker-secret', 'document-worker-secret').set('x-tenant-id', tenant.id).expect(200);
      expect(input.body.documentId).toBe(documentId);
      await api.post(`/api/v1/internal/document-jobs/${upload.body.jobId}/result`).set('x-ingestion-worker-secret', 'document-worker-secret').send({ tenantId: tenant.id, jobId: upload.body.jobId, extractedText: 'Business requirements', summary: 'OCR completed' }).expect(200);
      expect((await api.get(`/api/v1/chat/sessions/${sessionId}/documents`)).body.items[0].status).toBe('completed');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

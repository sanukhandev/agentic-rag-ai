import { rm, mkdtemp } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { PrivateDocumentStorage } from './document-intake.js';
import { MemoryStore } from './store-memory.js';
import type { CrmLead } from './types.js';

describe('supporting document API', () => {
  it('requires consent, queues one idempotent job, and persists an OCR callback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-document-api-'));
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANC Test', slug: 'anc-test' });
    const catalog = { tenantScope: 'anc-test', intents: [{ intentKey: 'anc.document.supporting_upload', displayName: 'Upload a document', description: 'supporting document', category: 'support', workflowKey: 'anc.document.ocr.extract', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: true, active: true, priority: 1, versionNote: '' }], signals: [], slots: [], relations: [], qualityRules: [], workflowBindings: [{ workflowKey: 'anc.document.ocr.extract', n8nWorkflowId: 'ocr-test', webhookPath: 'anc-test-document-ocr-wf-1', payloadContract: 'anc-document-ocr-v1', sideEffectClass: 'document_processing', active: true }], documentSettings: { schemaVersion: 'anc-document-policy-v1', enabled: true, storageBackend: 'local_private_volume', processingProvider: 'python_pytesseract', workflowKey: 'anc.document.ocr.extract', requireUploadConsent: true, maxFileBytes: 15 * 1024 * 1024, maxFilesPerRequest: 1, maxPdfPages: 20, ocrLanguages: ['eng'], allowedMimeTypes: ['application/pdf'], retentionPolicy: 'tenant_configured', allowPublicDocumentUrls: false, allowAutomaticKnowledgeIngestion: false, allowPersonalIdentityDocumentsByDefault: false, summaryRendering: 'conversation_plus_redacted_document_excerpts', notes: '' }, documentPolicies: [{ intentKey: 'anc.document.supporting_upload', enabled: true, workflowKey: 'anc.document.ocr.extract', requestMode: 'explicit_upload' as const, required: false, requestPromptKey: 'document.ask_supporting', allowedDocumentTypes: ['trade_license'], allowUserInitiated: true, consentRequired: true, preservePrimaryIntent: true, storeExtractedText: false, summaryTarget: 'crm_leads.summary', autoCreateLead: false, autoIndexInRag: false, notes: '' }] };
    await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'ocr.json', sourceHash: 'a'.repeat(64), parserVersion: 'test', catalog });
    const runtime = createApp({ store, nodeEnv: 'test', jwtSecret: 'document-test-secret', n8nCallbackSecret: 'document-n8n-secret', ingestionWorkerSecret: 'document-worker-secret', documentStorageRoot: root });
    const api = request(runtime.app);
    try {
      const session = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'anc-test' }).expect(201);
      const sessionId = session.body.sessionId as string;
      const timestamp = new Date().toISOString();
      const lead: CrmLead = { id: randomUUID(), tenantId: tenant.id, actionId: randomUUID(), sessionId, intent: 'anc.document.supporting_upload', intentScore: 80, intentConfidence: 0.9, catalogVersionId: null, score: 80, validationPass: true, leadData: {}, conversation: [], summary: 'Existing conversation summary', summaryStatus: 'completed', createdAt: timestamp, updatedAt: timestamp };
      await store.createCrmLead(lead);
      const contentBase64 = Buffer.from('%PDF-1.7 business requirements').toString('base64');
      await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license.pdf', mimeType: 'application/pdf', contentBase64 }).expect(422);
      const upload = await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license.pdf', mimeType: 'application/pdf', contentBase64, processingConsent: true }).expect(202);
      expect(upload.body.document.leadId).toBe(lead.id);
      const duplicate = await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license-copy.pdf', mimeType: 'application/pdf', contentBase64, processingConsent: true }).expect(202);
      expect(duplicate.body.idempotent).toBe(true);
      const scopedSession = await store.getSession(sessionId);
      scopedSession!.conversationState = { ...(scopedSession!.conversationState!), candidateIntentKeys: [...(scopedSession!.conversationState?.candidateIntentKeys ?? []), 'other.intent'] };
      await store.updateSession(scopedSession!);
      const otherScope = await api.post(`/api/v1/chat/sessions/${sessionId}/documents`).send({ fileName: 'license-other-intent.pdf', mimeType: 'application/pdf', contentBase64, processingConsent: true, primaryIntentKey: 'other.intent' }).expect(202);
      expect(otherScope.body.idempotent).not.toBe(true);
      expect((await store.listSupportingDocuments(tenant.id, sessionId))).toHaveLength(2);
      const claimed = await api.post('/api/v1/internal/document-jobs/claim-next').set('x-ingestion-worker-secret', 'document-worker-secret').expect(200);
      expect(claimed.body.job.id).toBe(upload.body.jobId);
      await api.post(`/api/v1/internal/document-jobs/${upload.body.jobId}/renew`).set('x-ingestion-worker-secret', 'document-worker-secret').send({ tenantId: tenant.id, jobId: upload.body.jobId }).expect(200);
      const documentId = upload.body.document.id as string;
      const input = await api.get(`/api/v1/internal/document-jobs/${upload.body.jobId}/input`).set('x-ingestion-worker-secret', 'document-worker-secret').set('x-tenant-id', tenant.id).expect(200);
      expect(input.body.documentId).toBe(documentId);
      await api.post(`/api/v1/internal/document-jobs/${upload.body.jobId}/result`).set('x-ingestion-worker-secret', 'document-worker-secret').send({ tenantId: tenant.id, jobId: upload.body.jobId, extractedText: 'Business requirements', summary: 'OCR completed' }).expect(200);
      const persisted = await store.getSupportingDocument(documentId, tenant.id);
      expect((await api.get(`/api/v1/chat/sessions/${sessionId}/documents`)).body.items.find((item: { id: string }) => item.id === documentId).status).toBe('completed');
      expect(persisted?.storeExtractedText).toBe(false);
      expect(persisted?.extractedText).toBeNull();
      const updatedLead = await store.getCrmLead(lead.id, tenant.id);
      expect(updatedLead?.summary).toContain('Existing conversation summary');
      expect(updatedLead?.summary).toContain('OCR completed');

      const expiredSession = await store.createSession(tenant.id);
      expiredSession.conversationState = { ...(expiredSession.conversationState!), selectedIntentKey: 'anc.document.supporting_upload', candidateIntentKeys: ['anc.document.supporting_upload'] };
      await store.updateSession(expiredSession);
      const expiredUpload = await api.post(`/api/v1/chat/sessions/${expiredSession.id}/documents`).send({ fileName: 'expired.pdf', mimeType: 'application/pdf', contentBase64, processingConsent: true }).expect(202);
      const expiredDocument = await store.getSupportingDocument(expiredUpload.body.document.id, tenant.id);
      expect(expiredDocument).not.toBeNull();
      await store.updateSession({ ...expiredSession, lastActivityAt: new Date(Date.now() - 3_600_000).toISOString() });
      const user = await store.createUser({ email: 'retention-admin@example.test', passwordHash: await runtime.auth.hashPassword('Tenant1Password'), role: 'tenant_admin', tenantId: tenant.id });
      const adminToken = await runtime.auth.issue(user);
      await api.post('/api/v1/admin/retention/purge-sessions').set('Authorization', `Bearer ${adminToken}`).send({ before: new Date(Date.now() - 60_000).toISOString() }).expect(200);
      expect(await new PrivateDocumentStorage(root).read(expiredDocument!.storageKey)).toBeNull();
      expect(await store.getSupportingDocument(expiredDocument!.id, tenant.id)).toBeNull();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

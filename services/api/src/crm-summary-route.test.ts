import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { AuthService } from './auth.js';
import { type ChatModel, type CrmSummaryInput } from './model.js';
import { MemoryStore } from './store-memory.js';
import { TokenVault } from './privacy.js';
import type { CrmLead, DocumentProcessingJob, SupportingDocument } from './types.js';

const now = (): string => new Date().toISOString();

const leadFor = (tenantId: string, sessionId: string, summary: string | null): CrmLead => ({
  id: randomUUID(), tenantId, actionId: randomUUID(), sessionId, intent: 'anc.company_formation',
  secondaryIntentKeys: [], intentScore: 90, intentConfidence: 0.9, catalogVersionId: null,
  score: 90, contactCompletenessScore: 100, validationPass: true, qualificationStatus: 'qualified',
  qualificationEvidence: {}, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' },
  conversation: [{ role: 'user', content: 'I want to start a company.', createdAt: now() }],
  summary, summaryStatus: summary ? 'completed' : 'pending', leadId: '00Q-SYNTHETIC', remoteCrm: 'deterministic_mock',
  createdAt: now(), updatedAt: now(),
});

const documentFor = (tenantId: string, sessionId: string, leadId: string): SupportingDocument => ({
  id: randomUUID(), tenantId, sessionId, leadId, opportunityId: null, intentKey: 'anc.company_formation',
  catalogVersionId: null, fileName: 'Passport-Front-Page.jpg', mimeType: 'image/jpeg', sizeBytes: 16,
  sha256: 'a'.repeat(64), requirementKey: 'identity_document', expectedDocumentType: 'identity_document',
  storageKey: `${tenantId}/${randomUUID()}.jpg`, status: 'processing', workflowKey: 'anc.document.ocr.extract',
  storeExtractedText: false, extractedText: null, summary: null, errorCode: null, consentAt: now(), createdAt: now(), updatedAt: now(),
});

const jobFor = (tenantId: string, documentId: string): DocumentProcessingJob => ({
  id: randomUUID(), documentId, tenantId, workflowKey: 'anc.document.ocr.extract', webhookPath: 'anc-test-document-ocr-wf-1',
  status: 'processing', attempts: 1, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), executionReference: null, createdAt: now(), updatedAt: now(),
});

async function fixture(summaryModel?: Pick<ChatModel, 'summarize'>) {
  const store = new MemoryStore();
  const tokenVault = new TokenVault('crm-summary-route-test-secret');
  const auth = new AuthService(store, 'crm-summary-route-jwt-secret');
  const runtime = createApp({
    store, tokenVault, jwtSecret: 'crm-summary-route-jwt-secret', nodeEnv: 'test',
    ingestionWorkerSecret: 'i'.repeat(64), n8nCallbackSecret: 'n'.repeat(64),
    ...(summaryModel ? { summaryModel } : {}),
  });
  const tenant = await store.createTenant({ name: 'CRM Summary Test', slug: `crm-summary-${randomUUID()}` });
  const user = await store.createUser({ email: `summary-${randomUUID()}@example.test`, passwordHash: 'test', role: 'tenant_admin', tenantId: tenant.id });
  const authToken = await auth.issue(user);
  const session = await store.createSession(tenant.id);
  tokenVault.save(session, [
    { token: '[NAME_1]', value: 'Synthetic Customer' },
    { token: '[EMAIL_1]', value: 'synthetic@example.test' },
    { token: '[PHONE_1]', value: '+971501234567' },
  ]);
  await store.updateSession(session);
  const lead = await store.createCrmLead(leadFor(tenant.id, session.id, null));
  return { store, tokenVault, runtime, tenant, session, lead, authToken };
}

describe('CRM AI summary route', () => {
  it('persists OCR-created tokens before the Admin summary reads the lead', async () => {
    const test = await fixture({ summarize: async ({ maskedSummary }) => maskedSummary });
    const document = documentFor(test.tenant.id, test.session.id, test.lead.id);
    const job = jobFor(test.tenant.id, document.id);
    await test.store.createSupportingDocumentWithJob(document, job);

    const result = await request(test.runtime.app)
      .post(`/api/v1/internal/document-jobs/${job.id}/result`)
      .set('x-ingestion-worker-secret', 'i'.repeat(64))
      .send({ tenantId: test.tenant.id, jobId: job.id, summary: 'Passport-Front-Page.jpg SECRET-OCR-NAME +971501111111', executionReference: 'synthetic-ocr' });

    expect(result.status, JSON.stringify(result.body)).toBe(200);
    const persistedSession = await test.store.getSession(test.session.id);
    expect(persistedSession?.tokenMap.has('[ID_1]')).toBe(true);
    expect(persistedSession?.tokenMap.has('[PHONE_2]')).toBe(true);

    const summary = await request(test.runtime.app)
      .post(`/api/v1/admin/crm/leads/${test.lead.id}/summarize`)
      .set('Authorization', `Bearer ${test.authToken}`)
      .send({});

    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(summary.body).toMatchObject({ aiGenerated: true });
    expect(summary.body.lead.summary).toContain('SECRET-OCR-NAME');
    expect(summary.body.lead.summary).toContain('+971501111111');
  });

  it('maps an unsafe persisted summary to a typed error instead of a generic 500', async () => {
    const test = await fixture();
    await test.store.updateCrmLeadSummary(test.lead.id, test.tenant.id, 'Intent: anc.company_formation\nContact: [EMAIL_99]', 'completed');
    const response = await request(test.runtime.app)
      .post(`/api/v1/admin/crm/leads/${test.lead.id}/summarize`)
      .set('Authorization', `Bearer ${test.authToken}`)
      .send({});

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('CRM_SUMMARY_AI_UNAVAILABLE');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('rebuilds legacy OCR-backed summaries from safe current state', async () => {
    const test = await fixture({ summarize: async ({ maskedSummary }) => maskedSummary });
    const document = { ...documentFor(test.tenant.id, test.session.id, test.lead.id), status: 'completed' as const, summary: 'Legacy OCR [ID_1] [PHONE_2]' };
    const job = jobFor(test.tenant.id, document.id);
    await test.store.createSupportingDocumentWithJob(document, job);
    await test.store.updateCrmLeadSummary(test.lead.id, test.tenant.id, 'Legacy OCR [ID_1] [PHONE_2]', 'completed');

    const response = await request(test.runtime.app)
      .post(`/api/v1/admin/crm/leads/${test.lead.id}/summarize`)
      .set('Authorization', `Bearer ${test.authToken}`)
      .send({});

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.lead.summary).toContain('document type: identity_document');
    expect(response.body.lead.summary).not.toContain('[PHONE_2]');
  });

  it('keeps OCR details out of the model while adding a clean Admin summary section', async () => {
    let modelInput: CrmSummaryInput | null = null;
    const test = await fixture({ summarize: async (input) => { modelInput = input; return input.maskedSummary; } });
    const document = { ...documentFor(test.tenant.id, test.session.id, test.lead.id), status: 'completed' as const, summary: 'Full name: [NAME_1] | Document number: [ID_1] | Legacy field: [PHONE_99]' };
    const job = jobFor(test.tenant.id, document.id);
    await test.store.createSupportingDocumentWithJob(document, job);

    const response = await request(test.runtime.app)
      .post(`/api/v1/admin/crm/leads/${test.lead.id}/summarize`)
      .set('Authorization', `Bearer ${test.authToken}`)
      .send({});

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(modelInput).not.toBeNull();
    const capturedModelInput = modelInput as unknown as CrmSummaryInput;
    expect(capturedModelInput.maskedSummary).not.toContain('Full name:');
    expect(response.body.lead.summary).toContain('Supporting Documents');
    expect(response.body.lead.summary).toContain('Full name: Synthetic Customer');
    expect(response.body.lead.summary).toContain('[REDACTED]');
    expect(response.body.lead.summary).not.toContain('[PHONE_99]');
    const persisted = await test.store.getCrmLead(test.lead.id, test.tenant.id);
    expect(persisted?.summary).not.toContain('Full name:');
    expect(persisted?.summary).not.toContain('Legacy field:');
  });
});

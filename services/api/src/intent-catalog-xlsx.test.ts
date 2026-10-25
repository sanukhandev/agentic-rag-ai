import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import type { IntentCatalog } from './types.js';

describe('published intent catalog Excel export', () => {
  it('exports the selected tenant published version and keeps optional policy data', async () => {
    const runtime = createApp({ nodeEnv: 'test' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-export@example.test', password: 'Platform1Password' }).expect(201);
    const tenant = await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Export Tenant', slug: 'export-tenant', adminEmail: 'admin-export@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    const admin = await api.post('/api/v1/auth/login').send({ email: 'admin-export@example.test', password: 'TenantA1Password' }).expect(200);
    const catalog: IntentCatalog = {
      tenantScope: tenant.body.tenant.slug,
      intents: [{ intentKey: 'company.setup', displayName: 'Set up a company', description: 'Company formation request.', category: 'service', workflowKey: 'crm.lead.create', minimumScore: 70, confidenceThreshold: 0.8, confirmationRequired: true, active: true, priority: 100, versionNote: '' }],
      signals: [{ intentKey: 'company.setup', signalId: 'company-start', signalType: 'phrase', value: 'start a company', language: 'en', matchMode: 'contains', weight: 60, relationGroup: null, notes: '' }],
      slots: [{ intentKey: 'company.setup', slotKey: 'name', dataType: 'person_name', required: true, alternativeGroup: null, collectionOrder: 1, promptKey: 'lead.ask_name', validationRule: 'token:NAME', retentionClass: 'pii' }],
      relations: [],
      workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId: 'workflow-export', webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }],
      documentPolicies: [{ intentKey: 'company.setup', enabled: true, workflowKey: 'document.intake', requestMode: 'conditional_offer', required: false, requestPromptKey: 'document.ask_passport', allowedDocumentTypes: ['passport'], allowUserInitiated: true, consentRequired: true, preservePrimaryIntent: true, storeExtractedText: false, summaryTarget: 'crm_leads.summary', autoCreateLead: false, autoIndexInRag: false, notes: '' }],
      documentSettings: { schemaVersion: 'document-v1', enabled: true, storageBackend: 'private', processingProvider: 'tesseract', workflowKey: 'document.intake', requireUploadConsent: true, maxFileBytes: 10_000_000, maxFilesPerRequest: 1, maxPdfPages: 10, ocrLanguages: ['eng'], allowedMimeTypes: ['image/jpeg'], retentionPolicy: 'tenant_configured', allowPublicDocumentUrls: false, allowAutomaticKnowledgeIngestion: false, allowPersonalIdentityDocumentsByDefault: false, summaryRendering: 'redacted', notes: '' },
    };
    const version = await runtime.store.createIntentCatalogVersion({ tenantId: tenant.body.tenant.id, status: 'published', sourceFileName: 'catalog.xlsx', sourceHash: 'a'.repeat(64), parserVersion: 'test', catalog });

    const response = await api.get('/api/v1/admin/intent-catalog/published/export')
      .set('Authorization', `Bearer ${admin.body.token}`)
      .buffer(true)
      .parse((stream, callback) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.subarray(0, 2).toString('ascii')).toBe('PK');
    expect(response.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(response.headers['content-disposition']).toContain(`export-tenant-intent-catalog-v${version.version}.xlsx`);
    expect((await runtime.store.listAudit(tenant.body.tenant.id)).some((event) => event.eventName === 'intent_catalog.exported')).toBe(true);
  });
});

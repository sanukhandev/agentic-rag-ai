import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MockWorkflowAdapter } from './actions.js';

describe('published intent catalog runtime', () => {
  it('routes a scored lead intent to its approved workflow and preserves catalog metadata', async () => {
    const workflow = new MockWorkflowAdapter();
    const runtime = createApp({ nodeEnv: 'test', workflow, n8nCallbackSecret: 'crm-secret' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-catalog@example.test', password: 'Platform1Password' }).expect(201);
    const tenant = await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Catalog Tenant', slug: 'catalog-tenant', adminEmail: 'admin-catalog@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    const admin = await api.post('/api/v1/auth/login').send({ email: 'admin-catalog@example.test', password: 'TenantA1Password' }).expect(200);
    const version = await runtime.store.createIntentCatalogVersion({
      tenantId: tenant.body.tenant.id,
      status: 'draft',
      sourceFileName: 'catalog.xlsx',
      sourceHash: 'a'.repeat(64),
      parserVersion: 'test',
      catalog: {
        tenantScope: 'catalog-tenant',
        intents: [{ intentKey: 'lead.capture', displayName: 'Request a service', description: 'Capture a qualified lead', category: 'sales', workflowKey: 'crm.lead.create', minimumScore: 70, confidenceThreshold: 0.8, confirmationRequired: true, active: true, priority: 100, versionNote: '' }],
        signals: [{ intentKey: 'lead.capture', signalId: 'demo', signalType: 'phrase', value: 'need a demo', language: 'en', matchMode: 'contains', weight: 50, relationGroup: null, notes: '' }],
        slots: [{ intentKey: 'lead.capture', slotKey: 'name', dataType: 'person_name', required: true, alternativeGroup: null, collectionOrder: 1, promptKey: 'lead.ask_name', validationRule: 'token:NAME', retentionClass: 'pii' }, { intentKey: 'lead.capture', slotKey: 'email', dataType: 'email', required: false, alternativeGroup: 'contact', collectionOrder: 2, promptKey: 'lead.ask_contact', validationRule: 'token:EMAIL', retentionClass: 'pii' }],
        relations: [],
        workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId: 'demo', webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }]
      }
    });
    await api.post(`/api/v1/admin/intent-catalog/versions/${version.id}/publish`).set('Authorization', `Bearer ${admin.body.token}`).expect(200);
    const session = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const proposal = await api.post('/api/v1/chat/messages').send({ sessionId: session.body.sessionId, message: 'I need a demo. My name is Alice and my email is alice@example.com.', clientMessageId: 'catalog-lead-1' }).expect(200);
    expect(proposal.body.actionProposal).toMatchObject({ intent: 'crm.lead.create' });
    const confirmed = await api.post(`/api/v1/chat/actions/${proposal.body.actionProposal.id}/confirm`).send({ sessionId: session.body.sessionId, confirmed: true }).expect(200);
    expect(confirmed.body.action.state).toBe('completed');
    expect(workflow.calls[0]).toMatchObject({ workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', leadContext: { intent: 'lead.capture', catalogVersionId: version.id } });
    expect(workflow.calls[0]?.leadContext?.intentScore).toBeGreaterThanOrEqual(70);
  });
});

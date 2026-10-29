import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('verified Account conversion callback', () => {
  it('requires the authorized action and accepts remote IDs only once', async () => {
    const runtime = createApp({ nodeEnv: 'test', n8nCallbackSecret: 'account-secret' });
    const tenant = await runtime.store.createTenant({ name: 'Account API Tenant', slug: 'account-api-tenant' });
    const session = await runtime.store.createSession(tenant.id);
    const opportunityId = '00000000-0000-4000-8000-000000000021';
    const actionId = '00000000-0000-4000-8000-000000000022';
    const leadId = '00000000-0000-4000-8000-000000000023';
    const accountId = '00000000-0000-4000-8000-000000000024';
    await runtime.store.createAction({ id: actionId, tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.account.convert', intentKey: 'account.registration', opportunityId, actionKey: 'account.registration', actionRevision: 1, state: 'processing', idempotencyKey: 'account-api-action', opaqueReference: 'account-api-ref', payload: { contactConsent: true, slotValues: { crmAccountId: accountId } }, createdAt: new Date().toISOString(), result: null });
    await runtime.store.createCrmLead({ id: leadId, tenantId: tenant.id, actionId: '00000000-0000-4000-8000-000000000025', sessionId: session.id, intent: 'anc.setup.new_company', intentScore: 90, intentConfidence: 0.9, catalogVersionId: null, score: 90, validationPass: true, leadData: {}, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SANDBOX-API', remoteCrm: 'salesforce-sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await runtime.store.createCrmAccount({ id: accountId, tenantId: tenant.id, opportunityId, leadId, remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null, status: 'pending', conversionRule: 'package_confirmed', verifiedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const api = request(runtime.app);
    const payload = await api.post(`/api/v1/internal/crm/accounts/${accountId}/remote-payload`).set('x-agentic-internal-secret', 'account-secret').send({ tenantId: tenant.id, actionId }).expect(200);
    expect(payload.body).toMatchObject({ accountId, opportunityId, remoteLeadId: '00Q-SANDBOX-API' });
    await api.put(`/api/v1/internal/crm/accounts/${accountId}/remote`).set('x-agentic-internal-secret', 'account-secret').send({ tenantId: tenant.id, actionId, remoteAccountId: '001-SANDBOX-API', remoteContactId: '003-SANDBOX-API', remoteOpportunityId: '006-SANDBOX-API' }).expect(200);
    expect((await runtime.store.getCrmAccount(accountId, tenant.id))?.status).toBe('verified');
    await api.put(`/api/v1/internal/crm/accounts/${accountId}/remote`).set('x-agentic-internal-secret', 'account-secret').send({ tenantId: tenant.id, actionId, remoteAccountId: '001-SANDBOX-API-RETRY', remoteContactId: '003-SANDBOX-API-RETRY', remoteOpportunityId: '006-SANDBOX-API-RETRY' }).expect(409);
  });
});

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MemoryStore } from './store-memory.js';
import type { ActionRequest, CrmLead } from './types.js';

describe('CRM identity reconciliation', () => {
  it('requeues only an unlinked reconciliation-required action with its original idempotency key', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Retry tenant', slug: `retry-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const action: ActionRequest = { id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'anc.crm.lead.capture', intentKey: 'company.setup', state: 'reconcile_required', idempotencyKey: 'original-idempotency', opaqueReference: 'original-reference', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null };
    await store.createAction(action);
    await store.createCrmLead({ id: randomUUID(), tenantId: tenant.id, actionId: action.id, sessionId: session.id, intent: 'company.setup', secondaryIntentKeys: [], intentScore: 90, intentConfidence: 0.95, catalogVersionId: null, score: 90, validationPass: true, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: 'Synthetic unlinked lead', summaryStatus: 'completed', leadId: null, remoteCrm: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const eventId = randomUUID();
    await store.recordActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: null, providerStatus: 'reconcile_required', n8nExecutionRef: '3977', eventId, correlationId: eventId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: null, outcome: { reason: 'invalid-branch' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });

    const retried = await store.retryActionAfterReconciliation({ actionId: action.id, tenantId: tenant.id, deadlineAt: new Date(Date.now() + 900_000).toISOString(), reason: 'regression-test' });
    expect(retried?.action).toMatchObject({ id: action.id, state: 'approved', idempotencyKey: action.idempotencyKey });
    expect(retried?.event.actionId).toBe(action.id);
    expect((await store.getActionExecution(action.id, tenant.id))?.providerStatus).toBe('dispatching');
    expect((await store.getActionExecution(action.id, tenant.id))?.attempt).toBe(1);
    const retryClaim = await store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: null, providerStatus: 'dispatching', n8nExecutionRef: null, eventId: retried!.event.eventId, correlationId: retried!.event.correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 900_000).toISOString(), outcome: { eventId: retried!.event.eventId, correlationId: retried!.event.correlationId }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect(retryClaim.claimed).toBe(true);
    const duplicateClaim = await store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: null, providerStatus: 'dispatching', n8nExecutionRef: null, eventId: retried!.event.eventId, correlationId: retried!.event.correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 900_000).toISOString(), outcome: { eventId: retried!.event.eventId, correlationId: retried!.event.correlationId }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    expect(duplicateClaim.claimed).toBe(false);
  });

  it('rejects an invalid lead route before PostgreSQL UUID parsing', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Route validation tenant', slug: `route-validation-${randomUUID()}` });
    const action: ActionRequest = { id: randomUUID(), tenantId: tenant.id, sessionId: (await store.createSession(tenant.id)).id, workflowKey: 'crm.lead.create', intentKey: 'company.setup', state: 'processing', idempotencyKey: 'invalid-route', opaqueReference: 'invalid-route-ref', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null };
    await store.createAction(action);
    const runtime = createApp({ nodeEnv: 'test', store, n8nCallbackSecret: 'internal-secret' });
    const response = await request(runtime.app).post('/api/v1/internal/crm/leads/undefined/remote-reconcile').set('x-agentic-internal-secret', 'internal-secret').send({ tenantId: tenant.id, actionId: action.id });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reuses a verified remote lead without mutating its original action or session', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Reconciliation tenant', slug: `reconcile-${randomUUID()}` });
    const originalSession = await store.createSession(tenant.id);
    const currentSession = await store.createSession(tenant.id);
    const originalAction: ActionRequest = { id: randomUUID(), tenantId: tenant.id, sessionId: originalSession.id, workflowKey: 'crm.lead.create', intentKey: 'company.setup', state: 'completed', idempotencyKey: 'original', opaqueReference: 'original-ref', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: { externalReference: 'crm-lead-original' } };
    const currentAction: ActionRequest = { id: randomUUID(), tenantId: tenant.id, sessionId: currentSession.id, workflowKey: 'crm.lead.create', intentKey: 'company.setup', state: 'processing', opportunityId: randomUUID(), idempotencyKey: 'returning-customer', opaqueReference: 'current-ref', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null };
    await store.createAction(originalAction);
    await store.createAction(currentAction);
    const lead: CrmLead = { id: randomUUID(), tenantId: tenant.id, actionId: originalAction.id, sessionId: originalSession.id, intent: 'company.setup', secondaryIntentKeys: [], intentScore: 90, intentConfidence: 0.95, catalogVersionId: null, score: 90, contactCompletenessScore: 100, validationPass: true, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: 'Verified synthetic identity', summaryStatus: 'completed', leadId: '00Q-SYNTHETIC-VERIFIED', remoteCrm: 'salesforce-sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await store.createCrmLead(lead);
    const runtime = createApp({ nodeEnv: 'test', store, n8nCallbackSecret: 'internal-secret' });
    const api = request(runtime.app);
    const payload = await api.post(`/api/v1/internal/crm/leads/${lead.id}/remote-payload`).set('x-agentic-internal-secret', 'internal-secret').send({ tenantId: tenant.id, actionId: currentAction.id }).expect(200);
    expect(payload.body).toMatchObject({ alreadyLinked: true, canonicalLeadId: lead.id, existingRemoteLeadId: lead.leadId, existingRemoteCrm: lead.remoteCrm });
    const reconciled = await api.post(`/api/v1/internal/crm/leads/${lead.id}/remote-reconcile`).set('x-agentic-internal-secret', 'internal-secret').send({ tenantId: tenant.id, actionId: currentAction.id }).expect(200);
    expect(reconciled.body).toMatchObject({ alreadyLinked: true, externalLeadId: lead.leadId, remoteCrm: lead.remoteCrm });
    expect(await store.getCrmLeadAssociationByActionId(currentAction.id, tenant.id)).toMatchObject({ crmLeadId: lead.id, sessionId: currentSession.id, opportunityId: currentAction.opportunityId, associationType: 'deduplicated' });
    expect(await store.getCrmLead(lead.id, tenant.id)).toMatchObject({ actionId: originalAction.id, sessionId: originalSession.id, leadId: lead.leadId });
  });
});

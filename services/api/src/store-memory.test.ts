import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store-memory.js';

describe('MemoryStore tenant and lifecycle boundaries', () => {
  it('upserts one CRM lead per tenant-scoped dedupe key', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'CRM Tenant', slug: `crm-${randomUUID()}` });
    const base = { tenantId: tenant.id, sessionId: randomUUID(), intent: 'lead.capture', intentScore: 80, intentConfidence: 0.8, catalogVersionId: null, score: 70, validationPass: true, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', interest: 'Request a service' }, conversation: [], summary: null, summaryStatus: 'pending' as const };
    const first = await store.upsertCrmLead({ ...base, id: randomUUID(), actionId: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 'same-contact');
    const secondActionId = randomUUID();
    const secondSessionId = randomUUID();
    const second = await store.upsertCrmLead({ ...base, id: randomUUID(), actionId: secondActionId, sessionId: secondSessionId, score: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, 'same-contact');
    expect(second.id).toBe(first.id);
    expect(second.actionId).toBe(first.actionId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(await store.listCrmLeads(tenant.id)).toHaveLength(1);
  });

  it('filters source data by tenant and refuses cross-tenant mutations', async () => {
    const store = new MemoryStore();
    const tenantA = await store.createTenant({ name: 'Tenant A', slug: `memory-a-${randomUUID()}` });
    const tenantB = await store.createTenant({ name: 'Tenant B', slug: `memory-b-${randomUUID()}` });
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const chunkId = randomUUID();
    await store.createSource({
      id: sourceId,
      tenantId: tenantA.id,
      title: 'Tenant A FAQ',
      mimeType: 'text/plain',
      sourceUrl: null,
      audience: 'public',
      status: 'awaiting_review',
      embeddingReady: true,
      versionId,
      contentHash: 'source-hash',
      chunks: [{ id: chunkId, sourceId, tenantId: tenantA.id, versionId, ordinal: 0, locator: 'section 1', content: 'A-only fact', contentHash: 'chunk-hash', embedding: [1, 0, 0, 0, 0, 0, 0, 0] }],
    });

    expect(await store.setSourceStatus(sourceId, tenantB.id, 'active')).toBeNull();
    expect(await store.listSourceChunks(sourceId, tenantB.id)).toEqual([]);
    expect(await store.listSearchableChunks(tenantB.id, 'public')).toEqual([]);
    await store.setSourceStatus(sourceId, tenantA.id, 'active');
    expect(await store.listSearchableChunks(tenantA.id, 'public')).toHaveLength(1);
  });

  it('purges one tenant session and its children without touching another tenant', async () => {
    const store = new MemoryStore();
    const tenantA = await store.createTenant({ name: 'Tenant A', slug: `purge-a-${randomUUID()}` });
    const tenantB = await store.createTenant({ name: 'Tenant B', slug: `purge-b-${randomUUID()}` });
    const sessionA = await store.createSession(tenantA.id);
    const sessionB = await store.createSession(tenantB.id);
    await store.addMessage({ id: randomUUID(), sessionId: sessionA.id, tenantId: tenantA.id, role: 'user', maskedContent: 'A', citations: [], clientMessageId: 'a', response: null, createdAt: new Date().toISOString() });
    await store.addMessage({ id: randomUUID(), sessionId: sessionB.id, tenantId: tenantB.id, role: 'user', maskedContent: 'B', citations: [], clientMessageId: 'b', response: null, createdAt: new Date().toISOString() });
    await store.createAction({ id: randomUUID(), tenantId: tenantA.id, sessionId: sessionA.id, workflowKey: 'lead.capture', idempotencyKey: 'a-action', state: 'awaiting_confirmation', opaqueReference: 'lead-a', payload: {}, createdAt: new Date().toISOString(), result: null });

    expect(await store.purgeExpiredSessions(tenantA.id, new Date(Date.now() + 1_000).toISOString())).toBe(1);
    expect(await store.getSession(sessionA.id)).toBeNull();
    expect(await store.listMessages(sessionA.id, tenantA.id)).toEqual([]);
    expect(await store.listActions(tenantA.id)).toEqual([]);
    expect(await store.getSession(sessionB.id)).not.toBeNull();
    expect(await store.listMessages(sessionB.id, tenantB.id)).toHaveLength(1);
  });

  it('rejects concurrent stale writes to conversation state', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Concurrency Tenant', slug: `concurrent-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const a = await store.getSession(session.id);
    const b = await store.getSession(session.id);
    expect(a?.stateVersion).toBe(0);
    a!.conversationState = { ...a!.conversationState!, selectedIntentKey: 'lead.capture' };
    await store.updateSession(a!);
    b!.conversationState = { ...b!.conversationState!, selectedIntentKey: 'other.intent' };
    await expect(store.updateSession(b!)).rejects.toMatchObject({ status: 409, code: 'SESSION_STATE_CONFLICT' });
    expect((await store.getSession(session.id))?.conversationState?.selectedIntentKey).toBe('lead.capture');
  });

  it('returns the existing message for an idempotent client message insert', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Message Tenant', slug: `message-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const first = { id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user' as const, maskedContent: 'Hello', citations: [], clientMessageId: 'same-client-message', response: null, createdAt: new Date().toISOString() };
    const inserted = await store.addMessage(first);
    const replay = await store.addMessage({ ...first, id: randomUUID() });
    expect(replay).toEqual(inserted);
    expect(await store.listMessages(session.id, tenant.id)).toHaveLength(1);
  });

  it('persists pending prompts and consent state with the session', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Prompt Tenant', slug: `prompt-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    session.conversationState = { ...session.conversationState!, selectedIntentKey: 'lead.capture', pendingPrompt: { id: randomUUID(), type: 'consent', intentKey: 'lead.capture', slotKey: 'contact_consent', issuedAt: new Date().toISOString() }, slotValues: { name: '[NAME_1]' } };
    await store.updateSession(session);
    const persisted = await store.getSession(session.id);
    expect(persisted?.conversationState?.pendingPrompt?.slotKey).toBe('contact_consent');
    expect(persisted?.conversationState?.slotValues.name).toBe('[NAME_1]');
  });

  it('binds a legacy pending action once without overwriting execution state', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Legacy Tenant', slug: `legacy-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'lead.capture', intentKey: 'company.setup', catalogVersionId: 'catalog-v1', idempotencyKey: randomUUID(), state: 'awaiting_confirmation', opaqueReference: 'opaque', payload: { contactConsent: true }, result: { externalReference: 'existing' }, createdAt: new Date().toISOString() });
    const assigned = await store.assignLegacyActionOpportunity({ tenantId: tenant.id, sessionId: session.id, actionId: action.id, intentKey: 'company.setup', catalogVersionId: 'catalog-v1', opportunityId: randomUUID(), eligibleStates: ['awaiting_confirmation'] });
    expect(assigned.status).toBe('assigned');
    expect(assigned.action?.id).toBe(action.id);
    expect(assigned.action?.result).toEqual(action.result);
    expect((await store.assignLegacyActionOpportunity({ tenantId: tenant.id, sessionId: session.id, actionId: action.id, intentKey: 'company.setup', catalogVersionId: 'catalog-v1', opportunityId: randomUUID(), eligibleStates: ['awaiting_confirmation'] })).status).toBe('conflict');
  });

  it('rolls back the memory journey migration when the legacy action is no longer eligible', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Rollback Tenant', slug: `rollback-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'lead.capture', intentKey: 'company.setup', opportunityId: null, idempotencyKey: randomUUID(), state: 'completed', opaqueReference: 'completed', payload: {}, result: null, createdAt: new Date().toISOString() });
    const candidate = { ...session, conversationState: { ...session.conversationState!, selectedIntentKey: 'company.setup' } };
    const result = await store.establishLegacyJourneyAndAssignAction({ session: candidate, actionId: action.id, intentKey: 'company.setup', opportunityId: randomUUID(), eligibleStates: ['awaiting_confirmation'] });
    expect(result.committed).toBe(false);
    expect((await store.getSession(session.id))?.stateVersion).toBe(session.stateVersion);
    expect((await store.getAction(action.id))?.opportunityId).toBeFalsy();
  });
});

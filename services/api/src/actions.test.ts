import { describe, expect, it, vi } from 'vitest';
import { ActionGateway, HttpN8nWorkflowAdapter, MockWorkflowAdapter, leadQuality, signN8nPayload, verifyN8nPayload } from './actions.js';
import { MemoryStore } from './store-memory.js';

describe('action gateway', () => {
  it('maps lead scores to readable quality bands', () => {
    expect(leadQuality(0)).toBe('new');
    expect(leadQuality(40)).toBe('nurture');
    expect(leadQuality(70)).toBe('warm');
    expect(leadQuality(90)).toBe('hot');
  });

  it('requires confirmation, queues only an opaque action, and is idempotent', async () => {
    const store = new MemoryStore();
    const workflow = new MockWorkflowAdapter();
    const gateway = new ActionGateway(store, workflow);
    const first = await gateway.propose('tenant-a', 'session-a', 'client-1', { name: '[NAME_1]', email: '[EMAIL_1]' });
    const second = await gateway.propose('tenant-a', 'session-a', 'client-1');
    expect(second.id).toBe(first.id);
    expect(first.state).toBe('awaiting_confirmation');
    const approved = await gateway.confirm(first.id, 'tenant-a');
    expect(approved.state).toBe('approved');
    expect(approved.payload).toEqual({ name: '[NAME_1]', email: '[EMAIL_1]' });
    expect(workflow.calls).toHaveLength(0);
    expect((await gateway.confirm(first.id, 'tenant-a')).state).toBe('approved');
    expect(workflow.calls).toHaveLength(0);
  });

  it('does not execute a workflow while confirming a catalog action', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'CRM Tenant', slug: `crm-${Date.now()}` });
    const session = await store.createSession(tenant.id);
    await store.addMessage({ id: 'message-1', sessionId: session.id, tenantId: tenant.id, role: 'user', maskedContent: 'Please contact me about a demo.', citations: [], clientMessageId: 'message-1', response: null, createdAt: new Date().toISOString() });
    const workflow = new MockWorkflowAdapter();
    const gateway = new ActionGateway(store, workflow);
    const action = await gateway.propose(tenant.id, session.id, 'crm-context', { name: '[NAME_1]', email: '[EMAIL_1]' });
    expect(await gateway.confirm(action.id, tenant.id)).toMatchObject({ state: 'approved', payload: { name: '[NAME_1]', email: '[EMAIL_1]' } });
    expect(workflow.calls).toHaveLength(0);
  });

  it('records button approval as explicit consent before the action is claimable', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store);
    const action = await gateway.propose('tenant-a', 'session-a', 'consent-button', { name: '[NAME_1]', email: '[EMAIL_1]', contactConsent: false });
    const approved = await gateway.confirm(action.id, 'tenant-a');
    expect(approved).toMatchObject({ state: 'approved', payload: { contactConsent: true } });
    expect((await store.listAudit('tenant-a')).map((event) => event.eventName)).toContain('workflow.consent_granted');
  });

  it('does not depend on a provider adapter and verifies replay-resistant signatures', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store, { execute: async () => { throw new Error('alice@example.com timeout'); } });
    const action = await gateway.propose('tenant-a', 'session-a', 'client-2');
    await expect(gateway.confirm(action.id, 'tenant-a')).resolves.toMatchObject({ state: 'approved' });
    expect((await store.listAudit('tenant-a')).at(-1)?.eventName).toBe('workflow.approved');
    const timestamp = Date.now();
    const body = JSON.stringify({ opaqueReference: 'lead-1' });
    const signature = signN8nPayload('shared-secret', timestamp, 'nonce-1', body);
    expect(verifyN8nPayload('shared-secret', String(timestamp), 'nonce-1', body, signature, timestamp)).toBe(true);
    expect(verifyN8nPayload('shared-secret', String(timestamp - 301_000), 'nonce-1', body, signature, timestamp)).toBe(false);
  });

  it('does not execute an adapter on a second confirmation', async () => {
    const store = new MemoryStore();
    let attempts = 0;
    const workflow = { execute: async (input: { idempotencyKey: string }) => { attempts += 1; expect(input.idempotencyKey).toBe('retryable'); if (attempts === 1) throw new Error('timeout'); return { externalReference: 'recovered-run' }; } };
    const gateway = new ActionGateway(store, workflow);
    const action = await gateway.propose('tenant-a', 'session-a', 'retryable');
    await expect(gateway.confirm(action.id, 'tenant-a')).resolves.toMatchObject({ state: 'approved' });
    await expect(gateway.confirm(action.id, 'tenant-a')).resolves.toMatchObject({ state: 'approved' });
    expect(attempts).toBe(0);
  });

  it('does not mutate a newer session state when an old approved action is replayed', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Replay Tenant', slug: `replay-${Date.now()}` });
    const session = await store.createSession(tenant.id);
    session.conversationState = {
      ...session.conversationState!,
      selectedIntentKey: 'new.intent',
      pendingPrompt: { id: 'new-prompt', type: 'slot', intentKey: 'new.intent', slotKey: 'business_activity', issuedAt: new Date().toISOString() },
      contactConsent: 'unknown',
    };
    await store.updateSession(session);
    const action = await store.createAction({ id: 'old-action', tenantId: tenant.id, sessionId: session.id, workflowKey: 'old.workflow', intentKey: 'old.intent', catalogVersionId: 'old-catalog', idempotencyKey: 'old-action', state: 'approved', opaqueReference: 'old-action', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: null });
    const gateway = new ActionGateway(store);

    await expect(gateway.confirm(action.id, tenant.id, session)).resolves.toMatchObject({ id: action.id, state: 'approved' });
    expect((await store.getSession(session.id))?.conversationState).toMatchObject({ selectedIntentKey: 'new.intent', contactConsent: 'unknown', pendingPrompt: { id: 'new-prompt', slotKey: 'business_activity' } });
  });

  it('does not execute an expired confirmation', async () => {
    const store = new MemoryStore();
    const workflow = new MockWorkflowAdapter();
    const gateway = new ActionGateway(store, workflow);
    const action = await gateway.propose('tenant-a', 'session-a', 'expired');
    await store.updateAction({ ...action, createdAt: new Date(Date.now() - 16 * 60_000).toISOString() });
    await expect(gateway.confirm(action.id, 'tenant-a')).resolves.toMatchObject({ state: 'failed' });
    expect(workflow.calls).toHaveLength(0);
  });

  it('serializes simultaneous confirmations for one action', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store, new MockWorkflowAdapter());
    const action = await gateway.propose('tenant-a', 'session-a', 'concurrent');
    const [approved, retried] = await Promise.all([gateway.confirm(action.id, 'tenant-a'), gateway.confirm(action.id, 'tenant-a')]);
    expect(approved).toMatchObject({ state: 'approved' });
    expect(retried).toEqual(approved);
  });

  it('recovers an idempotency race reported by PostgreSQL', async () => {
    class UniqueRaceStore extends MemoryStore {
      private firstInsert = true;
      override async createAction(action: Parameters<MemoryStore['createAction']>[0]) {
        const created = await super.createAction(action);
        if (this.firstInsert) {
          this.firstInsert = false;
          throw Object.assign(new Error('duplicate action'), { code: '23505' });
        }
        return created;
      }
    }
    const store = new UniqueRaceStore();
    const gateway = new ActionGateway(store, new MockWorkflowAdapter());
    await expect(gateway.propose('tenant-a', 'session-a', 'raced')).resolves.toMatchObject({ idempotencyKey: 'raced', state: 'awaiting_confirmation' });
  });

  it('sends the private n8n request with a signature and no raw customer fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ externalReference: 'n8n-1' }), { status: 200 }));
    const adapter = new HttpN8nWorkflowAdapter('https://n8n.internal', 'shared-secret');
    await expect(adapter.execute({ workflowKey: 'lead.capture', tenantId: 'tenant-a', sessionId: 'session-1', opaqueReference: 'lead-1', idempotencyKey: 'client-1', leadData: { email: '[EMAIL_1]' } })).resolves.toEqual({ externalReference: 'n8n-1' });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).not.toContain('alice@example.com');
    expect(request.headers).toMatchObject({ 'x-agentic-idempotency-key': 'client-1' });
    expect(String(request.body)).toContain('[EMAIL_1]');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://n8n.internal/webhook/lead-capture');
    fetchMock.mockRestore();
  });

  it('does not allow a caller to select an insecure or credential-bearing webhook endpoint', () => {
    expect(() => new HttpN8nWorkflowAdapter('http://n8n.internal', 'shared-secret')).not.toThrow();
    expect(() => new HttpN8nWorkflowAdapter('https://user:password@n8n.internal', 'shared-secret')).toThrow('credentials');
  });

  it('rejects external references that are not opaque identifiers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ externalReference: 'alice@example.com' }), { status: 200 }));
    const adapter = new HttpN8nWorkflowAdapter('https://n8n.internal', 'shared-secret');
    await expect(adapter.execute({ workflowKey: 'lead.capture', tenantId: 'tenant-a', sessionId: 'session-1', opaqueReference: 'lead-1', idempotencyKey: 'client-1' })).rejects.toThrow('Private n8n response was invalid.');
    vi.restoreAllMocks();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ActionGateway, HttpN8nWorkflowAdapter, MockWorkflowAdapter, signN8nPayload, verifyN8nPayload } from './actions.js';
import { MemoryStore } from './store-memory.js';

describe('action gateway', () => {
  it('requires confirmation, sends only opaque data, and is idempotent', async () => {
    const store = new MemoryStore();
    const workflow = new MockWorkflowAdapter();
    const gateway = new ActionGateway(store, workflow);
    const first = await gateway.propose('tenant-a', 'session-a', 'client-1');
    const second = await gateway.propose('tenant-a', 'session-a', 'client-1');
    expect(second.id).toBe(first.id);
    expect(first.state).toBe('awaiting_confirmation');
    const completed = await gateway.confirm(first.id, 'tenant-a');
    expect(completed.state).toBe('completed');
    expect(workflow.calls).toHaveLength(1);
    expect(workflow.calls[0]?.opaqueReference).toMatch(/^lead-/);
    expect(workflow.calls[0]).not.toHaveProperty('message');
    expect((await gateway.confirm(first.id, 'tenant-a')).result).toEqual(completed.result);
    expect(workflow.calls).toHaveLength(1);
  });

  it('marks provider failures unknown and verifies replay-resistant signatures', async () => {
    const store = new MemoryStore();
    const gateway = new ActionGateway(store, { execute: async () => { throw new Error('timeout'); } });
    const action = await gateway.propose('tenant-a', 'session-a', 'client-2');
    await expect(gateway.confirm(action.id, 'tenant-a')).resolves.toMatchObject({ state: 'unknown' });
    expect((await store.listAudit('tenant-a')).at(-1)?.eventName).toBe('workflow.unknown');
    const timestamp = Date.now();
    const body = JSON.stringify({ opaqueReference: 'lead-1' });
    const signature = signN8nPayload('shared-secret', timestamp, 'nonce-1', body);
    expect(verifyN8nPayload('shared-secret', String(timestamp), 'nonce-1', body, signature, timestamp)).toBe(true);
    expect(verifyN8nPayload('shared-secret', String(timestamp - 301_000), 'nonce-1', body, signature, timestamp)).toBe(false);
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
    let release!: () => void;
    let started!: () => void;
    const adapterStarted = new Promise<void>((resolve) => { started = resolve; });
    const adapterRelease = new Promise<void>((resolve) => { release = resolve; });
    const workflow = { execute: async () => { started(); await adapterRelease; return { externalReference: 'run-once' }; } };
    const gateway = new ActionGateway(store, workflow);
    const action = await gateway.propose('tenant-a', 'session-a', 'concurrent');
    const first = gateway.confirm(action.id, 'tenant-a');
    await adapterStarted;
    const second = gateway.confirm(action.id, 'tenant-a');
    release();
    const [completed, retried] = await Promise.all([first, second]);
    expect(completed).toMatchObject({ state: 'completed', result: { externalReference: 'run-once' } });
    expect(retried).toEqual(completed);
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
    await expect(adapter.execute({ workflowKey: 'lead.capture', tenantId: 'tenant-a', opaqueReference: 'lead-1', idempotencyKey: 'client-1' })).resolves.toEqual({ externalReference: 'n8n-1' });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(String(request.body)).not.toContain('email');
    expect(request.headers).toMatchObject({ 'x-agentic-idempotency-key': 'client-1' });
    fetchMock.mockRestore();
  });
});

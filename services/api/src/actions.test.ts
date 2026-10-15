import { describe, expect, it } from 'vitest';
import { ActionGateway, MockWorkflowAdapter } from './actions.js';
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
});

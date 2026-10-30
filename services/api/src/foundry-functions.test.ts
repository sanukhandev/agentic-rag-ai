import { describe, expect, it } from 'vitest';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { FoundryFunctionDispatcher, FoundryToolExecution, foundryFunctionDefinitions } from './foundry-functions.js';
import { MemoryStore } from './store-memory.js';

describe('Foundry application function dispatcher', () => {
  it('keeps the registry explicit and rejects unknown or malformed calls', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Tenant', slug: 'tenant' });
    const session = await store.createSession(tenant.id);
    const dispatcher = new FoundryFunctionDispatcher({ store, embedding: new DeterministicEmbeddingProvider() });

    expect(foundryFunctionDefinitions.map((definition) => definition.name)).toEqual(['search_knowledge', 'get_journey_state', 'get_available_packages', 'get_document_requirements', 'get_action_status']);
    await expect(dispatcher.dispatchTool({ tenantId: tenant.id, sessionId: session.id }, 'unknown_tool', {})).resolves.toMatchObject({ ok: false, errorCode: 'TOOL_NOT_AVAILABLE' });
    await expect(dispatcher.dispatchTool({ tenantId: tenant.id, sessionId: session.id }, 'get_journey_state', { sessionId: 'forged' })).resolves.toMatchObject({ ok: false, errorCode: 'TOOL_INPUT_INVALID' });
  });

  it('derives status from the trusted session and audits bounded execution', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Tenant', slug: 'tenant' });
    const session = await store.createSession(tenant.id);
    const dispatcher = new FoundryFunctionDispatcher({ store, embedding: new DeterministicEmbeddingProvider() });
    const execution = new FoundryToolExecution(dispatcher, { store, timeoutMs: 500 });
    const result = await execution.execute({ tenantId: tenant.id, sessionId: session.id }, [{ callId: 'call-1', name: 'get_journey_state', arguments: '{}' }, { callId: 'call-2', name: 'get_action_status', arguments: '{}' }]);

    expect(result).toHaveLength(2);
    expect(result[0]?.output).toMatchObject({ ok: true, data: { status: 'available' } });
    expect(result[1]?.output).toMatchObject({ ok: true, data: { status: 'not_started' } });
    expect(await store.listAudit(tenant.id)).toHaveLength(2);
  });
});

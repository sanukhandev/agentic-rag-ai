import { describe, expect, it } from 'vitest';
import { FoundryChatModelAdapter } from './chat-model-adapter.js';
import type { FoundryAgentClient } from './agent-client.js';
import { MemoryStore } from '../store-memory.js';

describe('Foundry chat model adapter', () => {
  it('creates and reuses one tenant/session conversation binding', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Tenant', slug: 'tenant' });
    const session = await store.createSession(tenant.id);
    const calls: Array<{ message: string; conversationId?: string }> = [];
    const client = { respond: async (input: { message: string; conversationId?: string }) => { calls.push(input); return { answer: 'Foundry answer', conversationId: input.conversationId ?? 'conversation-1' }; } } as unknown as FoundryAgentClient;
    const adapter = new FoundryChatModelAdapter(store, client, 'agentic-rag-core-dev', '3');
    const input = { maskedMessage: 'Email [EMAIL_1]', personaName: 'Ava', evidence: [], trustedContext: { tenantId: tenant.id, sessionId: session.id } };
    await expect(adapter.draft(input)).resolves.toMatchObject({ answer: 'Foundry answer', citationIds: [] });
    await expect(adapter.draft(input)).resolves.toMatchObject({ answer: 'Foundry answer' });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.conversationId).toBeUndefined();
    expect(calls[1]?.conversationId).toBe('conversation-1');
    expect(calls[0]?.message).toContain('[EMAIL_1]');
    expect(calls[0]?.message).not.toContain(tenant.id);
    expect(calls[0]?.message).not.toContain(session.id);
    expect((await store.getFoundryConversationBinding(tenant.id, session.id, 'agentic-rag-core-dev'))?.foundryConversationId).toBe('conversation-1');
  });
});

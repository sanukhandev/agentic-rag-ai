import { describe, expect, it } from 'vitest';
import { newConversationState } from './conversation-state.js';
import { runAgentTools } from './agent-tools.js';
import { MemoryStore } from './store-memory.js';

describe('bounded agent tool runtime', () => {
  it('keeps tool selection read-only and tenant/opportunity scoped', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc' });
    const session = await store.createSession(tenant.id);
    session.conversationState = { ...newConversationState(), selectedIntentKey: 'anc.setup.new_company', slotValues: { business_activity: 'digital marketing' }, slotProvenance: { business_activity: { source: 'visitor', messageSequence: 2, capturedAt: new Date().toISOString(), corrected: false } }, rollingSummary: 'Visitor wants a new company.' };
    const results = await runAgentTools({}, { store, session, catalog: null, opportunityId: null, maskedQuery: 'What packages and pricing are available?' });
    expect(results.map((result) => result.name)).toEqual(expect.arrayContaining(['get_active_opportunity', 'get_confirmed_customer_facts', 'get_available_packages', 'get_authoritative_pricing']));
    expect(results.find((result) => result.name === 'get_confirmed_customer_facts')?.data).toMatchObject({ facts: { business_activity: { value: 'digital marketing' } } });
    expect(results.find((result) => result.name === 'get_available_packages')).toMatchObject({ ok: true, data: { status: 'unavailable', packages: [] } });
    expect(await store.listActionsBySession(session.id, tenant.id)).toHaveLength(0);
  });

  it('rejects an LLM tool outside the allowlist and falls back to the bounded plan', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc' });
    const session = await store.createSession(tenant.id);
    const results = await runAgentTools({ plan: async () => ({ calls: [{ name: 'delete_everything', input: {} }] }) }, { store, session, catalog: null, opportunityId: null, maskedQuery: 'What is the setup timeline?' });
    expect(results.some((result) => result.name === 'search_approved_knowledge')).toBe(true);
    expect(results.some((result) => (result as { name?: string }).name === 'delete_everything')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { issueV2Scope, verifyV2Scope, V2_TOOL_NAMES } from './v2-tool-gateway.js';

const secret = 'unit-scoped-tool-secret-0123456789';
const now = Date.UTC(2026, 10, 2, 12);
const scope = {
  tenantId: 'tenant-12345678',
  sessionId: 'session-12345678',
  opportunityId: 'opportunity-12345678',
  catalogVersionId: 'catalog-12345678',
  personaVersionId: 'persona-12345678',
  stateRevision: 3,
  toolAllowlist: ['search_knowledge', 'get_journey_state'] as Array<(typeof V2_TOOL_NAMES)[number]>,
};

describe('V2 trusted tool scope (isolated unit)', () => {
  it('returns the pinned context and exact allowlist', () => {
    const token = issueV2Scope(scope, secret, now);
    expect(verifyV2Scope(token, secret, now + 1_000)).toMatchObject(scope);
  });
  it('rejects tampered and expired scope tokens', () => {
    const token = issueV2Scope(scope, secret, now);
    expect(verifyV2Scope(token, 'different-secret-0123456789', now)).toBeNull();
    expect(verifyV2Scope(token + 'x', secret, now)).toBeNull();
    expect(verifyV2Scope(token, secret, now + 300_001)).toBeNull();
  });
  it('refuses short signing keys', () => {
    expect(() => issueV2Scope(scope, 'short', now)).toThrow('V2_TOOL_SCOPE_SECRET_REQUIRED');
  });
});

import { randomUUID } from 'node:crypto';
import { MemoryStore } from './store-memory.js';
import { DeterministicEmbeddingProvider } from './embedding.js';
import { createV2ToolGateway } from './v2-tool-gateway.js';

const makeGateway = async () => {
  const store = new MemoryStore();
  const tenant = await store.createTenant({ name: 'Tool Tenant', slug: 'tool-tenant' });
  const persona = await store.createPersonaVersion({
    tenantId: tenant.id, name: 'Zara', greeting: 'Hello', personality: 'Friendly', tone: 'warm',
    speakingStyle: 'Professional', permittedLanguages: ['en'], contextWindowMessages: 8,
    voiceName: '', voiceLanguage: 'en', voiceRate: 1, voicePitch: 0, voiceVolume: 1, status: 'draft',
  });
  await store.publishPersonaVersion(tenant.id, persona.id);
  const catalog = await store.createIntentCatalogVersion({
    tenantId: tenant.id, status: 'draft', sourceFileName: 'unit.json',
    sourceHash: 'b'.repeat(64), parserVersion: 'unit',
    catalog: { tenantScope: tenant.slug, intents: [], signals: [], slots: [], relations: [], workflowBindings: [] },
  });
  await store.publishIntentCatalogVersion(tenant.id, catalog.id);
  const session = await store.createSession(tenant.id, persona.id);
  const pinned = await store.updateSession({ ...session, conversationState: { ...session.conversationState!, catalogVersionId: catalog.id } });
  const scopeRef = issueV2Scope({
    tenantId: tenant.id, sessionId: session.id, opportunityId: null,
    catalogVersionId: catalog.id, personaVersionId: persona.id,
    stateRevision: pinned.stateVersion ?? 0, toolAllowlist: [...V2_TOOL_NAMES],
  }, secret);
  const gateway = createV2ToolGateway({ store, embedding: new DeterministicEmbeddingProvider(), serviceKey: secret });
  const request = (toolName: string, args: Record<string, unknown> = {}, callId = randomUUID()) => ({
    schemaVersion: 2, toolCallId: callId, toolName, arguments: args, scopeRef,
    expectedStateRevision: pinned.stateVersion ?? 0, deadlineAt: new Date(Date.now() + 15_000).toISOString(),
  });
  return { store, tenant, persona, catalog, pinned, scopeRef, gateway, request };
};

describe('V2 trusted tool execution (isolated unit)', () => {
  it('returns correlated, bounded responses for all nine approved read tools', async () => {
    const { gateway, request, catalog } = await makeGateway();
    for (const name of V2_TOOL_NAMES) {
      const input = request(name, name === 'search_knowledge' ? { query: 'company formation', resultCount: 2 } : {});
      const output = await gateway.execute(input);
      expect(output.status, name).toBe('ok');
      expect(output.toolCallId).toBe(input.toolCallId);
      expect(output.stateRevision).toBe(input.expectedStateRevision);
      if (name === 'search_knowledge') {
        expect(output.result).toHaveProperty('grounded', false);
        expect(output.evidenceRefs).toEqual([]);
        expect(output.sourceVersion).toBeNull();
      } else if (name === 'get_persona') {
        expect(output.result).toHaveProperty('name', 'Zara');
      } else {
        expect(output.sourceVersion).toContain(catalog.id);
      }
    }
  });
  it('rechecks live session revision before returning cached tool results', async () => {
    const { store, pinned, gateway, request } = await makeGateway();
    const call = request('get_intent_catalog', {}, 'replayed-call-12345678');
    expect((await gateway.execute(call)).status).toBe('ok');
    await store.updateSession({ ...pinned, lastActivityAt: new Date().toISOString() });
    expect((await gateway.execute(call)).status).toBe('stale_state');
  });
  it('rejects tool mutations, spoofed tenant, persona drift, oversized queries, and distant deadlines', async () => {
    const { tenant, persona, catalog, pinned, gateway, request } = await makeGateway();
    expect((await gateway.execute(request('delete_customer'))).status).toBe('not_authorized');
    expect((await gateway.execute(request('search_knowledge', { query: 'x'.repeat(2001), resultCount: 2 }))).status).toBe('invalid_args');
    const scope = { tenantId: randomUUID(), sessionId: pinned.id, opportunityId: null, catalogVersionId: catalog.id,
      personaVersionId: persona.id, stateRevision: pinned.stateVersion ?? 0, toolAllowlist: ['get_persona'] as Array<(typeof V2_TOOL_NAMES)[number]> };
    expect((await gateway.execute({ ...request('get_persona'), scopeRef: issueV2Scope(scope, secret) })).status).toBe('not_authorized');
    expect((await gateway.execute({ ...request('get_persona'), scopeRef: issueV2Scope({ ...scope, tenantId: tenant.id, personaVersionId: 'wrong-persona-12345678' }, secret) })).status).toBe('stale_state');
    expect((await gateway.execute({ ...request('get_persona'), deadlineAt: new Date(Date.now() + 300_000).toISOString() })).status).toBe('temporarily_unavailable');
    expect(() => issueV2Scope({ ...scope, tenantId: tenant.id, stateRevision: -1 }, secret)).toThrow();
  });
  it('rejects altered arguments for an already-used tool call ID', async () => {
    const { gateway, request } = await makeGateway();
    const callId = 'replay-mismatch-12345678';
    expect((await gateway.execute(request('search_knowledge', { query: 'formation', resultCount: 1 }, callId))).status).toBe('ok');
    expect((await gateway.execute(request('search_knowledge', { query: 'visa', resultCount: 1 }, callId))).status).toBe('not_authorized');
  });
});

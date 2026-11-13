import { describe, expect, it } from 'vitest';
import { NodeReadToolRegistry } from '../read-tool-registry.js';
import { InvalidReadScopeError, ScopedP3ReadTools } from '../adapters/read-tool-scope.js';
import type { ConversationRepository, SessionSnapshot, TrustedActor } from '../contracts.js';
import type { CatalogV2Document } from '../catalog/catalog.js';
import type { Store } from '../../types.js';

const actor: TrustedActor = {
  tenantId: 'tenant-1', sessionId: 'session-1', principalId: 'f'.repeat(64), role: 'customer',
};
const reference: SessionSnapshot = {
  tenantId: actor.tenantId, sessionId: actor.sessionId, ownerPrincipalId: actor.principalId,
  revision: 4, personaVersionId: 'persona-1', catalogVersionId: 'catalog-1',
  personaInstructions: 'Helpful', conversationSummary: 'Hello', recentTurns: [],
  verifiedFacts: [], publishedGoalKeys: ['formation'], pendingActionStatus: [],
};
const allowedCatalog = {
  sheets: {
    BusinessGoals: [{ businessGoalKey: 'formation', active: true }],
    ToolBindings: [{ toolKey: 'knowledge.search', goalKey: 'formation', enabled: true, sideEffectClass: 'read_only' }],
  },
} as unknown as CatalogV2Document;

function makeFixture() {
  let now = 1700000000000;
  let current = reference;
  let revoked = false;
  let catalog = allowedCatalog;
  let invokeCount = 0;
  const repo = {
    async loadAuthorizedSnapshot(requested: TrustedActor) {
      if (revoked || requested.tenantId !== actor.tenantId || requested.sessionId !== actor.sessionId
        || requested.principalId !== actor.principalId) throw new Error('forbidden');
      return current;
    },
  } as unknown as ConversationRepository;
  const catalogStore = {
    async getIntentCatalogV2Version(tenantId: string, id: string) {
      return tenantId === actor.tenantId && id === reference.catalogVersionId
        ? { id, tenantId, catalog, status: 'published' }
        : null;
    },
  } as unknown as Pick<Store, 'getIntentCatalogV2Version'>;
  const registry = new NodeReadToolRegistry();
  for (const name of ['search_knowledge', 'get_conversation_summary'] as const) {
    registry.register({
      definition: { name, description: name, argumentsSchema: { type: 'object' } },
      parseInput: (v: unknown) => {
        if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0) throw new Error('invalid');
        return {};
      },
      authorize: async () => true,
      execute: async () => { invokeCount++; return { safe: true }; },
    });
  }
  const tools = new ScopedP3ReadTools('test-secret-at-least-thirty-two-bytes-long', repo, catalogStore, registry, () => now);
  return {
    tools,
    get calls() { return invokeCount; },
    setNow(value: number) { now = value; },
    revoke() { revoked = true; },
    changeRevision(value: number) { current = { ...current, revision: value }; },
    disableKnowledge() { catalog = { ...catalog, sheets: { ...catalog.sheets, ToolBindings: [] } } as CatalogV2Document; },
  };
}

describe('P3 signed, tenant/catalog/session-revision read scopes', () => {
  it('only exposes a catalog-enabled read search plus reviewed platform reads', async () => {
    const fixture = makeFixture();
    const definitions = await fixture.tools.listFor(actor, reference.catalogVersionId);
    expect(definitions.map(x => x.name).sort()).toEqual(['get_conversation_summary', 'search_knowledge']);
    fixture.disableKnowledge();
    expect((await fixture.tools.listFor(actor, reference.catalogVersionId)).map(x => x.name))
      .toEqual(['get_conversation_summary']);
  });

  it('signs a scope and executes only the listed read tool', async () => {
    const fixture = makeFixture();
    const defs = await fixture.tools.listFor(actor, reference.catalogVersionId);
    const allowed = defs.filter(x => x.name === 'get_conversation_summary');
    const token = await fixture.tools.issueBoundScope(actor, reference.catalogVersionId, allowed, reference.revision);
    const result = await fixture.tools.executeBound(token, 'get_conversation_summary', {}, new AbortController().signal);
    expect(result.status).toBe('ok');
    expect(fixture.calls).toBe(1);
    await expect(fixture.tools.executeBound(token, 'search_knowledge', {}, new AbortController().signal))
      .rejects.toBeInstanceOf(InvalidReadScopeError);
  });

  it('rejects tampering, expiration, revoked sessions and stale revisions', async () => {
    const fixture = makeFixture();
    const defs = await fixture.tools.listFor(actor, reference.catalogVersionId);
    const token = await fixture.tools.issueBoundScope(actor, reference.catalogVersionId, defs, reference.revision);
    await expect(fixture.tools.executeBound(token + 'junk', 'search_knowledge', {}, new AbortController().signal))
      .rejects.toBeInstanceOf(InvalidReadScopeError);
    fixture.setNow(1700000000000 + 120001);
    await expect(fixture.tools.executeBound(token, 'search_knowledge', {}, new AbortController().signal))
      .rejects.toBeInstanceOf(InvalidReadScopeError);
    fixture.setNow(1700000000000);
    fixture.changeRevision(5);
    await expect(fixture.tools.executeBound(token, 'search_knowledge', {}, new AbortController().signal))
      .rejects.toBeInstanceOf(InvalidReadScopeError);
    fixture.changeRevision(4);
    fixture.revoke();
    await expect(fixture.tools.executeBound(token, 'search_knowledge', {}, new AbortController().signal))
      .rejects.toThrow('forbidden');
  });

  it('cannot sign tools or a revision that was not authorized', async () => {
    const fixture = makeFixture();
    const defs = await fixture.tools.listFor(actor, reference.catalogVersionId);
    await expect(fixture.tools.issueBoundScope(actor, reference.catalogVersionId, defs, 5))
      .rejects.toBeInstanceOf(InvalidReadScopeError);
    await expect(fixture.tools.issueBoundScope(actor, reference.catalogVersionId, [
      { name: 'delete_source', description: 'forbidden', argumentsSchema: {} },
    ], 4)).rejects.toBeInstanceOf(InvalidReadScopeError);
    await expect(fixture.tools.listFor({ ...actor, tenantId: 'foreign' }, reference.catalogVersionId))
      .rejects.toThrow();
  });

  it('refuses an old scope after catalog policy revokes a search capability', async () => {
    const fixture = makeFixture();
    const defs = await fixture.tools.listFor(actor, reference.catalogVersionId);
    const token = await fixture.tools.issueBoundScope(actor, reference.catalogVersionId, defs, reference.revision);
    fixture.disableKnowledge();
    await expect(fixture.tools.executeBound(token, 'search_knowledge', {}, new AbortController().signal))
      .rejects.toBeInstanceOf(InvalidReadScopeError);
  });

  it('rejects unreasonably short HMAC secrets', () => {
    const registry = new NodeReadToolRegistry();
    expect(() => new ScopedP3ReadTools('short', {} as ConversationRepository,
      {} as Pick<Store, 'getIntentCatalogV2Version'>, registry)).toThrow('32 bytes');
  });
});

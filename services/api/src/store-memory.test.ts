import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store-memory.js';

describe('MemoryStore tenant and lifecycle boundaries', () => {
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
    await store.createAction({ id: randomUUID(), tenantId: tenantA.id, sessionId: sessionA.id, workflowKey: 'lead.capture', idempotencyKey: 'a-action', state: 'awaiting_confirmation', opaqueReference: 'lead-a', createdAt: new Date().toISOString(), result: null });

    expect(await store.purgeExpiredSessions(tenantA.id, new Date(Date.now() + 1_000).toISOString())).toBe(1);
    expect(await store.getSession(sessionA.id)).toBeNull();
    expect(await store.listMessages(sessionA.id, tenantA.id)).toEqual([]);
    expect(await store.listActions(tenantA.id)).toEqual([]);
    expect(await store.getSession(sessionB.id)).not.toBeNull();
    expect(await store.listMessages(sessionB.id, tenantB.id)).toHaveLength(1);
  });
});

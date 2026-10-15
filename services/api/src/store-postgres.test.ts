import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresStore } from './store-postgres.js';

describe.skipIf(!process.env.DATABASE_URL)('PostgresStore integration', () => {
  it('persists tenant-scoped sources, encrypted token values and durable responses', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Postgres Test', slug: `postgres-${randomUUID()}` });
    try {
      const session = await store.createSession(tenant.id);
      session.tokenMap.set('[EMAIL_1]', 'v1.ciphertext');
      await store.updateSession(session);
      expect((await store.getSession(session.id))?.tokenMap.get('[EMAIL_1]')).toBe('v1.ciphertext');
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const source = await store.createSource({ id: sourceId, tenantId: tenant.id, title: 'FAQ', mimeType: 'text/plain', sourceUrl: null, audience: 'public', status: 'awaiting_review', versionId, contentHash: 'hash', chunks: [{ id: randomUUID(), sourceId, tenantId: tenant.id, versionId, ordinal: 0, locator: 'section 1', content: 'Pricing is 100 credits.', contentHash: 'chunk-hash', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] }] });
      await store.setSourceStatus(source.id, tenant.id, 'active');
      expect((await store.listSearchableChunks(tenant.id, 'public')).length).toBe(1);
      const userMessage = await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user', maskedContent: 'What is pricing?', citations: [], clientMessageId: 'client-1', response: null, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: { answer: 'Pricing is 100 credits.' } });
      expect((await store.getMessageByClientId(session.id, 'client-1'))?.response).toMatchObject({ answer: 'Pricing is 100 credits.' });
      expect((await store.getTenantStats(tenant.id)).sourceCounts.active).toBe(1);
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  });
});

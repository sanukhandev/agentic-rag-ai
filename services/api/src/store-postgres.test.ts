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
      expect((await store.setTenantPublicOrigin(tenant.id, 'https://store.example'))?.publicOrigin).toBe('https://store.example');
      const member = await store.createUser({ email: `member-${randomUUID()}@example.test`, passwordHash: 'hash', role: 'tenant_editor', tenantId: tenant.id });
      expect(await store.updateUserRole(member.id, tenant.id, 'tenant_viewer')).toMatchObject({ id: member.id, role: 'tenant_viewer' });
      const domain = await store.addDomain({ tenantId: tenant.id, hostname: 'chat.postgres.example' });
      expect(await store.listDomains(tenant.id)).toMatchObject([{ id: domain.id, hostname: 'chat.postgres.example' }]);
      expect(await store.removeDomain(domain.id, tenant.id)).toBe(true);
      const session = await store.createSession(tenant.id);
      const personaVersion = await store.createPersonaVersion({ tenantId: tenant.id, name: 'Ava', greeting: 'Hello', personality: 'Precise', tone: 'Clear', speakingStyle: 'Short', permittedLanguages: ['en'], status: 'draft' });
      expect(personaVersion.version).toBe(1);
      await expect(store.publishPersonaVersion(tenant.id, personaVersion.id)).resolves.toMatchObject({ status: 'published', version: 1 });
      expect(await store.getPersona(tenant.id)).toMatchObject({ name: 'Ava' });
      session.tokenMap.set('[EMAIL_1]', 'v1.ciphertext');
      await store.updateSession(session);
      expect((await store.getSession(session.id))?.tokenMap.get('[EMAIL_1]')).toBe('v1.ciphertext');
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const source = await store.createSource({ id: sourceId, tenantId: tenant.id, title: 'FAQ', mimeType: 'text/plain', sourceUrl: null, audience: 'public', status: 'awaiting_review', versionId, contentHash: 'hash', chunks: [{ id: randomUUID(), sourceId, tenantId: tenant.id, versionId, ordinal: 0, locator: 'section 1', content: 'Pricing is 100 credits.', contentHash: 'chunk-hash', embedding: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] }] });
      const job = await store.createIngestionJob({ id: randomUUID(), tenantId: tenant.id, title: 'FAQ', mimeType: 'text/plain', sourceUrl: null, audience: 'public' });
      const claimedJob = await store.claimIngestionJob(job.id, 60_000);
      expect(claimedJob).toMatchObject({ status: 'processing', attempts: 1 });
      const completedJob = await store.updateIngestionJob({ ...claimedJob!, sourceId: source.id, status: 'completed', errorCode: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      expect(await store.getIngestionJob(job.id)).toMatchObject({ id: job.id, sourceId: source.id, status: 'completed', attempts: 1 });
      expect(completedJob.errorCode).toBeNull();
      const callbackNonce = randomUUID();
      expect(await store.claimCallbackNonce(callbackNonce, new Date(Date.now() + 60_000).toISOString())).toBe(true);
      expect(await store.claimCallbackNonce(callbackNonce, new Date(Date.now() + 60_000).toISOString())).toBe(false);
      await store.setSourceStatus(source.id, tenant.id, 'active');
      expect((await store.listSearchableChunks(tenant.id, 'public')).length).toBe(1);
      expect((await store.searchSearchableChunks(tenant.id, 'public', [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 4)).length).toBe(1);
      const userMessage = await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user', maskedContent: 'What is pricing?', citations: [], clientMessageId: 'client-1', response: null, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: { answer: 'Pricing is 100 credits.' } });
      expect((await store.getMessageByClientId(session.id, 'client-1'))?.response).toMatchObject({ answer: 'Pricing is 100 credits.' });
      expect(await store.listMessages(session.id, tenant.id)).toHaveLength(1);
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'lead.capture', idempotencyKey: 'action-1', state: 'awaiting_confirmation', opaqueReference: 'lead-1', createdAt: new Date().toISOString(), result: null });
      await store.updateAction({ ...action, state: 'completed', result: { externalReference: 'run-1' } });
      expect((await store.getAction(action.id))?.result).toEqual({ externalReference: 'run-1' });
      expect((await store.getTenantStats(tenant.id)).sourceCounts.active).toBe(1);
      expect((await store.getTenantStats(tenant.id)).ingestionJobs.completed).toBe(1);
      const currentChunks = await store.listSourceChunks(source.id, tenant.id);
      const nextVersion = randomUUID();
      const reindexed = await store.replaceSourceVersion({ sourceId: source.id, tenantId: tenant.id, versionId: nextVersion, contentHash: source.contentHash, chunks: [{ ...currentChunks[0]!, id: randomUUID(), versionId: nextVersion }] });
      expect(reindexed).toMatchObject({ id: source.id, versionId: nextVersion, status: 'awaiting_review' });
      expect(await store.listSourceVersions(source.id, tenant.id)).toHaveLength(2);
      expect(await store.purgeExpiredSessions(tenant.id, new Date(Date.now() + 1_000).toISOString())).toBe(1);
    } finally {
      await pool.query('DELETE FROM users WHERE tenant_id=$1', [tenant.id]);
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  });
});

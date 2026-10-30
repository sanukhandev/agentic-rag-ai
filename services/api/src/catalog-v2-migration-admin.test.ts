import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const legacyCatalog = { tenantScope: 'ancfz', intents: [], signals: [], slots: [], relations: [], workflowBindings: [] };

describe('legacy catalog audit and v2 migration boundary', () => {
  it('audits v1 read-only, creates a draft candidate, and leaves v1 published state intact', async () => {
    const runtime = createApp({ nodeEnv: 'test' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-v2-migration@example.test', password: 'Platform1Password' }).expect(201);
    const tenantResponse = await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Migration Tenant', slug: 'ancfz', adminEmail: 'admin-v2-migration@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    const tenantId = tenantResponse.body.tenant.id as string;
    const legacy = await runtime.store.createIntentCatalogVersion({ tenantId, status: 'published', sourceFileName: 'legacy.xlsx', sourceHash: 'b'.repeat(64), parserVersion: 'legacy-test', catalog: legacyCatalog });
    const admin = await api.post('/api/v1/auth/login').send({ email: 'admin-v2-migration@example.test', password: 'TenantA1Password' }).expect(200);
    const auth = { Authorization: `Bearer ${admin.body.token}` };
    const audit = await api.get('/api/v2/admin/intent-catalog/legacy/versions').set(auth).expect(200);
    expect(audit.body.items).toHaveLength(1);
    expect(audit.body.items[0]).toMatchObject({ sourceVersionId: legacy.id, status: 'published', readOnly: true, preservedHistory: true });
    expect(audit.body.items[0].catalog).toBeUndefined();
    await api.post(`/api/v2/admin/intent-catalog/legacy/versions/${legacy.id}/migration-candidate`).set(auth).send({ catalog: { version: 1 } }).expect(422);
    const candidate = await api.post(`/api/v2/admin/intent-catalog/legacy/versions/${legacy.id}/migration-candidate`).set(auth).send({ sourceFileName: 'mapped-v2.xlsx', catalog }).expect(201);
    expect(candidate.body.candidate).toMatchObject({ sourceVersionId: legacy.id, status: 'review_required', autoPublish: false });
    expect(candidate.body.version).toMatchObject({ status: 'draft', tenantId, sourceFileName: 'mapped-v2.xlsx' });
    expect((await api.get('/api/v1/admin/intent-catalog/versions').set(auth).expect(200)).body.items[0]).toMatchObject({ id: legacy.id, status: 'published', sourceFileName: 'legacy.xlsx' });
    expect((await api.get('/api/v2/admin/intent-catalog/versions').set(auth).expect(200)).body.items[0]).toMatchObject({ id: candidate.body.version.id, status: 'draft' });
  });

  it('does not expose another tenant\'s legacy history', async () => {
    const runtime = createApp({ nodeEnv: 'test' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-v2-migration-isolation@example.test', password: 'Platform1Password' }).expect(201);
    await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Migration Tenant A', slug: 'migration-a', adminEmail: 'admin-v2-migration-a@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Migration Tenant B', slug: 'migration-b', adminEmail: 'admin-v2-migration-b@example.test', adminPassword: 'TenantB1Password' }).expect(201);
    const adminA = await api.post('/api/v1/auth/login').send({ email: 'admin-v2-migration-a@example.test', password: 'TenantA1Password' }).expect(200);
    const adminB = await api.post('/api/v1/auth/login').send({ email: 'admin-v2-migration-b@example.test', password: 'TenantB1Password' }).expect(200);
    const tenantA = (await runtime.store.getTenantBySlug('migration-a'))!;
    await runtime.store.createIntentCatalogVersion({ tenantId: tenantA.id, status: 'published', sourceFileName: 'legacy-a.xlsx', sourceHash: 'c'.repeat(64), parserVersion: 'legacy-test', catalog: legacyCatalog });
    expect((await api.get('/api/v2/admin/intent-catalog/legacy/versions').set({ Authorization: `Bearer ${adminB.body.token}` }).expect(200)).body.items).toHaveLength(0);
    expect(adminA.body.token).toBeTruthy();
  });
});

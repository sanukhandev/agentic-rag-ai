import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { readFileSync } from 'node:fs';
import { exportCatalogV2Workbook } from './catalog-v2-xlsx.js';
import { validateCatalogV2 } from './catalog-v2.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('catalog v2 Admin boundary', () => {
  it('previews, stores, publishes and exports a tenant-scoped v2 catalog', async () => {
    const runtime = createApp({ nodeEnv: 'test' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-v2-admin@example.test', password: 'Platform1Password' }).expect(201);
    const tenant = await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'V2 Admin Tenant', slug: 'ancfz', adminEmail: 'admin-v2-catalog@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    const admin = await api.post('/api/v1/auth/login').send({ email: 'admin-v2-catalog@example.test', password: 'TenantA1Password' }).expect(200);
    const auth = { Authorization: `Bearer ${admin.body.token}` };
    const preview = await api.post('/api/v2/admin/intent-catalog/preview').set(auth).send({ sourceFileName: 'ancfz-v2.xlsx', catalog }).expect(200);
    expect(preview.body).toMatchObject({ valid: true, catalogVersionRef: expect.stringContaining('ancfz:r1:') });
    const draft = await api.post('/api/v2/admin/intent-catalog/versions').set(auth).send({ sourceFileName: 'ancfz-v2.xlsx', catalog }).expect(201);
    const versionId = draft.body.version.id as string;
    await api.post(`/api/v2/admin/intent-catalog/versions/${versionId}/publish`).set(auth).expect(200);
    expect((await api.get('/api/v2/admin/intent-catalog/versions').set(auth).expect(200)).body.items[0]).toMatchObject({ id: versionId, status: 'published', tenantId: tenant.body.tenant.id });
    const exported = await api.get('/api/v2/admin/intent-catalog/published/export').set(auth).expect(200);
    expect(exported.headers['content-type']).toMatch(/spreadsheetml\.sheet/u);
    expect(exportCatalogV2Workbook(catalog as never).subarray(0, 2).toString()).toBe('PK');
    const exportedJson = await api.get('/api/v2/admin/intent-catalog/published/export.json').set(auth).expect(200);
    expect(exportedJson.body.schemaVersion).toBe(2);
    expect(validateCatalogV2(exportedJson.body).ok).toBe(true);
  });

  it('does not allow another tenant to read or publish the version', async () => {
    const runtime = createApp({ nodeEnv: 'test' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-v2-isolation@example.test', password: 'Platform1Password' }).expect(201);
    await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'V2 Tenant A', slug: 'v2-tenant-a', adminEmail: 'admin-v2-a@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'V2 Tenant B', slug: 'v2-tenant-b', adminEmail: 'admin-v2-b@example.test', adminPassword: 'TenantB1Password' }).expect(201);
    const adminA = await api.post('/api/v1/auth/login').send({ email: 'admin-v2-a@example.test', password: 'TenantA1Password' }).expect(200);
    const adminB = await api.post('/api/v1/auth/login').send({ email: 'admin-v2-b@example.test', password: 'TenantB1Password' }).expect(200);
    const invalid = structuredClone(catalog) as { manifest: Record<string, unknown> };
    invalid.manifest.tenantScope = 'v2-tenant-a';
    const draft = await api.post('/api/v2/admin/intent-catalog/versions').set('Authorization', `Bearer ${adminA.body.token}`).send({ sourceFileName: 'v2.xlsx', catalog: invalid }).expect(201);
    await api.get('/api/v2/admin/intent-catalog/versions').set('Authorization', `Bearer ${adminB.body.token}`).expect(200).expect(({ body }) => expect(body.items).toHaveLength(0));
    await api.post(`/api/v2/admin/intent-catalog/versions/${draft.body.version.id}/publish`).set('Authorization', `Bearer ${adminB.body.token}`).expect(404);
  });
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const apiBase = (process.env.SEED_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const platformCredentials = {
  email: process.env.SEED_PLATFORM_EMAIL ?? 'platform@example.test',
  password: process.env.SEED_PLATFORM_PASSWORD ?? 'Platform1Password',
};
const tenantDefinitions = [
  { name: 'Tenant A', slug: 'tenant-a', adminEmail: process.env.SEED_TENANT_A_EMAIL ?? 'admin-a@example.test', adminPassword: process.env.SEED_TENANT_A_PASSWORD ?? 'TenantA1Password', assistant: 'Ava', content: 'Tenant A pricing is 100 credits per month. A-ONLY support is available by email.' },
  { name: 'Tenant B', slug: 'tenant-b', adminEmail: process.env.SEED_TENANT_B_EMAIL ?? 'admin-b@example.test', adminPassword: process.env.SEED_TENANT_B_PASSWORD ?? 'TenantB1Password', assistant: 'Bea', content: 'Tenant B pricing is 200 credits per month. BETA-ONLY support is available by phone.' },
];

const request = async (path, options = {}, expected = [200]) => {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!expected.includes(response.status)) throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
};

const login = (credentials) => request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(credentials) });

const bootstrapPlatform = async () => {
  const registered = await request('/api/v1/auth/register-platform', { method: 'POST', body: JSON.stringify(platformCredentials) }, [201, 409]);
  return registered?.token ? registered : login(platformCredentials);
};

const createOrFindTenant = async (platformToken, definition) => {
  const created = await request('/api/v1/admin/tenants', { method: 'POST', headers: { Authorization: `Bearer ${platformToken}` }, body: JSON.stringify(definition) }, [201, 409]);
  let tenant = created?.tenant;
  if (!tenant) {
    const tenants = await request('/api/v1/admin/tenants', { headers: { Authorization: `Bearer ${platformToken}` } });
    tenant = tenants.items.find((item) => item.slug === definition.slug);
  }
  assert.ok(tenant, `Synthetic tenant ${definition.slug} should exist.`);
  const admin = await login({ email: definition.adminEmail, password: definition.adminPassword });
  return { definition, tenant, adminToken: admin.token };
};

const configureTenant = async ({ definition, adminToken }) => {
  const headers = { Authorization: `Bearer ${adminToken}` };
  await request('/api/v1/admin/persona', { method: 'PUT', headers, body: JSON.stringify({ name: definition.assistant, greeting: `Welcome to ${definition.name}.`, personality: 'Helpful and precise.', tone: 'Clear', speakingStyle: 'Concise', permittedLanguages: ['en'] }) });
  await request('/api/v1/admin/channel', { method: 'PATCH', headers, body: JSON.stringify({ publicOrigin: 'http://localhost:3000', publicChatEnabled: true }) });
  const staged = await request('/api/v1/admin/sources', { method: 'POST', headers, body: JSON.stringify({ title: `${definition.name} FAQ`, mimeType: 'text/plain', audience: 'public', content: definition.content }) }, [200, 201]);
  await request(`/api/v1/admin/sources/${staged.source.id}/publish`, { method: 'POST', headers });
  return staged.source.id;
};

const publicHeaders = { Origin: 'http://localhost:3000' };
const ask = async (tenantSlug, message, clientMessageId) => {
  const session = await request('/api/v1/chat/sessions', { method: 'POST', headers: publicHeaders, body: JSON.stringify({ tenantSlug }) }, [201]);
  return request('/api/v1/chat/messages', { method: 'POST', headers: publicHeaders, body: JSON.stringify({ sessionId: session.sessionId, message, clientMessageId }) });
};

const platform = await bootstrapPlatform();
const tenants = [];
for (const definition of tenantDefinitions) {
  const tenant = await createOrFindTenant(platform.token, definition);
  await configureTenant(tenant);
  tenants.push(tenant);
}

const answers = [];
for (const tenant of tenants) {
  const grounded = await ask(tenant.definition.slug, 'What is the pricing?', randomUUID());
  assert.equal(grounded.grounded, true);
  assert.ok(grounded.citations.length > 0);
  const unsupported = await ask(tenant.definition.slug, 'What is the office location?', randomUUID());
  assert.equal(unsupported.grounded, false);
  assert.equal(unsupported.citations.length, 0);
  answers.push({ slug: tenant.definition.slug, grounded: true, unsupportedRefused: true });
}

const crossTenant = await ask('tenant-a', 'What is the BETA phone?', randomUUID());
assert.equal(crossTenant.grounded, false);
assert.equal(crossTenant.citations.length, 0);

const workflowReply = await ask('tenant-a', 'I am interested in a demo.', randomUUID());
assert.ok(workflowReply.actionProposal?.id, 'A confirmed-action proposal should be returned.');
const confirmed = await request(`/api/v1/chat/actions/${workflowReply.actionProposal.id}/confirm`, { method: 'POST', headers: publicHeaders, body: JSON.stringify({ sessionId: workflowReply.sessionId, confirmed: true }) });
assert.equal(confirmed.action.state, 'approved');
const duplicate = await request(`/api/v1/chat/actions/${workflowReply.actionProposal.id}/confirm`, { method: 'POST', headers: publicHeaders, body: JSON.stringify({ sessionId: workflowReply.sessionId, confirmed: true }) });
assert.equal(duplicate.action.state, 'approved');

console.log(JSON.stringify({ apiBase, tenants: answers, workflow: { state: confirmed.action.state, duplicateState: duplicate.action.state }, checks: ['grounded citations', 'unsupported refusal', 'cross-tenant refusal', 'idempotent mock workflow'] }, null, 2));

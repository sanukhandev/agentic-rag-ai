import { readFileSync } from 'node:fs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { buildChunks } from './knowledge.js';
import { newLifecycleState } from './lifecycle-state.js';
import { newConversationState } from './conversation-state.js';
import { contentHash, MemoryStore } from './store-memory.js';
import { FoundryToolAuth, type FoundryToolAuthOptions } from './routes/foundry-tools.js';

const key = 'f'.repeat(40);

const makeRuntime = async (options: { rateLimitMax?: number; timeoutMs?: number; maxResponseBytes?: number; store?: MemoryStore; binding?: (context: { tenantId: string; identity: string }) => Promise<string | null> } = {}) => {
  const store = options.store ?? new MemoryStore();
  const tenant = await store.createTenant({ name: 'Foundry Tenant', slug: 'foundry-tenant' });
  const runtime = createApp({
    store,
    nodeEnv: 'test',
    jwtSecret: 'foundry-test-jwt',
    foundryToolAuth: { apiKey: key, apiKeyTenantId: tenant.id, allowApiKey: true },
    ...(options.binding ? { foundrySessionBinding: options.binding } : {}),
    ...(options.rateLimitMax ? { foundryToolRateLimitMax: options.rateLimitMax } : {}),
    ...(options.timeoutMs ? { foundryToolTimeoutMs: options.timeoutMs } : {}),
    ...(options.maxResponseBytes ? { foundryToolMaxResponseBytes: options.maxResponseBytes } : {}),
  });
  return { store, tenant, runtime };
};

const addSource = async (store: MemoryStore, tenantId: string, content: string, audience: 'public' | 'internal' = 'public') => {
  const sourceId = randomUUID();
  const versionId = randomUUID();
  return store.createSource({ id: sourceId, tenantId, title: 'Approved guide', mimeType: 'text/plain', sourceUrl: null, audience, status: 'active', embeddingReady: true, versionId, contentHash: contentHash(content), chunks: buildChunks({ id: sourceId, tenantId, versionId }, content) });
};

describe('Foundry read-only tool gateway', () => {
  it('keeps the checked-in OpenAPI contract aligned with the two read-only operations', () => {
    const specification = JSON.parse(readFileSync(new URL('../../../openapi/foundry-agent-tools.openapi.json', import.meta.url), 'utf8')) as { paths?: Record<string, { post?: { operationId?: string } }>; security?: unknown; servers?: Array<{ url?: string }> };
    expect(Object.keys(specification.paths ?? {})).toEqual(['/api/v1/foundry/tools/search-knowledge', '/api/v1/foundry/tools/get-journey-state']);
    expect(specification.paths?.['/api/v1/foundry/tools/search-knowledge']?.post?.operationId).toBe('search_knowledge');
    expect(specification.paths?.['/api/v1/foundry/tools/get-journey-state']?.post?.operationId).toBe('get_journey_state');
    expect(specification.security).toEqual([{ entraBearer: [] }]);
    expect(specification.servers?.[0]?.url).toBe('https://YOUR_VERIFIED_API_HOSTNAME');
  });

  it('retrieves only active public evidence for the authorized tenant and redacts contact data', async () => {
    const { store, tenant, runtime } = await makeRuntime();
    await addSource(store, tenant.id, 'Tenant A company formation packages are described here. Contact a@example.test or +971 50 123 4567.');
    const tenantB = await store.createTenant({ name: 'Other Tenant', slug: 'other-tenant' });
    await addSource(store, tenantB.id, 'Other Tenant company formation packages must never be returned.');
    await addSource(store, tenant.id, 'Tenant A internal company formation packages are confidential.', 'internal');

    const response = await request(runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: 'company formation packages', maxResults: 4 }).expect(200);

    expect(response.body.status).toBe('grounded');
    expect(response.body.answer).toContain('Tenant A');
    expect(response.body.answer).not.toContain('Other Tenant');
    expect(response.body.answer).not.toContain('a@example.test');
    expect(response.body.answer).not.toContain('+971 50 123 4567');
    expect(response.body.citations[0]).toMatchObject({ sourceId: expect.any(String), chunkId: expect.any(String), title: 'Approved guide', locator: 'section 1' });
  });

  it('returns bounded no_evidence without invoking a business action', async () => {
    const { store, tenant, runtime } = await makeRuntime();
    const before = await store.listActions(tenant.id);
    const response = await request(runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: 'unknown regulatory fact' }).expect(200);
    expect(response.body).toEqual({ status: 'no_evidence', answer: 'No approved source evidence was found for this query.', citations: [] });
    expect(await store.listActions(tenant.id)).toEqual(before);
  });

  it('returns 503 when approved retrieval exceeds the gateway timeout', async () => {
    class SlowSearchStore extends MemoryStore {
      async searchSearchableChunks(tenantId: string, audience: 'public' | 'internal', queryEmbedding: number[], limit: number, queryText = '') {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return super.searchSearchableChunks(tenantId, audience, queryEmbedding, limit, queryText);
      }
    }
    const { tenant, runtime } = await makeRuntime({ store: new SlowSearchStore(), timeoutMs: 5 });
    const response = await request(runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: 'packages' }).expect(503);
    expect(response.body.error.code).toBe('FOUNDRY_TOOL_TIMEOUT');
    expect(tenant.id).toEqual(expect.any(String));
  });

  it('keeps grounded responses under the configured response byte budget', async () => {
    const { store, tenant, runtime } = await makeRuntime({ maxResponseBytes: 1_024 });
    await addSource(store, tenant.id, `${'Approved company formation package details. '.repeat(200)}`);
    const response = await request(runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: 'company formation package' }).expect(200);
    expect(Buffer.byteLength(JSON.stringify(response.body), 'utf8')).toBeLessThanOrEqual(1_024);
  });

  it('rejects missing auth, invalid requests, and identity rate-limit overflow', async () => {
    const first = await makeRuntime({ rateLimitMax: 1 });
    await request(first.runtime.app).post('/api/v1/foundry/tools/search-knowledge').send({ query: 'packages' }).expect(401);
    const invalid = await makeRuntime();
    await request(invalid.runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: '' }).expect(422);
    await request(first.runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: 'packages' }).expect(200);
    await request(first.runtime.app).post('/api/v1/foundry/tools/search-knowledge').set('X-Foundry-Api-Key', key).send({ query: 'packages' }).expect(429);
  });

  it('returns not_linked without a trusted session binding and exposes no customer state', async () => {
    const { store, tenant, runtime } = await makeRuntime();
    const session = await store.createSession(tenant.id);
    const before = await store.getSession(session.id);
    const response = await request(runtime.app).post('/api/v1/foundry/tools/get-journey-state').set('X-Foundry-Api-Key', key).send({}).expect(200);
    expect(response.body).toEqual({ status: 'not_linked', currentStage: null, completedStages: [], nextRequirement: null });
    expect(await store.getSession(session.id)).toEqual(before);
  });

  it('returns sanitized state only for the server-bound session and never accepts a model session id', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Bound Tenant', slug: 'bound-tenant' });
    const otherTenant = await store.createTenant({ name: 'Other Tenant', slug: 'bound-other' });
    const session = await store.createSession(tenant.id);
    const otherSession = await store.createSession(otherTenant.id);
    const state = newConversationState();
    const intentKey = 'company.setup';
    const journeyId = randomUUID();
    state.selectedIntentKey = intentKey;
    state.intentProgress = { version: 1, activeIntentKey: intentKey, pausedIntentKeys: [], fulfilledIntentKeys: [], entries: { [intentKey]: { intentKey, journeyId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: { name: '[NAME_1]' }, slotProvenance: {}, lifecycle: newLifecycleState(), revision: 2 } }, journeys: {}, visitedIntentKeys: [intentKey], lastTransitionReason: null, journeyRevision: 2 };
    await store.updateSession({ ...session, conversationState: state });
    const runtime = createApp({ store, nodeEnv: 'test', jwtSecret: 'foundry-test-jwt', foundryToolAuth: { apiKey: key, apiKeyTenantId: tenant.id, allowApiKey: true }, foundrySessionBinding: async ({ tenantId }) => tenantId === tenant.id ? session.id : otherSession.id });
    const before = await store.getSession(session.id);
    await request(runtime.app).post('/api/v1/foundry/tools/get-journey-state').set('X-Foundry-Api-Key', key).send({ sessionId: otherSession.id }).expect(422);
    const linked = await request(runtime.app).post('/api/v1/foundry/tools/get-journey-state').set('X-Foundry-Api-Key', key).send({}).expect(200);
    expect(linked.body).toMatchObject({ status: 'available', currentStage: 'lead_generation', completedStages: [], nextRequirement: null, revision: 0 });
    expect(linked.body).not.toHaveProperty('sessionId');
    expect(linked.body).not.toHaveProperty('name');
    expect(await store.getSession(session.id)).toEqual(before);
    const crossTenantRuntime = createApp({ store, nodeEnv: 'test', jwtSecret: 'foundry-test-jwt', foundryToolAuth: { apiKey: key, apiKeyTenantId: otherTenant.id, allowApiKey: true }, foundrySessionBinding: async () => session.id });
    expect((await request(crossTenantRuntime.app).post('/api/v1/foundry/tools/get-journey-state').set('X-Foundry-Api-Key', key).send({})).body).toEqual({ status: 'not_linked', currentStage: null, completedStages: [], nextRequirement: null });
  });
});

describe('Foundry Entra token validation', () => {
  const createAuth = (overrides: Partial<FoundryToolAuthOptions> = {}) => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const options: FoundryToolAuthOptions = { issuer: 'https://login.microsoftonline.com/test/v2.0', audience: 'api://foundry-tools', jwksUrl: 'https://login.test/keys', allowedAppIds: ['foundry-app'], defaultTenantId: 'tenant-a', fetchImpl: async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1', alg: 'RS256' }] }), { status: 200, headers: { 'content-type': 'application/json' } }), ...overrides };
    return { auth: new FoundryToolAuth(options), privateKey, options };
  };

  const token = (privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], claims: Record<string, unknown> = {}, signing: Pick<SignOptions, 'issuer' | 'audience' | 'expiresIn'> = {}) => jwt.sign({ azp: 'foundry-app', ...claims }, privateKey, { algorithm: 'RS256', issuer: signing.issuer ?? 'https://login.microsoftonline.com/test/v2.0', audience: signing.audience ?? 'api://foundry-tools', keyid: 'key-1', expiresIn: signing.expiresIn ?? '5m' });

  it.each([
    ['expired', { expiresIn: -1 }],
    ['wrong issuer', { issuer: 'https://wrong.example.test' }],
    ['wrong audience', { audience: 'api://wrong' }],
    ['unauthorized principal', { azp: 'other-app' }],
  ])('rejects %s tokens', async (_name, claims) => {
    const { auth, privateKey } = createAuth();
    const value = _name === 'expired' ? token(privateKey, {}, { expiresIn: -120 })
      : _name === 'wrong issuer' ? token(privateKey, {}, { issuer: 'https://wrong.example.test' })
        : _name === 'wrong audience' ? token(privateKey, {}, { audience: 'api://wrong' })
          : token(privateKey, claims);
    await expect(auth.authenticate({ header: (name: string) => name === 'authorization' ? `Bearer ${value}` : undefined } as never)).rejects.toMatchObject({ status: 401 });
  });
});

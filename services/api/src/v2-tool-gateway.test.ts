import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { issueV2Scope, createV2ToolGateway, registerV2ToolGateway, verifyV2Scope, V2_TOOL_NAMES } from './v2-tool-gateway.js';
import type { IntentCatalogVersion, PersonaVersion, Session, Store } from './types.js';

const tenantId = 'tenant-12345678';
const sessionId = 'session-12345678';
const catalogVersionId = 'catalog-12345678';
const personaVersionId = 'persona-12345678';
const serviceKey = 'service-key-1234567890';

const session: Session = {
  id: sessionId,
  tenantId,
  createdAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(),
  closedAt: null,
  personaVersionId,
  tokenMap: new Map(),
  stateVersion: 3,
  conversationState: {
    phase: 'SLOT_COLLECTION',
    catalogVersionId,
    candidateIntentKeys: [],
    selectedIntentKey: 'anc.setup.new_company',
    activeFollowUpIntentKey: null,
    slotValues: { business_activity: 'consulting' },
    slotProvenance: {},
    pendingPrompt: null,
    rollingSummary: 'Customer is exploring a company setup.',
    summaryRevision: 1,
    messageSequence: 2,
    workflowStatus: 'none',
    contactConsent: 'unknown',
    consentVersion: null,
    consentCapturedAt: null,
    intentProgress: { version: 1, activeIntentKey: 'anc.setup.new_company', pausedIntentKeys: [], fulfilledIntentKeys: [], visitedIntentKeys: ['anc.setup.new_company'], entries: { 'anc.setup.new_company': { intentKey: 'anc.setup.new_company', journeyId: 'opportunity-12345678', status: 'active', slotValues: { business_activity: 'consulting' }, completedRequirementKeys: [], currentRequirementKey: null, revision: 1 } }, journeyRevision: 1, lastTransitionReason: null },
  },
};

const catalog: IntentCatalogVersion = {
  id: catalogVersionId,
  tenantId,
  version: 1,
  status: 'published',
  sourceFileName: 'catalog.xlsx',
  sourceHash: 'a'.repeat(64),
  parserVersion: 'test',
  catalog: { tenantScope: tenantId, intents: [{ intentKey: 'anc.setup.new_company', displayName: 'New company', description: 'Company setup', category: 'setup', workflowKey: 'lead.capture', minimumScore: 1, confidenceThreshold: 0.8, confirmationRequired: true, active: true, priority: 1, versionNote: '' }], signals: [], slots: [], relations: [], workflowBindings: [], journeyRequirements: [], },
  createdAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
};

const persona: PersonaVersion = {
  id: personaVersionId,
  tenantId,
  name: 'Zara',
  greeting: 'Hello',
  personality: 'Helpful',
  tone: 'Warm',
  speakingStyle: 'Clear',
  permittedLanguages: ['en'],
  contextWindowMessages: 8,
  voiceName: '',
  voiceLanguage: 'en-US',
  voiceRate: 1,
  voicePitch: 1,
  voiceVolume: 1,
  version: 1,
  status: 'published',
  createdAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
};

const storeFor = (current: Session = session): Store => ({
  getSession: async () => current,
  getIntentCatalogVersion: async () => catalog,
  getPersonaVersion: async () => persona,
  listPackageOfferings: async () => [],
  listActionsBySession: async () => [],
  addAudit: async () => undefined,
} as unknown as Store);

const requestFor = (scopeRef: string, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  toolCallId: 'call-12345678',
  toolName: 'get_conversation_context',
  arguments: {},
  scopeRef,
  expectedStateRevision: 3,
  deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  ...overrides,
});

describe('v2 trusted Node tool gateway', () => {
  it('issues and verifies a short-lived signed scope without exposing its payload as a result', () => {
    const scope = issueV2Scope({ tenantId, sessionId, opportunityId: 'opportunity-12345678', catalogVersionId, personaVersionId, stateRevision: 3 }, serviceKey);
    expect(verifyV2Scope(scope, serviceKey)).toMatchObject({ tenantId, sessionId, catalogVersionId, personaVersionId, stateRevision: 3 });
    expect(verifyV2Scope(`${scope}tampered`, serviceKey)).toBeNull();
    expect(verifyV2Scope(scope, serviceKey, Date.now() + 6 * 60_000)).toBeNull();
  });

  it('returns a scoped sanitized read result and replays an identical tool call safely', async () => {
    const scope = issueV2Scope({ tenantId, sessionId, opportunityId: 'opportunity-12345678', catalogVersionId, personaVersionId, stateRevision: 3 }, serviceKey);
    const gateway = createV2ToolGateway({ store: storeFor(), embedding: { model: 'deterministic-test', dimension: 1, embed: async () => [1] }, serviceKey });
    const first = await gateway.execute(requestFor(scope));
    const second = await gateway.execute(requestFor(scope));
    expect(first).toMatchObject({ status: 'ok', toolCallId: 'call-12345678' });
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(tenantId);
    expect(JSON.stringify(first)).not.toContain(sessionId);
  });

  it('denies cross-tenant, stale, unknown and model-supplied identity requests', async () => {
    const scope = issueV2Scope({ tenantId, sessionId, opportunityId: null, catalogVersionId, personaVersionId, stateRevision: 3 }, serviceKey);
    const crossTenant = createV2ToolGateway({ store: storeFor({ ...session, tenantId: 'other-tenant-12345678' }), embedding: { model: 'deterministic-test', dimension: 1, embed: async () => [1] }, serviceKey });
    expect((await crossTenant.execute(requestFor(scope))).status).toBe('not_authorized');
    const gateway = createV2ToolGateway({ store: storeFor(), embedding: { model: 'deterministic-test', dimension: 1, embed: async () => [1] }, serviceKey });
    expect((await gateway.execute(requestFor(scope, { toolName: 'delete_customer' }))).status).toBe('not_authorized');
    expect((await gateway.execute(requestFor(scope, { toolCallId: 'call-identity-1234', arguments: { tenantId: 'other-tenant-12345678' } }))).status).toBe('invalid_args');
    const stale = issueV2Scope({ tenantId, sessionId, opportunityId: null, catalogVersionId, personaVersionId, stateRevision: 2 }, serviceKey);
    expect((await gateway.execute(requestFor(stale, { expectedStateRevision: 2 }))).status).toBe('stale_state');
  });

  it('keeps the registry explicit and bounded', () => {
    expect(V2_TOOL_NAMES).toHaveLength(9);
    expect(new Set(V2_TOOL_NAMES).size).toBe(V2_TOOL_NAMES.length);
  });

  it('requires the private service key at the HTTP boundary', async () => {
    const app = express();
    app.use(express.json());
    registerV2ToolGateway(app, { store: storeFor(), embedding: { model: 'deterministic-test', dimension: 1, embed: async () => [1] }, serviceKey });
    const scope = issueV2Scope({ tenantId, sessionId, opportunityId: null, catalogVersionId, personaVersionId, stateRevision: 3 }, serviceKey);
    const body = requestFor(scope);
    expect((await request(app).post('/internal/v2/tools/execute').send(body)).status).toBe(401);
    expect((await request(app).post('/internal/v2/tools/execute').set('x-internal-service-key', serviceKey).send(body)).status).toBe(200);
  });
});

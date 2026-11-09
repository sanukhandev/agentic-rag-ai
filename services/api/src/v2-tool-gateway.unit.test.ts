import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { issueV2Scope, listApprovedV2PackageEvidence, listApprovedV2PackageOptions, verifyV2Scope, V2_TOOL_NAMES } from './v2-tool-gateway.js';

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
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2 } from './catalog-v2.js';

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
  const request = (toolName: string, args: Record<string, unknown> = {}, callId: string = randomUUID()) => ({
    schemaVersion: 2, toolCallId: callId, toolName, arguments: args, scopeRef,
    expectedStateRevision: pinned.stateVersion ?? 0, deadlineAt: new Date(Date.now() + 15_000).toISOString(),
  });
  return { store, tenant, persona, catalog, pinned, scopeRef, gateway, request };
};

describe('V2 trusted tool execution (isolated unit)', () => {
  it('builds bounded approved package evidence for deterministic package answers', async () => {
    const { store, tenant, catalog } = await makeGateway();
    await store.createPackageOffering({
      id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, catalogVersionRef: 'catalog-v2-ref',
      packageKey: 'approved-package', name: 'Approved package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 1, officeRequirement: null, inclusions: ['company registration'], priceMinor: 100,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'approved', sourceRefs: ['deterministic-mock-pricebook'], createdAt: new Date().toISOString(),
    });
    await store.createPackageOffering({
      id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, catalogVersionRef: 'catalog-v2-ref',
      packageKey: 'unapproved-package', name: 'Unapproved package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 1, officeRequirement: null, inclusions: [], priceMinor: 200,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'unavailable', sourceRefs: [], createdAt: new Date().toISOString(),
    });
    const evidence = await listApprovedV2PackageEvidence(store, tenant.id, 'catalog-v2-ref');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ sourceVersion: 'catalog-v2-ref', sourceRef: 'tool-get_available_packages', approved: true, revoked: false });
    expect(evidence[0]?.text).toContain('Approved package');
    expect(evidence[0]?.text).toContain('AED 1.00');
    expect(catalog.id).toBeTruthy();
  });

  it('returns safe selectable package options from the pinned approved catalog', async () => {
    const { store, tenant } = await makeGateway();
    await store.createPackageOffering({
      id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, catalogVersionRef: 'catalog-v2-ref',
      packageKey: 'growth', name: 'Growth package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 2, officeRequirement: 'shared', inclusions: ['company registration', 'two included visas'], priceMinor: 499900,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'approved', sourceRefs: ['deterministic-mock-pricebook'], createdAt: new Date().toISOString(),
    });
    await store.createPackageOffering({
      id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, catalogVersionRef: 'catalog-v2-ref',
      packageKey: 'expired', name: 'Expired package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 1, officeRequirement: null, inclusions: [], priceMinor: 1,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: new Date(now - 1).toISOString(), additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'approved', sourceRefs: [], createdAt: new Date().toISOString(),
    });
    await store.createPackageOffering({
      id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, catalogVersionRef: 'catalog-v2-ref',
      packageKey: 'unapproved', name: 'Unapproved package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 1, officeRequirement: null, inclusions: [], priceMinor: 2,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'unavailable', sourceRefs: [], createdAt: new Date().toISOString(),
    });
    expect(await listApprovedV2PackageOptions(store, tenant.id, 'catalog-v2-ref')).toEqual([{
      packageKey: 'growth', name: 'Growth package', includedVisaQuantity: 2, officeRequirement: 'shared',
      inclusions: ['company registration', 'two included visas'], availability: 'development_only',
      priceMinor: 499900, currency: 'AED', processingTime: 'development only',
    }]);
  });

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
  it('reads V2 package offerings by canonical catalog reference', async () => {
    const { store, tenant, persona, pinned, gateway } = await makeGateway();
    const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
    if (!parsed.ok || !parsed.document) throw new Error('UNIT_CATALOG_FIXTURE_INVALID');
    parsed.document.manifest.tenantScope = tenant.slug;
    parsed.document.sheets.CatalogManifest[0]!.tenantScope = tenant.slug;
    const version = await store.createIntentCatalogV2Version({
      tenantId: tenant.id, sourceFileName: 'catalog-v2.json', status: 'draft',
      sourceHash: catalogV2Sha256(parsed.document), parserVersion: 'unit',
      catalogVersionRef: catalogV2VersionRef(parsed.document), catalog: parsed.document,
    });
    await store.publishIntentCatalogV2Version(tenant.id, version.id);
    await store.updateSession({ ...pinned, conversationState: { ...pinned.conversationState!, catalogVersionId: version.id } });
    await store.createPackageOffering({
      id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, catalogVersionRef: version.catalogVersionRef,
      packageKey: 'v2-sandbox-package', name: 'V2 sandbox package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 1, officeRequirement: null, inclusions: ['company registration'], priceMinor: 100,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'approved', sourceRefs: ['deterministic-mock-pricebook'], createdAt: new Date().toISOString(),
    });
    const scopeRef = issueV2Scope({
      tenantId: tenant.id, sessionId: pinned.id, opportunityId: null, catalogVersionId: version.id,
      personaVersionId: persona.id, stateRevision: (await store.getSession(pinned.id))?.stateVersion ?? 0,
      toolAllowlist: [...V2_TOOL_NAMES],
    }, secret);
    const result = await gateway.execute({
      schemaVersion: 2, toolCallId: randomUUID(), toolName: 'get_available_packages', arguments: {}, scopeRef,
      expectedStateRevision: (await store.getSession(pinned.id))?.stateVersion ?? 0,
      deadlineAt: new Date(Date.now() + 15_000).toISOString(),
    });
    expect(result.status).toBe('ok');
    expect(result.sourceVersion).toBe(version.catalogVersionRef);
    expect((result.result?.packages as Array<{ key: string }>).map((item) => item.key)).toEqual(['v2-sandbox-package']);
    expect((result.result?.evidence as Array<{ text: string }>).map((item) => item.text)).toEqual([
      'The published approved package V2 sandbox package includes 1 visa.\nIt includes company registration.\nIt has availability development_only.\nIts listed price is AED 1.00.',
    ]);
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
  it('refreshes session-backed results instead of replaying stale dynamic evidence', async () => {
    const { store, tenant, pinned, gateway, request } = await makeGateway();
    const call = request('get_conversation_context', {}, 'context-refresh-12345678');
    const first = await gateway.execute(call);
    expect(first.status).toBe('ok');
    expect(first.result).toHaveProperty('recentTurns', []);
    await store.addMessage({
      id: randomUUID(), sessionId: pinned.id, tenantId: tenant.id, role: 'user',
      maskedContent: 'A new question', clientMessageId: randomUUID(),
      citations: [], response: null, createdAt: new Date().toISOString(),
    });
    const second = await gateway.execute(call);
    expect(second.status).toBe('ok');
    expect(second.result).toHaveProperty('recentTurns', [{ role: 'user', content: 'A new question' }]);
  });
  it('returns a safe timeout instead of delayed tool data', async () => {
    const { store, gateway, request } = await makeGateway();
    const original = store.getPersonaVersion.bind(store);
    store.getPersonaVersion = async (tenantId, versionId) => {
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      return original(tenantId, versionId);
    };
    const result = await gateway.execute({
      ...request('get_persona'),
      deadlineAt: new Date(Date.now() + 40).toISOString(),
    });
    expect(result.status).toBe('temporarily_unavailable');
    expect(result.result).toHaveProperty('code', 'TOOL_DEADLINE_EXCEEDED');
  });
  it('rejects altered arguments for an already-used tool call ID', async () => {
    const { gateway, request } = await makeGateway();
    const callId = 'replay-mismatch-12345678';
    expect((await gateway.execute(request('search_knowledge', { query: 'formation', resultCount: 1 }, callId))).status).toBe('ok');
    expect((await gateway.execute(request('search_knowledge', { query: 'visa', resultCount: 1 }, callId))).status).toBe('not_authorized');
  });
});


describe('V2 catalog publication exposed through trusted read tool', () => {
  it('returns the canonical published V2 version and active business goals', async () => {
    const { store, tenant, gateway, request } = await makeGateway();
    const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
    if (!parsed.ok || !parsed.document) throw new Error('UNIT_CATALOG_FIXTURE_INVALID');
    const catalog = parsed.document;
    catalog.manifest.tenantScope = tenant.slug;
    catalog.sheets.CatalogManifest[0]!.tenantScope = tenant.slug;
    const version = await store.createIntentCatalogV2Version({
      tenantId: tenant.id, sourceFileName: 'catalog-v2.json', status: 'draft',
      sourceHash: catalogV2Sha256(catalog), parserVersion: 'unit', catalogVersionRef: catalogV2VersionRef(catalog), catalog,
    });
    await store.publishIntentCatalogV2Version(tenant.id, version.id);
    const result = await gateway.execute(request('get_intent_catalog'));
    expect(result.status).toBe('ok');
    expect(result.sourceVersion).toBe(version.catalogVersionRef);
    expect((result.result?.catalogV2 as { businessGoals: Array<{ key: string }> }).businessGoals)
      .toContainEqual(expect.objectContaining({ key: 'anc.company_formation' }));
  });
});

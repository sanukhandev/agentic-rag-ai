import { describe, expect, it, vi } from 'vitest';
import { executeV2Turn } from './v2-turn-controller.js';
import type { V2CoordinatorRequest, V2CoordinatorResult } from './v2-coordinator.js';

const request = () => ({
  envelope: {
    budgets: { maxModelRequests: 4, maxToolCalls: 4, maxToolRounds: 2, deadlineAt: '2026-11-03T10:00:00.000Z' },
  },
}) as V2CoordinatorRequest;
const outcome = (modelRequestCount: number, toolCallCount: number): V2CoordinatorResult => ({
  modelRequestCount,
  toolCallCount,
  response: { citationIds: ['approved-evidence-a'] },
}) as V2CoordinatorResult;

describe('V2 turn execution boundary', () => {
  it('preserves a bounded, already-guarded coordinator result', async () => {
    const result = outcome(2, 1);
    const run = vi.fn(async () => result);
    await expect(executeV2Turn({ run }, request())).resolves.toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('rejects responses that exceed model or tool budgets', async () => {
    for (const result of [outcome(5, 0), outcome(1, 5), outcome(-1, 0)]) {
      await expect(executeV2Turn({ run: async () => result }, request())).rejects.toThrow('V2_TURN_BUDGET_EXCEEDED');
    }
  });
  it('rejects duplicate citation references', async () => {
    const result = outcome(1, 1);
    result.response.citationIds = ['approved-evidence-a', 'approved-evidence-a'];
    await expect(executeV2Turn({ run: async () => result }, request())).rejects.toThrow('V2_DUPLICATE_CITATIONS');
  });
});

import { randomUUID, createHash } from 'node:crypto';
import { MemoryStore } from './store-memory.js';
import { MemoryCache } from './cache.js';
import { TokenVault } from './privacy.js';
import { resolvePublicCitations, runGPTFirstChatTurn } from './v2-turn-controller.js';
import { createV2ToolGateway, verifyV2Scope } from './v2-tool-gateway.js';
import { DeterministicEmbeddingProvider } from './embedding.js';

const prepared = async () => {
  const store = new MemoryStore();
  const tenant = await store.createTenant({ name: 'Unit Tenant', slug: 'unit-tenant' });
  const persona = await store.createPersonaVersion({
    tenantId: tenant.id, name: 'Zara', greeting: 'Hello', personality: 'Friendly', tone: 'warm',
    speakingStyle: 'Professional', permittedLanguages: ['en'], contextWindowMessages: 8,
    voiceName: '', voiceLanguage: 'en', voiceRate: 1, voicePitch: 0, voiceVolume: 1, status: 'draft',
  });
  await store.publishPersonaVersion(tenant.id, persona.id);
  const catalog = await store.createIntentCatalogVersion({
    tenantId: tenant.id, status: 'draft', sourceFileName: 'unit.json',
    sourceHash: 'a'.repeat(64), parserVersion: 'unit',
    catalog: { tenantScope: tenant.slug, intents: [], signals: [], slots: [], relations: [], workflowBindings: [] },
  });
  await store.publishIntentCatalogVersion(tenant.id, catalog.id);
  const session = await store.createSession(tenant.id, persona.id);
  const clientMessageId = randomUUID(), maskedMessage = 'Hello';
  const userMessage = await store.addMessage({
    id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user',
    maskedContent: maskedMessage, clientMessageId, citations: [], response: null, createdAt: new Date().toISOString(),
  });
  const coordinator = { run: vi.fn(async (request: V2CoordinatorRequest) => {
    expect(request.envelope.persona.assistantName).toBe('Zara');
    const publishedV2 = (await store.listIntentCatalogV2Versions(tenant.id)).find(version => version.status === 'published');
    const expectedCatalogId = publishedV2?.id ?? catalog.id;
    expect(request.envelope.catalogVersionId).toBe(expectedCatalogId);
    // Pin the authoritative V2 catalog, falling back to V1 only when V2 is absent.
    const saved = await store.getSession(session.id);
    expect(saved?.conversationState?.catalogVersionId).toBe(expectedCatalogId);
    expect(saved?.stateVersion).toBe(request.envelope.sessionRevision);
    expect(verifyV2Scope(request.envelope.scopeRef, 'unit-test-service-key-123456')?.catalogVersionId).toBe(expectedCatalogId);
    const tool = createV2ToolGateway({
      store, embedding: new DeterministicEmbeddingProvider(),
      serviceKey: 'unit-test-service-key-123456',
    });
    const toolResult = await tool.execute({
      schemaVersion: 2, toolCallId: randomUUID(), toolName: 'get_intent_catalog',
      arguments: {}, scopeRef: request.envelope.scopeRef,
      expectedStateRevision: request.envelope.sessionRevision,
      deadlineAt: new Date(Date.now() + 15_000).toISOString(),
    });
    expect(toolResult.status).toBe('ok');
    return { modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Hello, how can I help?', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted' } as unknown as V2CoordinatorResult;
  }) };
  const input = {
    store, session, tenant, userMessage, coordinator, clientMessageId, maskedMessage,
    messageHash: createHash('sha256').update(maskedMessage).digest('hex'),
    requestId: randomUUID(), scopeSecret: 'unit-test-service-key-123456',
    cache: new MemoryCache(5), tokenVault: new TokenVault('unit-test-vault-key'),
    responseCacheTtlSeconds: 60,
    updateSession: async (candidate: typeof session) => store.updateSession(candidate),
  };
  return { store, tenant, session, coordinator, input };
};

describe('GPT-first controller full-turn unit behavior', () => {
  it('does not treat correlated read-only tool evidence as a PostgreSQL source id', async () => {
    const getSource = vi.fn(async () => { throw new Error('synthetic tool source must not be queried'); });
    const citations = await resolvePublicCitations(
      { getSource } as never,
      'tenant-id',
      ['tool-package-evidence'],
      [{ citationId: 'tool-package-evidence', sourceRef: 'tool-get_available_packages', sourceVersion: 'catalog-v1', text: 'The approved package is available.', approved: true, revoked: false }],
    );
    expect(citations).toEqual([]);
    expect(getSource).not.toHaveBeenCalled();
  });

  it('uses one model decision and saves the guarded reply, intent ledger, and no action', async () => {
    const { store, tenant, session, coordinator, input } = await prepared();
    const reply = await runGPTFirstChatTurn(input);
    expect(reply.answer).toBe('Hello, how can I help?');
    expect(reply.actionProposal).toBeNull();
    expect(coordinator.run).toHaveBeenCalledTimes(1);
    expect(await store.listMessages(session.id, tenant.id)).toHaveLength(2);
    expect((await store.getUserIntentDocument(tenant.id, session.id))?.approvedResponse?.answer).toBe(reply.answer);
    expect(await store.listIntentTurns(tenant.id, session.id)).toHaveLength(1);
    expect(await store.listActionsBySession(session.id, tenant.id)).toHaveLength(0);
  });
  it('records why a model response was replaced without auditing draft or source text', async () => {
    const { store, tenant, session, coordinator, input } = await prepared();
    coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 2, toolCallCount: 1,
      toolTrace: [{
        toolCallId: 'tool-call-12345678', toolName: 'search_knowledge', status: 'ok',
        resultDigest: 'a'.repeat(64), elapsedMs: 1, evidenceRefs: [],
      }],
      approvedEvidence: [],
      candidateResponse: {
        citationIds: ['unknown-citation'], answer: 'Sensitive unverified draft answer',
        nextQuestion: null, nextQuestionKey: null,
      },
      response: {
        citationIds: [], answer: 'I cannot verify that answer safely. I can continue with confirmed information.',
        nextQuestion: null, nextQuestionKey: null, decisionRef: 'fallback-test',
      },
      guardReason: 'invalid_citation', candidateGuardReason: 'invalid_citation',
      knowledgeRepairStatus: 'attempted_error',
      initialClaimFailureReason: 'insufficient_clause_source_overlap',
      initialFailedClauseOrdinal: 2,
      repairCitationCount: 1,
      repairFailureReason: 'repair_execution_error',
      repairClaimFailureReason: null,
      repairFailedClauseOrdinal: null,
    }) as unknown as V2CoordinatorResult);
    await runGPTFirstChatTurn(input);
    const audit = (await store.listAudit(tenant.id)).find(event => event.eventName === 'v2.gpt_first.turn' && event.metadata.sessionId === session.id);
    expect(audit?.metadata).toMatchObject({
      guardReason: 'invalid_citation', candidateGuardReason: 'invalid_citation',
      knowledgeRepairStatus: 'attempted_error',
      initialClaimFailureReason: 'insufficient_clause_source_overlap',
      initialFailedClauseOrdinal: 2,
      repairCitationCount: 1,
      repairFailureReason: 'repair_execution_error',
      repairClaimFailureReason: null, repairFailedClauseOrdinal: null,
      prefetchEvidenceCount: 0, validatedEvidenceCount: 0,
      candidateCitationCount: 1, responseCitationCount: 0,
      failedReadToolCount: 0, fallbackApplied: true,
    });
    expect(JSON.stringify(audit)).not.toContain('Sensitive unverified draft answer');
    expect(JSON.stringify(audit)).not.toContain('unknown-citation');
  });

  it('rejects stale model output without writing an assistant answer', async () => {
    const { store, tenant, session, coordinator, input } = await prepared();
    coordinator.run.mockImplementationOnce(async () => {
      await store.updateSession({ ...session, lastActivityAt: new Date().toISOString() });
      return { modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'Stale', nextQuestion: null, nextQuestionKey: null },
        guardReason: 'accepted' } as unknown as V2CoordinatorResult;
    });
    await expect(runGPTFirstChatTurn(input)).rejects.toThrow('conversation changed');
    expect(await store.listMessages(session.id, tenant.id)).toHaveLength(1);
    expect(await store.getUserIntentDocument(tenant.id, session.id)).toBeNull();
  });
});


import { readFileSync } from 'node:fs';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2, type CatalogV2Document } from './catalog-v2.js';

const publishPlannerFixture = async (store: MemoryStore, tenantId: string, tenantScope: string) => {
  const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
  if (!parsed.ok || !parsed.document) throw new Error('UNIT_CATALOG_FIXTURE_INVALID');
  const catalogV2: CatalogV2Document = parsed.document;
  catalogV2.manifest.tenantScope = tenantScope;
  catalogV2.sheets.CatalogManifest[0]!.tenantScope = tenantScope;
  const version = await store.createIntentCatalogV2Version({
    tenantId, status: 'draft', sourceFileName: 'reviewed-v2.json',
    sourceHash: catalogV2Sha256(catalogV2), parserVersion: 'unit',
    catalogVersionRef: catalogV2VersionRef(catalogV2), catalog: catalogV2,
  });
  await store.publishIntentCatalogV2Version(tenantId, version.id);
  return version;
};

const modelProposal = {
  turnCategory: 'business_goal' as const, primaryGoalKey: 'anc.company_formation',
  candidateGoalKeys: ['anc.company_formation'], matchedSignalIds: ['signal.company.register'],
  supportingTopicKeys: [], runnerUpScore: 15, nextMove: 'confirm_goal' as const,
  nextQuestion: null, proposedToolKey: null, confidenceBand: 'high' as const,
  proposedFacts: [{ key: 'business_activity' as const, maskedValue: 'technology consulting', supportingQuote: 'technology consulting' }],
};


describe('V2 context-aware company formation confirmation (isolated unit)', () => {
  const firstTurn = async (message: string, plan: Record<string, unknown>) => {
    const ctx = await prepared();
    await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    const current = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!current) throw Error('UNIT_CUSTOMER_MESSAGE_MISSING');
    await ctx.store.updateMessage({ ...current, maskedContent: message });
    ctx.input.userMessage = { ...current, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'I can help with that.', nextQuestion: null,
        nextQuestionKey: null, planning: { ...plan, proposedFacts: [] } },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(ctx.input);
    return { ...ctx, reply };
  };

  it.each(['I want to form a company', 'I want to start a company', 'Please incorporate a company'])(
    'prompts for explicit goal confirmation from reviewed natural phrase: %s', async message => {
      const ctx = await firstTurn(message, modelProposal);
      expect(ctx.reply.answer).toContain('Would you like to proceed with company formation?');
      expect(ctx.reply.actionProposal).toBeNull();
      const doc = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
      expect(doc?.goalConfirmed).toBe(false);
      expect(doc?.goalConfirmation?.status).toBe('pending');
      expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
      const audit = (await ctx.store.listAudit(ctx.tenant.id)).find(e => e.eventName === 'v2.catalog.planning_reviewed');
      expect(audit?.metadata).toMatchObject({
        proposalValid: true, goalThresholdMet: true, initiationSupported: true,
        validatedSignalIds: 'signal.company.register', goalConfirmationPending: true, goalConfirmed: false,
      });
    },
  );

  it('does not prompt for goal confirmation during a formation information-only question', async () => {
    const ctx = await firstTurn('Tell me about company formation', {
      ...modelProposal, turnCategory: 'knowledge_advisory', nextMove: 'answer_knowledge',
    });
    expect(ctx.reply.pendingPromptId).toBeNull();
    const doc = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(doc?.goalConfirmed).toBe(false);
    expect(doc?.goalConfirmation).toBeNull();
    expect(doc?.pendingRequirementKey).toBeNull();
    expect(doc?.approvedResponse?.pendingRequirementKey).toBeNull();
    expect(ctx.reply.pendingRequirementKey).toBeNull();
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });

  it('accepts a contextual initiation only after a previous customer formation statement', async () => {
    const ctx = await firstTurn('Tell me about company formation', {
      ...modelProposal, turnCategory: 'knowledge_advisory', nextMove: 'answer_knowledge',
    });
    const next = await followUpTurn(ctx as unknown as Awaited<ReturnType<typeof proposalTurn>>, "Let's start the process");
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'We can get started.', nextQuestion: null,
        nextQuestionKey: null, planning: { ...modelProposal, matchedSignalIds: [], proposedFacts: [] } },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(next);
    expect(reply.answer).toContain('Would you like to proceed with company formation?');
    expect(reply.actionProposal).toBeNull();
    const audit = (await ctx.store.listAudit(ctx.tenant.id)).filter(e => e.eventName === 'v2.catalog.planning_reviewed').at(-1);
    expect(audit?.metadata).toMatchObject({ contextSupported: true, initiationSupported: true,
      validatedSignalIds: 'signal.company.register', goalConfirmationPending: true });
  });

  it('keeps an information-only turn informational even if GPT proposes a business goal', async () => {
    const ctx = await firstTurn('How do I start company formation?', modelProposal);
    expect(ctx.reply.pendingPromptId).toBeNull();
    const audit = (await ctx.store.listAudit(ctx.tenant.id)).find(e => e.eventName === 'v2.catalog.planning_reviewed');
    expect(audit?.metadata).toMatchObject({ initiationSupported: false });
  });

  it('persists a valid candidate goal proposal when the final draft fails question validation', async () => {
    const ctx = await prepared();
    await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    const message = 'I want to start company formation';
    const current = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!current) throw new Error('UNIT_CUSTOMER_MESSAGE_MISSING');
    await ctx.store.updateMessage({ ...current, maskedContent: message });
    ctx.input.userMessage = { ...current, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    const candidate = { citationIds: [], answer: 'I can help with company formation.', nextQuestion: 'Would you like to proceed?', nextQuestionKey: null, planning: { ...modelProposal, proposedFacts: [] } };
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      candidateResponse: candidate,
      response: { citationIds: [], answer: 'I could not verify that response just now.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'invalid_question', candidateGuardReason: 'invalid_question',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(ctx.input);
    expect(reply.answer).toContain('Would you like to proceed with company formation?');
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document).toMatchObject({ businessGoalKey: 'anc.company_formation', goalConfirmed: false });
    expect(document?.goalConfirmation?.status).toBe('pending');
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });

  it('cannot trigger from a fabricated model signal with no observed customer evidence', async () => {
    const ctx = await firstTurn('Hello', {
      ...modelProposal, matchedSignalIds: ['signal.company.register'], confidenceBand: 'high',
    });
    expect(ctx.reply.pendingPromptId).toBeNull();
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.goalConfirmed).toBe(false);
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });
});
describe('V2-only publication without a legacy V1 catalog', () => {
  it('pins a published V2 catalog and exposes its read-only catalog and RAG tools', async () => {
    const { store, tenant, coordinator, input, session } = await prepared();
    const v2 = await publishPlannerFixture(store, tenant.id, tenant.slug);
    // Simulates a tenant with no published V1 catalog and no V1 lookup record.
    store.getPublishedIntentCatalog = async () => null;
    store.getIntentCatalogVersion = async () => null;
    coordinator.run.mockImplementationOnce(async request => {
      expect(request.envelope.catalogVersionId).toBe(v2.id);
      expect(request.envelope.catalogV2?.versionRef).toBe(v2.catalogVersionRef);
      const pinned = await store.getSession(session.id);
      expect(pinned?.conversationState?.catalogVersionId).toBe(v2.id);
      const gateway = createV2ToolGateway({
        store, embedding: new DeterministicEmbeddingProvider(),
        serviceKey: 'unit-test-service-key-123456',
      });
      for (const toolName of ['get_intent_catalog', 'search_knowledge'] as const) {
        const response = await gateway.execute({
          schemaVersion: 2, toolCallId: randomUUID(), toolName,
          arguments: toolName === 'search_knowledge' ? { query: 'company formation steps', resultCount: 3 } : {},
          scopeRef: request.envelope.scopeRef, expectedStateRevision: request.envelope.sessionRevision,
          deadlineAt: new Date(Date.now() + 15_000).toISOString(),
        });
        expect(response.status, toolName).toBe('ok');
        if (toolName === 'get_intent_catalog') {
          expect((response.result as { catalogV2: { versionRef: string } }).catalogV2.versionRef).toBe(v2.catalogVersionRef);
        }
      }
      return { modelRequestCount: 1, toolCallCount: 2, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'I can help explain the company setup process.', nextQuestion: null,
          nextQuestionKey: null }, guardReason: 'accepted' } as unknown as V2CoordinatorResult;
    });
    const reply = await runGPTFirstChatTurn(input);
    expect(reply.actionProposal).toBeNull();
    expect((await store.getUserIntentDocument(tenant.id, session.id))?.catalogSource).toBe('v2');
    expect((await store.getUserIntentDocument(tenant.id, session.id))?.catalogVersionRef).toBe(v2.catalogVersionRef);
    expect((await store.listActionsBySession(session.id, tenant.id))).toEqual([]);
  });

  it('never treats a V2 draft as published when no legacy V1 exists', async () => {
    const { store, tenant, input } = await prepared();
    store.getPublishedIntentCatalog = async () => null;
    store.getIntentCatalogVersion = async () => null;
    const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
    if (!parsed.document) throw new Error('V2_FIXTURE_INVALID');
    parsed.document.manifest.tenantScope = tenant.slug;
    parsed.document.sheets.CatalogManifest[0]!.tenantScope = tenant.slug;
    await store.createIntentCatalogV2Version({
      tenantId: tenant.id, status: 'draft', sourceFileName: 'awaiting-review.json',
      sourceHash: catalogV2Sha256(parsed.document), parserVersion: 'unit',
      catalogVersionRef: catalogV2VersionRef(parsed.document), catalog: parsed.document,
    });
    await expect(runGPTFirstChatTurn(input)).rejects.toThrow('Publish the reviewed V2 intent catalog');
    expect(await store.getUserIntentDocument(tenant.id, input.session.id)).toBeNull();
  });
});

describe('published Catalog V2 planning in the GPT-first controller', () => {
  it('stores a scored, observed goal as UNCONFIRMED and records an intent decision revision', async () => {
    const { store, tenant, coordinator, input, session } = await prepared();
    const catalog = await publishPlannerFixture(store, tenant.id, tenant.slug);
    const message = 'I want to register a company for technology consulting';
    const userMessage = await store.getMessageByClientId(session.id, input.clientMessageId);
    if (!userMessage) throw new Error('UNIT_MESSAGE_MISSING');
    await store.updateMessage({ ...userMessage, maskedContent: message });
    input.userMessage = { ...userMessage, maskedContent: message };
    input.maskedMessage = message;
    input.messageHash = createHash('sha256').update(message).digest('hex');
    coordinator.run.mockImplementationOnce(async request => {
      expect(request.envelope.catalogV2?.versionRef).toBe(catalog.catalogVersionRef);
      return {
        modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'I can help with your company-formation request.', nextQuestion: null,
          nextQuestionKey: null, planning: modelProposal },
        guardReason: 'accepted',
      } as unknown as V2CoordinatorResult;
    });
    const answer = await runGPTFirstChatTurn(input);
    const document = await store.getUserIntentDocument(tenant.id, session.id);
    expect(answer.actionProposal).toBeNull();
    expect(document).toMatchObject({ catalogSource: 'v2', catalogVersionRef: catalog.catalogVersionRef,
      businessGoalKey: 'anc.company_formation', turnIntentKey: 'goal.company_formation', goalConfirmed: false });
    expect(document?.verifiedFacts.business_activity).toMatchObject({
      maskedValue: 'technology consulting', source: 'visitor',
      evidenceRefs: ['customer-message:' + input.userMessage.id],
    });
    const turns = await store.listIntentTurns(tenant.id, session.id);
    expect(turns[0]).toMatchObject({ intentCategory: 'business_goal', businessGoalKey: 'anc.company_formation' });
    expect(turns[0]?.sourceRefs).toContain('catalog-signal:signal.company.register');
    expect(await store.listActionsBySession(session.id, tenant.id)).toEqual([]);
    const audit = (await store.listAudit(tenant.id)).find(event => event.eventName === 'v2.catalog.planning_reviewed');
    expect(audit?.metadata).toMatchObject({ accepted: true, actionAuthorized: false,
      catalogVersionRef: catalog.catalogVersionRef, score: 100,
      goalThresholdMet: true, validatedSignalIds: 'signal.company.register,signal.activity.technology,signal.activity.consulting' });
    expect(typeof audit?.metadata.sessionRevision).toBe('number');
  });

  it('rejects fabricated match evidence even when the model claims high confidence', async () => {
    const { store, tenant, coordinator, input, session } = await prepared();
    await publishPlannerFixture(store, tenant.id, tenant.slug);
    coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Hello, how can I help?', nextQuestion: null,
        nextQuestionKey: null, planning: modelProposal },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const result = await runGPTFirstChatTurn(input);
    const document = await store.getUserIntentDocument(tenant.id, session.id);
    expect(result.actionProposal).toBeNull();
    expect(document?.catalogSource).toBe('v2');
    expect(document?.businessGoalKey).toBeNull();
    expect(document?.goalConfirmed).toBe(false);
    const audit = (await store.listAudit(tenant.id)).find(event => event.eventName === 'v2.catalog.planning_reviewed');
    expect(audit?.metadata).toMatchObject({
      accepted: true, proposalValid: true, actionAuthorized: false,
      goalThresholdMet: false, initiationSupported: false, score: 0,
      validatedSignalIds: '', rejectedSignalIds: 'signal.company.register',
      goalConfirmationPending: false, goalConfirmed: false,
    });
  });
});


import { validateQuotedV2CustomerFacts } from './v2-customer-fact-provenance.js';

describe('quoted customer fact provenance (pure unit)', () => {
  it('accepts only facts supported by an exact customer quote', () => {
    const facts = validateQuotedV2CustomerFacts([
      { key: 'business_activity', maskedValue: 'technology consulting', supportingQuote: 'technology consulting' },
      { key: 'visa_count', maskedValue: '3', supportingQuote: 'three visas' },
      { key: 'timeline', maskedValue: 'next quarter', supportingQuote: 'next quarter' },
    ], 'I plan technology consulting and need three visas by next quarter', 'message-12345678', 5);
    expect(facts.business_activity).toMatchObject({ source: 'visitor', maskedValue: 'technology consulting', messageSequence: 5 });
    expect(facts.visa_count?.maskedValue).toBe('3');
    expect(facts.timeline?.maskedValue).toBe('next quarter');
  });
  it('rejects invented, negated, sensitive, and conflicting facts', () => {
    const facts = validateQuotedV2CustomerFacts([
      { key: 'visa_count', maskedValue: '3', supportingQuote: 'not three visas' },
      { key: 'business_activity', maskedValue: 'construction', supportingQuote: 'consulting' },
      { key: 'entity_type', maskedValue: 'LLC', supportingQuote: 'LLC' },
      { key: 'entity_type', maskedValue: 'FZE', supportingQuote: 'FZE' },
      { key: 'timeline', maskedValue: 'next week', supportingQuote: 'customer@example.com next week' },
    ], 'I need not three visas; I run consulting, and LLC or FZE suits me, customer@example.com next week.', 'message-12345678', 4);
    expect(facts).toEqual({});
  });
});


const proposalTurn = async () => {
  const ctx = await prepared();
  await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
  const message = 'I want to register a company for technology consulting';
  const user = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
  if (!user) throw new Error('UNIT_MESSAGE_MISSING');
  await ctx.store.updateMessage({ ...user, maskedContent: message });
  ctx.input.userMessage = { ...user, maskedContent: message };
  ctx.input.maskedMessage = message;
  ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
  ctx.coordinator.run.mockImplementationOnce(async () => ({
    modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
    response: { citationIds: [], answer: 'I can explain company formation.', nextQuestion: null,
      nextQuestionKey: null, planning: modelProposal },
    guardReason: 'accepted',
  }) as unknown as V2CoordinatorResult);
  const response = await runGPTFirstChatTurn(ctx.input);
  return { ...ctx, response };
};

const followUpTurn = async (ctx: Awaited<ReturnType<typeof proposalTurn>>, message: string) => {
  const session = await ctx.store.getSession(ctx.session.id);
  if (!session) throw new Error('UNIT_SESSION_MISSING');
  const clientMessageId = randomUUID();
  const userMessage = await ctx.store.addMessage({
    id: randomUUID(), sessionId: ctx.session.id, tenantId: ctx.tenant.id, role: 'user',
    maskedContent: message, clientMessageId, citations: [], response: null,
    createdAt: new Date().toISOString(),
  });
  return { ...ctx.input, session, userMessage, clientMessageId, maskedMessage: message,
    messageHash: createHash('sha256').update(message).digest('hex'),
    requestId: randomUUID() };
};

describe('Catalog V2 customer-confirmed Business Goal (isolated unit)', () => {
  it('issues one durable, catalog/persona/revision-scoped prompt and no action', async () => {
    const { store, tenant, session, response, input } = await proposalTurn();
    const document = await store.getUserIntentDocument(tenant.id, session.id);
    const state = await store.getSession(session.id);
    expect(response.answer).toContain('Would you like to proceed with company formation?');
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.goalConfirmation).toMatchObject({
      status: 'pending', goalKey: 'anc.company_formation',
      promptId: response.messageId, proposalMessageId: input.userMessage.id,
      catalogVersionRef: document?.catalogVersionRef,
      personaVersionId: session.personaVersionId,
      sessionRevision: state?.stateVersion,
      intentRevision: document?.revision,
    });
    expect(await store.listActionsBySession(session.id, tenant.id)).toEqual([]);
  });

  it('accepts scoped explicit confirmation once, with immutable message evidence', async () => {
    const ctx = await proposalTurn();
    const confirmation = await followUpTurn(ctx, 'Yes, proceed.');
    const reply = await runGPTFirstChatTurn(confirmation);
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(reply.actionProposal).toBeNull();
    expect(reply.pendingPromptId).toBeNull();
    const committedCustomer = await ctx.store.getMessageByClientId(ctx.session.id, confirmation.clientMessageId);
    expect(committedCustomer?.response).toMatchObject({ messageId: reply.messageId, answer: reply.answer });
    expect((await ctx.store.listMessages(ctx.session.id, ctx.tenant.id)).filter(message => message.id === reply.messageId && message.role === 'assistant')).toHaveLength(1);
    expect(document?.goalConfirmed).toBe(true);
    expect(document?.businessGoalKey).toBe('anc.company_formation');
    const lifecycleSession = await ctx.store.getSession(ctx.session.id);
    const activeJourney = lifecycleSession?.conversationState?.intentProgress?.entries['anc.company_formation'];
    expect(document?.currentStageKey).toBe('lead_generation');
    expect(document?.opportunityId).toBeTruthy();
    expect(document?.opportunityId).toBe(activeJourney?.journeyId);
    expect(activeJourney?.lifecycle?.currentStage).toBe('lead_generation');
    expect(activeJourney?.lifecycle?.revision).toBe(0);
    expect(activeJourney?.lifecycle?.stages.lead_generation.status).toBe('awaiting_customer');
    expect(document?.goalConfirmation).toMatchObject({
      status: 'confirmed', promptId: ctx.response.messageId,
      customerMessageId: confirmation.userMessage.id,
      customerClientMessageId: confirmation.clientMessageId,
      decisionIntentRevision: 0,
    });
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
    const audit = await ctx.store.listAudit(ctx.tenant.id);
    expect(audit.filter(event => event.eventName === 'v2.goal_confirmation.confirmed')).toHaveLength(1);
    await expect(runGPTFirstChatTurn(confirmation)).rejects.toThrow('already been assessed');
    const saved = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(saved?.goalConfirmation?.customerMessageId).toBe(confirmation.userMessage.id);
  });

  it.each([
    ['No, I only need information.', 'rejected'],
    ['Actually, I want to explore another service.', 'corrected'],
  ])('supports %s without clearing unrelated verified facts', async (text, status) => {
    const ctx = await proposalTurn();
    const next = await followUpTurn(ctx, text);
    const reply = await runGPTFirstChatTurn(next);
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.goalConfirmation?.status).toBe(status);
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.businessGoalKey).toBeNull();
    expect(document?.verifiedFacts.business_activity?.maskedValue).toBe('technology consulting');
    expect(reply.actionProposal).toBeNull();
  });

  it('does not commit a confirmed goal when the original customer reply was already answered', async () => {
    const ctx = await proposalTurn();
    const confirmation = await followUpTurn(ctx, 'Yes, proceed.');
    await ctx.store.updateMessage({ ...confirmation.userMessage, response: { messageId: 'another-turn' } });
    await expect(runGPTFirstChatTurn(confirmation)).rejects.toThrow('already committed or the message scope changed');
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.goalConfirmation?.status).toBe('pending');
    expect(await ctx.store.listIntentTurns(ctx.tenant.id, ctx.session.id)).toHaveLength(1);
  });

  it('preserves the same scoped prompt during a knowledge question and ambiguity', async () => {
    const ctx = await proposalTurn();
    const question = await followUpTurn(ctx, 'What documents are needed?');
    const answer = await runGPTFirstChatTurn(question);
    let document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(answer.pendingPromptId).toBe(ctx.response.messageId);
    expect(document?.goalConfirmation?.status).toBe('pending');
    const ambiguous = await followUpTurn(ctx, 'Maybe');
    const clarification = await runGPTFirstChatTurn(ambiguous);
    expect(clarification.answer).toContain('Would you like to proceed');
    expect(clarification.pendingPromptId).toBe(ctx.response.messageId);
    document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.goalConfirmed).toBe(false);
    const valid = await followUpTurn(ctx, 'Yes, proceed.');
    await runGPTFirstChatTurn(valid);
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.goalConfirmed).toBe(true);
  });

  it('rejects stale session cursors and cross-tenant decisions', async () => {
    const ctx = await proposalTurn();
    const stored = await ctx.store.getSession(ctx.session.id);
    if (!stored) throw new Error('UNIT_SESSION_MISSING');
    await ctx.store.updateSession({ ...stored, lastActivityAt: new Date().toISOString() });
    const stale = await followUpTurn(ctx, 'Yes');
    await expect(runGPTFirstChatTurn(stale)).rejects.toThrow('no longer current');
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.goalConfirmed).toBe(false);
    const other = await ctx.store.createTenant({ name: 'Other', slug: 'other' });
    await expect(runGPTFirstChatTurn({ ...stale, tenant: other })).rejects.toThrow('scope does not match');
  });

  it('fails closed when an unrelated V2 catalog revision replaces the pinned publication', async () => {
    const ctx = await proposalTurn();
    const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
    if (!parsed.document) throw new Error('UNIT_CATALOG_FIXTURE_INVALID');
    parsed.document.manifest.tenantScope = ctx.tenant.slug;
    parsed.document.sheets.CatalogManifest[0]!.tenantScope = ctx.tenant.slug;
    parsed.document.manifest.revision += 1;
    const version = await ctx.store.createIntentCatalogV2Version({
      tenantId: ctx.tenant.id, status: 'draft', sourceFileName: 'updated-v2.json',
      sourceHash: catalogV2Sha256(parsed.document), parserVersion: 'unit',
      catalogVersionRef: catalogV2VersionRef(parsed.document), catalog: parsed.document,
    });
    await ctx.store.publishIntentCatalogV2Version(ctx.tenant.id, version.id);
    const next = await followUpTurn(ctx, 'Yes');
    await expect(runGPTFirstChatTurn(next)).rejects.toThrow('no longer published');
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.goalConfirmed).toBe(false);
  });

  it('does not confirm a standalone yes without an active prompt', async () => {
    const ctx = await prepared();
    await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    const message = 'Yes';
    const user = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!user) throw new Error('UNIT_MESSAGE_MISSING');
    await ctx.store.updateMessage({ ...user, maskedContent: message });
    ctx.input.userMessage = { ...user, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    const result = await runGPTFirstChatTurn(ctx.input);
    expect(result.pendingPromptId).toBeNull();
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.goalConfirmation).toBeNull();
  });

  it('does not ask for company-formation confirmation on a knowledge-only turn', async () => {
    const ctx = await prepared();
    await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    const message = 'I want to register a company for technology consulting';
    const user = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!user) throw new Error('UNIT_MESSAGE_MISSING');
    await ctx.store.updateMessage({ ...user, maskedContent: message });
    ctx.input.userMessage = { ...user, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'These are general formation options.', nextQuestion: null,
        nextQuestionKey: null, planning: { ...modelProposal, turnCategory: 'knowledge_advisory',
          nextMove: 'answer_knowledge' } },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(ctx.input);
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(reply.pendingPromptId).toBeNull();
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.goalConfirmation).toBeNull();
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });
});

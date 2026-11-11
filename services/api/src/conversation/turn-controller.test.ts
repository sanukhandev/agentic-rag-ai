import { describe, expect, it, vi } from 'vitest';
import { chatTurnTimeoutMs, executeV2Turn } from './turn-controller.js';
import type { V2CoordinatorRequest, V2CoordinatorResult } from './coordinator.js';

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
  it('uses a bounded configurable turn deadline that includes retry backoff', () => {
    expect(chatTurnTimeoutMs({ CHAT_TURN_TIMEOUT_MS: '120000' })).toBe(120_000);
    expect(chatTurnTimeoutMs({ CHAT_TURN_TIMEOUT_MS: '1000' })).toBe(120_000);
    expect(chatTurnTimeoutMs({ CHAT_TURN_TIMEOUT_MS: '999999' })).toBe(300_000);
  });

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
import { MemoryStore } from '../store-memory.js';
import { MemoryCache } from '../cache.js';
import { TokenVault } from '../privacy.js';
import { newConversationState } from '../conversation-state.js';
import { isCommercialDocumentRequest, isV2PackageQuestion, resolvePublicCitations, runGPTFirstChatTurn } from './turn-controller.js';
import { createV2ToolGateway, verifyV2Scope } from './tool-gateway.js';
import { DeterministicEmbeddingProvider } from '../embedding.js';
import { ActionGateway } from '../actions.js';
import { evaluatePersistedV2ActionConfirmation } from './journey-bootstrap.js';

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
    actionGateway: new ActionGateway(store),
    leadProviderReady: true,
  };
  return { store, tenant, session, coordinator, input };
};

describe('GPT-first controller full-turn unit behavior', () => {
  it('recognizes a document request as a commercial handoff only when it is not a status question', () => {
    expect(isCommercialDocumentRequest('okay what all documents you need')).toBe(true);
    expect(isCommercialDocumentRequest('what is the document status')).toBe(false);
  });

  it('recognizes package questions before model composition', () => {
    expect(isV2PackageQuestion('what all packages are there?')).toBe(true);
    expect(isV2PackageQuestion('what visa package options are available?')).toBe(true);
    expect(isV2PackageQuestion('how many visas will I need?')).toBe(false);
    expect(isV2PackageQuestion('what are the visa requirements?')).toBe(false);
    expect(isV2PackageQuestion('what documents do you need?')).toBe(false);
  });

  it('returns selectable approved package options for a package question', async () => {
    const ctx = await prepared();
    const version = await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    await ctx.store.createPackageOffering({
      id: randomUUID(), tenantId: ctx.tenant.id, catalogVersionId: null, catalogVersionRef: version.catalogVersionRef,
      packageKey: 'growth', name: 'Growth package', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 2, officeRequirement: 'shared', inclusions: ['company registration'], priceMinor: 499900,
      currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [],
      processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
      approvalStatus: 'approved', sourceRefs: ['unit'], createdAt: new Date().toISOString(),
    });
    const user = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!user) throw new Error('UNIT_MESSAGE_MISSING');
    const message = 'What packages do you offer?';
    await ctx.store.updateMessage({ ...user, maskedContent: message });
    ctx.input.userMessage = { ...user, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    const reply = await runGPTFirstChatTurn(ctx.input);
    expect(reply.packageOptions).toEqual([expect.objectContaining({ packageKey: 'growth', name: 'Growth package', priceMinor: 499900 })]);
    expect(reply.packageSelectionReady).toBe(false);
    expect(reply.answer).not.toMatch(/choose the package .*quote for/iu);
    expect(reply.answer).not.toContain('enable quote preparation');
    expect(reply.actionProposal).toBeNull();
  });

  it('keeps all approved package evidence for comparison questions', async () => {
    const ctx = await prepared();
    const version = await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    for (const [packageKey, name] of [['starter', 'Starter package'], ['growth', 'Growth package']] as const) {
      await ctx.store.createPackageOffering({
        id: randomUUID(), tenantId: ctx.tenant.id, catalogVersionId: null, catalogVersionRef: version.catalogVersionRef,
        packageKey, name, eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: packageKey === 'starter' ? 1 : 2,
        officeRequirement: 'shared', inclusions: ['company registration'], priceMinor: packageKey === 'starter' ? 249900 : 499900,
        currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development only',
        requiredDocuments: [], exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['unit'], createdAt: new Date().toISOString(),
      });
    }
    const initial = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!initial) throw new Error('UNIT_MESSAGE_MISSING');
    const message = 'Compare the Starter and Growth packages';
    await ctx.store.updateMessage({ ...initial, maskedContent: message });
    ctx.input.userMessage = { ...initial, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    const reply = await runGPTFirstChatTurn(ctx.input);
    expect(reply.answer).toContain('Starter package');
    expect(reply.answer).toContain('Growth package');
  });

  it('preserves advisory document questions when package evidence cannot answer them', async () => {
    const ctx = await prepared();
    const version = await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    await ctx.store.createPackageOffering({
      id: randomUUID(), tenantId: ctx.tenant.id, catalogVersionId: null, catalogVersionRef: version.catalogVersionRef,
      packageKey: 'growth', name: 'Growth package', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 2,
      officeRequirement: 'shared', inclusions: ['company registration'], priceMinor: 499900, currency: 'AED',
      pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development only',
      requiredDocuments: [], exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['unit'], createdAt: new Date().toISOString(),
    });
    const initial = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!initial) throw new Error('UNIT_MESSAGE_MISSING');
    const message = 'What documents are required for the Growth package?';
    await ctx.store.updateMessage({ ...initial, maskedContent: message });
    ctx.input.userMessage = { ...initial, maskedContent: message };
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    const reply = await runGPTFirstChatTurn(ctx.input);
    expect(reply.answer).toMatch(/document|identity|proceed/iu);
    expect(reply.answer).not.toContain('Which package would you like to explore first?');
  });

  it('reloads only the selected package variant after an offer reply', async () => {
    const ctx = await prepared();
    const version = await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    for (const [packageKey, name, priceMinor] of [['growth_annual', 'Growth (Annual)', 499900], ['growth_monthly', 'Growth (Monthly)', 59900]] as const) {
      await ctx.store.createPackageOffering({
        id: randomUUID(), tenantId: ctx.tenant.id, catalogVersionId: null, catalogVersionRef: version.catalogVersionRef,
        packageKey, name, eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 2, officeRequirement: 'shared',
        inclusions: ['company registration'], priceMinor, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null,
        additionalFees: [], processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
        approvalStatus: 'approved', sourceRefs: ['unit'], createdAt: new Date().toISOString(),
      });
    }
    const current = await ctx.store.getSession(ctx.session.id);
    if (!current) throw new Error('UNIT_SESSION_MISSING');
    const state = newConversationState();
    state.pendingFollowUpOffer = {
      offerKey: randomUUID(), intentKey: null, sourceMessageId: randomUUID(), sourceQuery: 'What packages do you offer?',
      options: [
        { key: 'package_growth_annual', label: 'Growth (Annual)', retrievalHints: ['growth_annual', 'Growth (Annual)'] },
        { key: 'package_growth_monthly', label: 'Growth (Monthly)', retrievalHints: ['growth_monthly', 'Growth (Monthly)'] },
      ], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    };
    await ctx.store.updateSession({ ...current, conversationState: state });
    const initial = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!initial) throw new Error('UNIT_MESSAGE_MISSING');
    const message = "I'll take Growth (Annual)";
    await ctx.store.updateMessage({ ...initial, maskedContent: message });
    ctx.input.userMessage = { ...initial, maskedContent: message };
    ctx.input.session = (await ctx.store.getSession(ctx.session.id))!;
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    ctx.coordinator.run.mockImplementationOnce(async request => {
      expect(request.envelope.approvedKnowledge).toHaveLength(1);
      expect(request.envelope.approvedKnowledge?.[0]?.text).toContain('Growth (Annual)');
      expect(request.envelope.approvedKnowledge?.[0]?.text).not.toContain('Growth (Monthly)');
      return { modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'Growth (Annual) selected.', nextQuestion: null, nextQuestionKey: null }, guardReason: 'accepted' } as unknown as V2CoordinatorResult;
    });
    const reply = await runGPTFirstChatTurn(ctx.input);
    expect(reply.answer).toContain('Growth (Annual)');
  });

  it('persists package options and resolves a natural package selection on the next turn', async () => {
    const ctx = await prepared();
    const version = await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug);
    for (const [packageKey, name, priceMinor] of [['starter', 'Starter package', 249900], ['growth', 'Growth package', 499900], ['premium', 'Premium package', 789900]] as const) {
      await ctx.store.createPackageOffering({
        id: randomUUID(), tenantId: ctx.tenant.id, catalogVersionId: null, catalogVersionRef: version.catalogVersionRef,
        packageKey, name, eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: packageKey === 'starter' ? 1 : packageKey === 'growth' ? 2 : 3,
        officeRequirement: 'shared', inclusions: ['company registration'], priceMinor, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null,
        additionalFees: [], processingTime: 'development only', requiredDocuments: [], exclusions: [], availability: 'development_only',
        approvalStatus: 'approved', sourceRefs: ['unit'], createdAt: new Date().toISOString(),
      });
    }
    const initial = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!initial) throw new Error('UNIT_MESSAGE_MISSING');
    const firstMessage = 'What packages do you offer?';
    await ctx.store.updateMessage({ ...initial, maskedContent: firstMessage });
    ctx.input.userMessage = { ...initial, maskedContent: firstMessage };
    ctx.input.maskedMessage = firstMessage;
    ctx.input.messageHash = createHash('sha256').update(firstMessage).digest('hex');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Here are the Starter package, Growth package, and Premium package options. Which package would you like to explore first?', nextQuestion: 'Which package would you like to explore first?', nextQuestionKey: 'package_selection' },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const packageListReply = await runGPTFirstChatTurn(ctx.input);
    expect(packageListReply.answer).toContain('Which package would you like to explore first?');
    const afterList = await ctx.store.getSession(ctx.session.id);
    const offer = afterList?.conversationState?.pendingFollowUpOffer;
    expect(offer?.expiresAt && Date.parse(offer.expiresAt)).toBeGreaterThan(Date.now());
    expect(offer?.options.map(option => option.key)).toEqual(['package_growth', 'package_premium', 'package_starter']);

    const selectedClientMessageId = randomUUID();
    const selected = await ctx.store.addMessage({
      id: randomUUID(), sessionId: ctx.session.id, tenantId: ctx.tenant.id, role: 'user', maskedContent: 'I will go with Growth',
      clientMessageId: selectedClientMessageId, citations: [], response: null, createdAt: new Date().toISOString(),
    });
    const secondSession = await ctx.store.getSession(ctx.session.id);
    if (!secondSession) throw new Error('UNIT_SESSION_MISSING');
    const secondInput = { ...ctx.input, session: secondSession, userMessage: selected, clientMessageId: selectedClientMessageId, maskedMessage: selected.maskedContent,
      messageHash: createHash('sha256').update(selected.maskedContent).digest('hex'), requestId: randomUUID() };
    ctx.coordinator.run.mockImplementationOnce(async request => {
      expect(request.envelope.approvedKnowledge?.[0]?.text).toContain('Growth package');
      return { modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'Growth package includes the approved company-formation options.', nextQuestion: null, nextQuestionKey: null }, guardReason: 'accepted' } as unknown as V2CoordinatorResult;
    });
    const reply = await runGPTFirstChatTurn(secondInput);
    expect(reply.answer).toContain('Growth package');
    expect(reply.answer).not.toContain('What would you like help with?');
    expect((await ctx.store.getSession(ctx.session.id))?.conversationState?.pendingFollowUpOffer).toBeNull();
  });

  it('does not accept a package selection after the pending offer expires', async () => {
    const ctx = await prepared();
    const current = await ctx.store.getSession(ctx.session.id);
    if (!current) throw new Error('UNIT_SESSION_MISSING');
    const conversationState = newConversationState();
    conversationState.pendingFollowUpOffer = {
      offerKey: randomUUID(), intentKey: null, sourceMessageId: randomUUID(), sourceQuery: 'What packages do you offer?',
      options: [{ key: 'package_growth', label: 'Growth package', retrievalHints: ['growth'] }],
      issuedAt: new Date(Date.now() - 3_600_000).toISOString(), expiresAt: new Date(Date.now() - 1_800_000).toISOString(),
    };
    await ctx.store.updateSession({ ...current, conversationState });
    const user = await ctx.store.getMessageByClientId(ctx.session.id, ctx.input.clientMessageId);
    if (!user) throw new Error('UNIT_MESSAGE_MISSING');
    const message = 'I will go with Growth';
    const clientMessageId = randomUUID();
    await ctx.store.updateMessage({ ...user, maskedContent: message });
    ctx.input.userMessage = { ...user, maskedContent: message };
    ctx.input.session = (await ctx.store.getSession(ctx.session.id))!;
    ctx.input.clientMessageId = clientMessageId;
    ctx.input.maskedMessage = message;
    ctx.input.messageHash = createHash('sha256').update(message).digest('hex');
    ctx.coordinator.run.mockImplementationOnce(async request => {
      expect(request.envelope.approvedKnowledge).toEqual([]);
      return { modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'I can help with the next step.', nextQuestion: null, nextQuestionKey: null }, guardReason: 'accepted' } as unknown as V2CoordinatorResult;
    });
    const reply = await runGPTFirstChatTurn(ctx.input);
    expect(reply.answer).not.toContain('Growth package');
    expect((await ctx.store.getSession(ctx.session.id))?.conversationState?.pendingFollowUpOffer).toBeNull();
  });

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
    expect(reply.answer).toBe('Hello! I can help you explore your options. What would you like to understand first?');
    expect(reply.actionProposal).toBeNull();
    expect(coordinator.run).toHaveBeenCalledTimes(1);
    expect(await store.listMessages(session.id, tenant.id)).toHaveLength(2);
    expect((await store.getUserIntentDocument(tenant.id, session.id))?.approvedResponse?.answer).toBe(reply.answer);
    expect(await store.listIntentTurns(tenant.id, session.id)).toHaveLength(1);
    expect(await store.listActionsBySession(session.id, tenant.id)).toHaveLength(0);
  });

  it('persists a guarded conversational follow-up offer for the next turn', async () => {
    const { store, tenant, session, coordinator, input } = await prepared();
    coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Of course. Here are the details. Would you like me to explain this in more detail?', nextQuestion: 'Would you like me to explain this in more detail?', nextQuestionKey: 'conversation_focus' },
      draft: { answer: 'Of course. Here are the details. Would you like me to explain this in more detail?', citationIds: [], proposedIntent: null, followUpOptions: [{ key: 'explain_more', label: 'explain this in more detail', retrievalHints: [] }] },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    await runGPTFirstChatTurn(input);
    const persisted = await store.getSession(session.id);
    expect(persisted?.conversationState?.pendingFollowUpOffer).toMatchObject({
      options: [{ key: 'explain_more', label: 'explain this in more detail', retrievalHints: [] }],
    });
    expect(persisted?.conversationState?.pendingFollowUpOffer?.sourceQuery).toBe('Hello');
    expect(await store.listMessages(session.id, tenant.id)).toHaveLength(2);
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
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2, type CatalogV2Document } from './catalog.js';

const publishPlannerFixture = async (store: MemoryStore, tenantId: string, tenantScope: string, fixture = 'ancfz-catalog-v2.json', configure?: (catalog: CatalogV2Document) => void) => {
  const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('../fixtures/' + fixture, import.meta.url), 'utf8')));
  if (!parsed.ok || !parsed.document) throw new Error('UNIT_CATALOG_FIXTURE_INVALID');
  const catalogV2: CatalogV2Document = parsed.document;
  catalogV2.manifest.tenantScope = tenantScope;
  catalogV2.sheets.CatalogManifest[0]!.tenantScope = tenantScope;
  configure?.(catalogV2);
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
      expect(ctx.reply.answer).toContain('Would you like to proceed with start a company?');
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

  it('uses independently observed initiation evidence when the model turn category is navigation', async () => {
    const ctx = await firstTurn('I am planning to start a technology consulting company in Ajman', {
      ...modelProposal, turnCategory: 'conversation_navigation' as const,
    });
    expect(ctx.reply.answer).toContain('Would you like to proceed with start a company?');
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.goalConfirmation?.status).toBe('pending');
  });

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
    expect(reply.answer).toContain('Would you like to proceed with start a company?');
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
    expect(reply.answer).toContain('Would you like to proceed with start a company?');
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
      expect(request.envelope.catalogV2?.enabledReadToolKeys).toContain('get_available_packages');
      expect(request.envelope.catalogV2?.enabledReadToolKeys).not.toContain('package.read_available');
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
    const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('../fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
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


import { extractQuotedV2CustomerFacts, validateQuotedV2CustomerFacts } from './customer-fact-provenance.js';

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
  it('extracts explicit non-sensitive visa and correction timeline values', () => {
    const facts = extractQuotedV2CustomerFacts('I need one visa and two months, not next month.', 'message-12345678', 4);
    expect(facts.visa_count?.maskedValue).toBe('1');
    expect(facts.timeline?.maskedValue).toBe('two months');
  });
});


const proposalTurn = async (fixture = 'ancfz-catalog-v2.json', configure?: (catalog: CatalogV2Document) => void) => {
  const ctx = await prepared();
  await publishPlannerFixture(ctx.store, ctx.tenant.id, ctx.tenant.slug, fixture, configure);
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

const followUpTurn = async (ctx: Awaited<ReturnType<typeof proposalTurn>>, message: string, options: { postbackValue?: string } = {}) => {
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
    requestId: randomUUID(), postbackValue: options.postbackValue ?? null };
};

describe('Catalog V2 customer-confirmed Business Goal (isolated unit)', () => {
  it('issues one durable, catalog/persona/revision-scoped prompt and no action', async () => {
    const { store, tenant, session, response, input } = await proposalTurn();
    const document = await store.getUserIntentDocument(tenant.id, session.id);
    const state = await store.getSession(session.id);
    expect(response.answer).toContain('Would you like to proceed with start a company?');
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

  it('persists masked contact requirements and advances the V2 contact cursor', async () => {
    const ctx = await proposalTurn('ancfz-catalog-v2-seven-stage.json');
    await runGPTFirstChatTurn({
      ...await followUpTurn(ctx, 'Yes, proceed.'),
      coordinator: ctx.coordinator,
    });
    const confirmed = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    if (!confirmed) throw new Error('UNIT_INTENT_DOCUMENT_MISSING');
    await ctx.store.updateUserIntentDocument({
      document: { ...confirmed, pendingRequirementKey: 'lead_contact_name' },
      expectedRevision: confirmed.revision,
    });
    const contactTurn = async (message: string, answer: string) => {
      const next = await followUpTurn(ctx, message);
      ctx.coordinator.run.mockImplementationOnce(async () => ({
        modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer, nextQuestion: null, nextQuestionKey: null },
        guardReason: 'accepted',
      }) as unknown as V2CoordinatorResult);
      return runGPTFirstChatTurn(next);
    };
    await contactTurn('[NAME_1]', 'Thanks. What email address should I use?');
    let document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.verifiedFacts.lead_contact_name).toMatchObject({ maskedValue: '[NAME_1]', source: 'visitor' });
    expect(document?.pendingRequirementKey).toBe('lead_contact_channel');
    expect((await ctx.store.getSession(ctx.session.id))?.conversationState?.slotValues.name).toBe('[NAME_1]');

    const contactPrompt = await contactTurn('[EMAIL_1]', 'Thanks. Please explicitly consent to sharing your contact details.');
    document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.verifiedFacts.lead_contact_channel).toMatchObject({ maskedValue: '[EMAIL_1]', source: 'visitor' });
    expect(document?.pendingRequirementKey).toBe('lead_crm_consent');
    expect(contactPrompt.consentProposal).toMatchObject({ intent: 'contact.consent', consentRequired: true });

    await contactTurn('Yes, you have my permission to use my contact details for this enquiry.', 'Thanks.');
    document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.verifiedFacts.lead_crm_consent).toMatchObject({ maskedValue: 'true', source: 'visitor' });
    expect((await ctx.store.getSession(ctx.session.id))?.conversationState?.contactConsent).toBe('granted');
    const consentButton = await followUpTurn(ctx, 'Consent to use my contact details', { postbackValue: 'v2:contact-consent:grant' });
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Thanks. Your consent is recorded.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    await runGPTFirstChatTurn(consentButton);
    document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.verifiedFacts.lead_crm_consent).toMatchObject({ maskedValue: 'true', source: 'visitor' });
    expect((await ctx.store.getSession(ctx.session.id))?.conversationState?.contactConsent).toBe('granted');
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });

  it('answers a package question while preserving a pending contact requirement', async () => {
    const ctx = await proposalTurn('ancfz-catalog-v2-seven-stage.json');
    await runGPTFirstChatTurn({ ...await followUpTurn(ctx, 'Yes, proceed.'), coordinator: ctx.coordinator });
    const confirmed = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    if (!confirmed) throw new Error('UNIT_INTENT_DOCUMENT_MISSING');
    await ctx.store.createPackageOffering({
      id: randomUUID(), tenantId: ctx.tenant.id, catalogVersionId: null, catalogVersionRef: confirmed.catalogVersionRef,
      packageKey: 'growth', name: 'Growth package', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 2,
      officeRequirement: 'shared', inclusions: ['company registration'], priceMinor: 499900, currency: 'AED',
      pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development only',
      requiredDocuments: [], exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['unit'],
      createdAt: new Date().toISOString(),
    });
    await ctx.store.updateUserIntentDocument({
      document: { ...confirmed, pendingRequirementKey: 'lead_contact_name' }, expectedRevision: confirmed.revision,
    });
    const packageQuestion = await followUpTurn(ctx, 'What packages are available?');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'I cannot verify that answer safely.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'safe_no_evidence_dialogue',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn({ ...packageQuestion, coordinator: ctx.coordinator });
    expect(reply.answer).toContain('Growth package');
    expect(reply.answer).toContain('AED 4,999.00');
    expect(reply.pendingRequirementKey).toBe('lead_contact_name');
  });

  it.each(['John Price', 'Sarah Fee', 'Can Yilmaz'])('accepts a legitimate contact name containing request vocabulary: %s', async name => {
    const ctx = await proposalTurn('ancfz-catalog-v2-seven-stage.json');
    await runGPTFirstChatTurn({ ...await followUpTurn(ctx, 'Yes, proceed.'), coordinator: ctx.coordinator });
    const confirmed = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    if (!confirmed) throw new Error('UNIT_INTENT_DOCUMENT_MISSING');
    await ctx.store.updateUserIntentDocument({
      document: { ...confirmed, pendingRequirementKey: 'lead_contact_name' }, expectedRevision: confirmed.revision,
    });
    const next = await followUpTurn(ctx, name);
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Thanks. What email address should I use?', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    await runGPTFirstChatTurn(next);
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.verifiedFacts.lead_contact_name?.source).toBe('visitor');
    expect(document?.pendingRequirementKey).toBe('lead_contact_channel');
  });

  it('creates a catalog-gated Lead proposal only after contact consent and an explicit submission request', async () => {
    const ctx = await proposalTurn('ancfz-catalog-v2-seven-stage.json', catalog => {
      catalog.sheets.ToolBindings.find(binding => binding.toolKey === 'lead.create')!.enabled = true;
      catalog.sheets.WorkflowBindings.find(binding => binding.workflowKey === 'crm.lead.create')!.enabled = true;
    });
    await runGPTFirstChatTurn({ ...await followUpTurn(ctx, 'Yes, proceed.'), coordinator: ctx.coordinator });
    const confirmed = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    if (!confirmed) throw new Error('UNIT_INTENT_DOCUMENT_MISSING');
    await ctx.store.updateUserIntentDocument({
      document: { ...confirmed, pendingRequirementKey: 'lead_contact_name' }, expectedRevision: confirmed.revision,
    });
    const turn = async (message: string, answer = 'Thanks.', options: { postbackValue?: string } = {}) => {
      const next = await followUpTurn(ctx, message, options);
      ctx.coordinator.run.mockImplementationOnce(async () => ({
        modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer, nextQuestion: null, nextQuestionKey: null }, guardReason: 'accepted',
      }) as unknown as V2CoordinatorResult);
      return runGPTFirstChatTurn(next);
    };
    await turn('[NAME_1]');
    await turn('[EMAIL_1]');
    const consentReply = await turn('Consent to use my contact details', 'Thanks.', { postbackValue: 'v2:contact-consent:grant' });
    expect(consentReply.actionProposal).toMatchObject({ intent: 'crm.lead.create', consentRequired: false });
    let actions = await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ actionKey: 'lead.create', workflowKey: 'crm.lead.create', state: 'awaiting_confirmation' });
    const persistedSession = await ctx.store.getSession(ctx.session.id);
    if (!persistedSession || !actions[0]) throw new Error('UNIT_ACTION_STATE_MISSING');
    await expect(evaluatePersistedV2ActionConfirmation(ctx.store, persistedSession, actions[0])).resolves.toMatchObject({ applies: true, accepted: true });
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.pendingRequirementKey).toBe('lead_action_confirmation');
    expect((await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id))?.verifiedFacts.lead_action_confirmation).toMatchObject({ maskedValue: 'true', source: 'visitor' });
    await ctx.store.updateAction({ ...actions[0], state: 'reconcile_required', result: { externalReference: 'n8n-404' } });
    const unrelatedTurn = await followUpTurn(ctx, 'Can you explain the available packages?');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Here are the approved options.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const unrelatedReply = await runGPTFirstChatTurn({ ...unrelatedTurn, coordinator: ctx.coordinator });
    expect(unrelatedReply.actionProposal).toBeNull();
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toHaveLength(1);
    await ctx.store.updateAction({ ...actions[0], state: 'awaiting_confirmation', result: null });
    const packageQuestion = await followUpTurn(ctx, 'Can you tell me about the available packages?');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Here are the approved options.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    await runGPTFirstChatTurn({ ...packageQuestion, coordinator: ctx.coordinator });
    actions = await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id);
    expect(actions).toHaveLength(1);
    const confirmation = await followUpTurn(ctx, 'I confirm the authorized submission.');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'Confirmed.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const confirmationReply = await runGPTFirstChatTurn({ ...confirmation, coordinator: ctx.coordinator });
    expect(confirmationReply.answer).toContain('confirmed the Lead submission');
    expect((await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id))[0]).toMatchObject({ state: 'approved' });
  });

  it('keeps disabled Lead submission truthful and hides internal requirement keys', async () => {
    const ctx = await proposalTurn('ancfz-catalog-v2-seven-stage.json');
    await runGPTFirstChatTurn({ ...await followUpTurn(ctx, 'Yes, proceed.'), coordinator: ctx.coordinator });
    const confirmed = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    if (!confirmed) throw new Error('UNIT_INTENT_DOCUMENT_MISSING');
    const updated = await ctx.store.updateUserIntentDocument({
      document: {
        ...confirmed,
        pendingRequirementKey: 'lead_action_confirmation',
        verifiedFacts: {
          ...confirmed.verifiedFacts,
          lead_contact_name: { maskedValue: '[NAME_1]', source: 'visitor', messageSequence: 2, evidenceRefs: ['customer-message:test'], corrected: false },
          lead_contact_channel: { maskedValue: '[EMAIL_1]', source: 'visitor', messageSequence: 2, evidenceRefs: ['customer-message:test'], corrected: false },
          lead_crm_consent: { maskedValue: 'true', source: 'visitor', messageSequence: 2, evidenceRefs: ['customer-message:test'], corrected: false },
        },
      },
      expectedRevision: confirmed.revision,
    });
    if (!updated) throw new Error('UNIT_INTENT_DOCUMENT_UPDATE_FAILED');
    const current = await ctx.store.getSession(ctx.session.id);
    if (!current) throw new Error('UNIT_SESSION_MISSING');
    await ctx.store.updateSession({ ...current, conversationState: { ...current.conversationState!, contactConsent: 'granted', slotValues: { ...current.conversationState!.slotValues, name: '[NAME_1]', email: '[EMAIL_1]' } } });
    const request = await followUpTurn(ctx, 'Please create my Lead');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'The server-authorized pending requirement is lead_action_confirmation.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn({ ...request, coordinator: ctx.coordinator });
    expect(reply.answer).toContain('explicitly confirm');
    expect(reply.answer).not.toContain('lead_action_confirmation');
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });

  it('does not propose a Lead action when the Salesforce adapter is not ready', async () => {
    const ctx = await proposalTurn('ancfz-catalog-v2-seven-stage.json', catalog => {
      catalog.sheets.ToolBindings.find(binding => binding.toolKey === 'lead.create')!.enabled = true;
      catalog.sheets.WorkflowBindings.find(binding => binding.workflowKey === 'crm.lead.create')!.enabled = true;
    });
    ctx.input.leadProviderReady = false;
    await runGPTFirstChatTurn({ ...await followUpTurn(ctx, 'Yes, proceed.'), coordinator: ctx.coordinator });
    const confirmed = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    if (!confirmed) throw new Error('UNIT_INTENT_DOCUMENT_MISSING');
    await ctx.store.updateUserIntentDocument({
      document: { ...confirmed, pendingRequirementKey: 'lead_contact_name' }, expectedRevision: confirmed.revision,
    });
    const turn = async (message: string, options: { postbackValue?: string } = {}) => {
      const next = await followUpTurn(ctx, message, options);
      ctx.coordinator.run.mockImplementationOnce(async () => ({
        modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
        response: { citationIds: [], answer: 'Thanks.', nextQuestion: null, nextQuestionKey: null }, guardReason: 'accepted',
      }) as unknown as V2CoordinatorResult);
      return runGPTFirstChatTurn(next);
    };
    await turn('[NAME_1]');
    await turn('[EMAIL_1]');
    const consentReply = await turn('Consent to use my contact details', { postbackValue: 'v2:contact-consent:grant' });
    expect(consentReply.actionProposal).toBeNull();
    expect(consentReply.answer).toContain('Salesforce');
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
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

  it('retains quoted requirement facts during an advisory interruption', async () => {
    const ctx = await proposalTurn();
    const interruption = await followUpTurn(ctx, 'I want to register a company and need one visa next month.');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'I have noted those preferences.', nextQuestion: null, nextQuestionKey: null,
        planning: { ...modelProposal, turnCategory: 'qualification_requirement', nextMove: 'ask_more_help',
          proposedFacts: [
            { key: 'visa_count', maskedValue: '1', supportingQuote: 'one visa' },
            { key: 'timeline', maskedValue: 'next month', supportingQuote: 'next month' },
          ] } },
      guardReason: 'accepted',
    }) as unknown as V2CoordinatorResult);
    await runGPTFirstChatTurn(interruption);
    const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
    expect(document?.goalConfirmation?.status).toBe('pending');
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.verifiedFacts.visa_count?.maskedValue).toBe('1');
    expect(document?.verifiedFacts.timeline?.maskedValue).toBe('next month');
  });

  it('keeps a quoted timeline acknowledgement when a grounded excerpt is semantically unrelated', async () => {
    const ctx = await proposalTurn();
    const interruption = await followUpTurn(ctx, 'I want to start next month.');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: ['approved-evidence-a'], answer: 'Discover business setup packages.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted_knowledge_excerpt',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(interruption);
    expect(reply.answer).toContain('requested start timeline as next month');
    expect(reply.answer).toContain('Would you like to proceed with start a company?');
  });

  it('keeps a pending-goal preference acknowledgement when a grounded excerpt is semantically unrelated', async () => {
    const ctx = await proposalTurn();
    const interruption = await followUpTurn(ctx, 'I prefer to speak with an adviser.');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: ['approved-evidence-a'], answer: 'No opportunity is currently bound to the requested journey state.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted_knowledge_excerpt',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(interruption);
    expect(reply.answer).toContain('prefer to speak with an adviser');
    expect(reply.answer).toContain('Would you like to proceed with start a company?');
  });

  it('answers pre-confirmation status questions with truthful local state', async () => {
    const ctx = await proposalTurn();
    const interruption = await followUpTurn(ctx, 'What is my current status without CRM?');
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 1, toolTrace: [], approvedEvidence: [],
      response: { citationIds: ['approved-evidence-a'], answer: 'Company registration can be completed in two hours.', nextQuestion: null, nextQuestionKey: null },
      guardReason: 'accepted_knowledge_excerpt',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(interruption);
    expect(reply.answer).toContain('still exploratory');
    expect(reply.answer).toContain('no Lead or CRM action has been submitted');
    expect(reply.answer).not.toContain('registration can be completed');
  });

  it.each([
    ['I prefer to speak to an advisor.', 'adviser'],
    ['Please do not disclose any other customer information.', 'other customers'],
    ['Please do not disclose any other [ID_2].', 'other customers'],
    ['I consent to contact only for this company formation enquiry in this sandbox.', 'contact preference'],
    ['My test email address is [EMAIL_1].', 'confirm start a company'],
    ['My test phone number is [PHONE_1].', 'confirm start a company'],
    ['My budget is not fixed yet.', 'budget is not fixed'],
    ['Show only officially approved package information.', 'reliable package summary'],
  ])('uses a truthful persona recovery for pending non-action turn: %s', async (message, expected) => {
    const ctx = await proposalTurn();
    const interruption = await followUpTurn(ctx, message);
    ctx.coordinator.run.mockImplementationOnce(async () => ({
      modelRequestCount: 1, toolCallCount: 0, toolTrace: [], approvedEvidence: [],
      response: { citationIds: [], answer: 'I cannot verify that answer safely. I can continue with confirmed information.', nextQuestion: null, nextQuestionKey: null },
      guardReason: message.includes('package') ? 'policy_denied' : 'unsupported_claim',
    }) as unknown as V2CoordinatorResult);
    const reply = await runGPTFirstChatTurn(interruption);
    expect(reply.answer.toLocaleLowerCase('en-US')).toContain(expected);
    expect(reply.answer).not.toContain('temporarily unavailable');
    expect(reply.answer).not.toContain('cannot verify that answer safely');
    if (message.includes('[EMAIL_1]') || message.includes('[PHONE_1]')) {
      const document = await ctx.store.getUserIntentDocument(ctx.tenant.id, ctx.session.id);
      expect(document?.verifiedFacts.lead_contact_channel).toBeUndefined();
      expect((await ctx.store.getSession(ctx.session.id))?.conversationState?.slotValues.email).toBeUndefined();
    }
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
    const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('../fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
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

  it('does not let a model knowledge answer erase explicit formation initiation', async () => {
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
    expect(reply.answer).toContain('Would you like to proceed with start a company?');
    expect(reply.pendingPromptId).not.toBeNull();
    expect(document?.goalConfirmed).toBe(false);
    expect(document?.goalConfirmation?.status).toBe('pending');
    expect(await ctx.store.listActionsBySession(ctx.session.id, ctx.tenant.id)).toEqual([]);
  });
});

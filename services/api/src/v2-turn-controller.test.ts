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
import { runGPTFirstChatTurn } from './v2-turn-controller.js';
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
    expect(request.envelope.catalogVersionId).toBe(catalog.id);
    // The initial catalog must be stored before LangGraph issues its first tool.
    const saved = await store.getSession(session.id);
    expect(saved?.conversationState?.catalogVersionId).toBe(catalog.id);
    expect(saved?.stateVersion).toBe(request.envelope.sessionRevision);
    expect(verifyV2Scope(request.envelope.scopeRef, 'unit-test-service-key-123456')?.catalogVersionId).toBe(catalog.id);
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

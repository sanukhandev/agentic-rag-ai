import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpV2ConversationAgent, V2ConversationCoordinator, conversationEngineV2EnabledForTenant } from './v2-coordinator.js';
import type { TurnEnvelopeV2 } from './python-model/v2-contracts.js';

const envelope = (): TurnEnvelopeV2 => ({
  schemaVersion: 2, requestId: 'request-12345678', clientMessageId: 'message-12345678', scopeRef: 'scope-12345678', sessionRevision: 1, intentRevision: 1, catalogVersionId: 'catalog-12345678', personaVersionId: 'persona-12345678', customerMessageMasked: 'Hello', latestTurns: [],
  persona: { personaVersionId: 'persona-12345678', assistantName: 'Tenant Assistant', assistantRole: 'Advisor', permittedLanguages: ['en'], tone: ['warm'], speakingStyle: 'Clear', fallbackTemplateVersion: 'fallback-12345678' }, catalogDigest: 'a'.repeat(64), intentProjection: { primaryGoalKey: null, goalConfirmed: false, currentStageKey: null, pendingRequirementKey: null }, toolAllowlist: [], budgets: { maxModelRequests: 2, maxToolCalls: 0, maxToolRounds: 0, deadlineAt: new Date(Date.now() + 10_000).toISOString() },
});

const result = (answer: string) => ({ response: { schemaVersion: 2, personaVersionId: 'persona-12345678', language: 'en', answer, citationIds: [], nextQuestion: null, nextQuestionKey: null, reasonNoQuestion: 'greeting', decisionRef: 'decision-12345678' }, toolTrace: [], modelRequestCount: 1, toolCallCount: 0 });

const fallbackTemplates = { approved: true, personaVersionId: 'persona-12345678', templateVersion: 'fallback-12345678', language: 'en', templates: { invalid_model: 'I could not verify that response just now.', tool_unavailable: 'The approved information service is temporarily unavailable.', reconciliation: 'I need to verify the request status before I confirm the outcome.' } };

afterEach(() => vi.unstubAllGlobals());

describe('V2ConversationCoordinator', () => {
  it('is opt-in and tenant-scoped with rollback by default', () => {
    expect(conversationEngineV2EnabledForTenant('tenant-a', { CONVERSATION_ENGINE_V2_ENABLED: 'true', CONVERSATION_ENGINE_V2_TENANTS: 'tenant-a' })).toBe(true);
    expect(conversationEngineV2EnabledForTenant('tenant-b', { CONVERSATION_ENGINE_V2_ENABLED: 'true', CONVERSATION_ENGINE_V2_TENANTS: 'tenant-a' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { CONVERSATION_ENGINE_V2_ENABLED: 'false', CONVERSATION_ENGINE_V2_TENANTS: 'tenant-a' })).toBe(false);
  });

  it('returns only a guarded draft and preserves the agent trace', async () => {
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('Hello, how can I help?') });
    const output = await coordinator.run({ envelope: envelope() });
    expect(output.draft).toEqual({ answer: 'Hello, how can I help?', citationIds: [], proposedIntent: null });
    expect(output.guardReason).toBe('accepted');
    expect(output.toolCallCount).toBe(0);
  });

  it('replaces rejected model text with a pinned fallback, never raw output', async () => {
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('Your payment is complete.') });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('unsupported_claim');
    expect(output.response.answer).toBe('I could not verify that response just now.');
    expect(output.response.answer).not.toContain('payment is complete');
  });

  it('calls the private v2 agent route with the service key', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.headers).toMatchObject({ 'x-internal-service-key': 'private-key' });
      return { ok: true, json: async () => result('Hello, how can I help?') };
    }));
    const agent = new HttpV2ConversationAgent('http://model-gateway:8088', 'private-key');
    await expect(agent.turn(envelope())).resolves.toMatchObject({ modelRequestCount: 1, toolCallCount: 0 });
  });
});

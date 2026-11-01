import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertConversationEngineV2Configuration, HttpV2ConversationAgent, V2ConversationCoordinator, conversationEngineV2EnabledForTenant } from './v2-coordinator.js';
import type { TurnEnvelopeV2 } from './python-model/v2-contracts.js';

const envelope = (): TurnEnvelopeV2 => ({
  schemaVersion: 2, requestId: 'request-12345678', clientMessageId: 'message-12345678', scopeRef: 'scope-12345678', sessionRevision: 1, intentRevision: 1, catalogVersionId: 'catalog-12345678', personaVersionId: 'persona-12345678', customerMessageMasked: 'Hello', latestTurns: [],
  persona: { personaVersionId: 'persona-12345678', assistantName: 'Tenant Assistant', assistantRole: 'Advisor', permittedLanguages: ['en'], tone: ['warm'], speakingStyle: 'Clear', fallbackTemplateVersion: 'fallback-12345678' }, catalogDigest: 'a'.repeat(64), intentProjection: { primaryGoalKey: null, goalConfirmed: false, currentStageKey: null, pendingRequirementKey: null }, toolAllowlist: [], budgets: { maxModelRequests: 2, maxToolCalls: 0, maxToolRounds: 0, deadlineAt: new Date(Date.now() + 10_000).toISOString() },
});

const result = (answer: string, overrides: Record<string, unknown> = {}) => ({ response: { schemaVersion: 2, personaVersionId: 'persona-12345678', language: 'en', answer, citationIds: [], nextQuestion: null, nextQuestionKey: null, reasonNoQuestion: 'greeting', decisionRef: 'decision-12345678' }, toolTrace: [], approvedEvidence: [], modelRequestCount: 1, toolCallCount: 0, ...overrides });

const fallbackTemplates = { approved: true, personaVersionId: 'persona-12345678', templateVersion: 'fallback-12345678', language: 'en', templates: { invalid_model: 'I could not verify that response just now.', tool_unavailable: 'The approved information service is temporarily unavailable.', reconciliation: 'I need to verify the request status before I confirm the outcome.' } };

afterEach(() => vi.unstubAllGlobals());

describe('V2ConversationCoordinator', () => {
  it('defaults on only with a configured private gateway and tenant allowlist', () => {
    const configured = { PYTHON_MODEL_URL: 'http://model-gateway:8088', MODEL_GATEWAY_SERVICE_KEY: 'private-key', CONVERSATION_ENGINE_V2_TENANTS: 'tenant-a' };
    expect(conversationEngineV2EnabledForTenant('tenant-a', configured)).toBe(true);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, CONVERSATION_ENGINE_V2_ENABLED: 'true' })).toBe(true);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, CONVERSATION_ENGINE_V2_ENABLED: 'false' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-b', configured)).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, MODEL_GATEWAY_SERVICE_KEY: '' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, PYTHON_MODEL_URL: '' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, CONVERSATION_ENGINE_V2_TENANTS: '' })).toBe(false);
  });

  it('fails production startup clearly when v2 is enabled without a private gateway', () => {
    expect(() => assertConversationEngineV2Configuration('production', { CONVERSATION_ENGINE_V2_ENABLED: 'true' })).toThrow('PYTHON_MODEL_URL');
    expect(() => assertConversationEngineV2Configuration('production', {})).toThrow('PYTHON_MODEL_URL');
    expect(() => assertConversationEngineV2Configuration('production', { CONVERSATION_ENGINE_V2_ENABLED: 'false' })).not.toThrow();
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

  it('continues naturally when knowledge is absent without making unsupported claims', async () => {
    const request = envelope();
    request.customerMessageMasked = 'How much does a company licence cost?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: 'business_activity' };
    const coordinator = new V2ConversationCoordinator({
      turn: async () => result('The licence will cost AED 999.'),
    });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
    expect(output.response.answer).not.toContain('999');
    expect(output.response.answer).toContain('verified answer');
    expect(output.response.nextQuestionKey).toBe('business_activity');
    expect(output.response.nextQuestion).toBe('What business activity are you planning?');
  });

  it('keeps a pending requirement useful after a repeated knowledge interruption', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Could you explain the formation process?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: 'entity_type' };
    const coordinator = new V2ConversationCoordinator({
      turn: async () => result('The setup process is AED 999.'),
    });
    const first = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    const second = await coordinator.run({ envelope: request, lastQuestionKey: 'entity_type', questionPolicy: 'required' });
    expect(second.guardReason).toBe('safe_no_evidence_dialogue');
    expect(second.response.answer).not.toBe('I can help you work through that.');
    expect(second.response.nextQuestionKey).toBe('entity_type');
    expect(second.response.nextQuestion).toBe('What company structure are you considering?');
    expect(second.response.answer).toContain(second.response.nextQuestion);
    expect(first.response.answer).not.toBe(second.response.answer);
  });

  it('uses the durable active stage after qualification instead of restarting the journey', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What should happen next?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'account_creation', pendingRequirementKey: null };
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('I do not have a verified answer.') });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
    expect(output.response.nextQuestionKey).toBe('stage:account_creation');
    expect(output.response.nextQuestion).toContain('Account creation');
    expect(output.response.answer).not.toContain('Which part of your setup');
  });

  it('never converts an invented factual claim into a grounded response', async () => {
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('Your payment is complete.') });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates });
    expect(output.response.answer).not.toContain('payment is complete');
    expect(output.draft.citationIds).toHaveLength(0);
  });

  it('does not disguise failed tool execution as missing knowledge', async () => {
    const broken = result('I cannot finish right now.');
    broken.response.decisionRef = 'fallback-request-12345678';
    const coordinator = new V2ConversationCoordinator({ turn: async () => broken });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates });
    expect(output.guardReason).not.toBe('safe_no_evidence_dialogue');
  });

  it('calls the private v2 agent route with the service key', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.headers).toMatchObject({ 'x-internal-service-key': 'private-key' });
      return { ok: true, json: async () => result('Hello, how can I help?') };
    }));
    const agent = new HttpV2ConversationAgent('http://model-gateway:8088', 'private-key');
    await expect(agent.turn(envelope())).resolves.toMatchObject({ modelRequestCount: 1, toolCallCount: 0 });
  });

  it('accepts only evidence correlated to a successful search tool trace', async () => {
    const coordinator = new V2ConversationCoordinator({
      turn: async () => result('The approved package costs 42 credits.', {
        response: { ...result('The approved package costs 42 credits.').response, citationIds: ['search-source'] },
        approvedEvidence: [{ citationId: 'search-source', text: 'The approved package costs 42 credits.', sourceVersion: 'version-12345678', approved: true, revoked: false, sourceRef: 'source-12345678' }],
        toolTrace: [{ toolCallId: 'call-12345678', toolName: 'search_knowledge', status: 'ok', resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: ['search-source'] }],
      }),
    });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted');
    expect(output.response.citationIds).toEqual(['search-source']);
  });

  it('rejects tool evidence that is not correlated to a successful search trace', async () => {
    const coordinator = new V2ConversationCoordinator({
      turn: async () => result('The approved package costs 42 credits.', {
        response: { ...result('The approved package costs 42 credits.').response, citationIds: ['untrusted-source'] },
        approvedEvidence: [{ citationId: 'untrusted-source', text: 'The approved package costs 42 credits.', sourceVersion: 'version-12345678', approved: true, revoked: false, sourceRef: 'source-12345678' }],
      }),
    });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates, questionPolicy: 'optional' });
    expect(output.response.answer).toBe(fallbackTemplates.templates.invalid_model);
    expect(output.guardReason).toBe('invalid_citation');
  });
});

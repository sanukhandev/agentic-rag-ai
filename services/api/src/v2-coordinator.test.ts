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
  it('defaults on with a private gateway, supports an optional tenant allowlist', () => {
    const configured = { PYTHON_MODEL_URL: 'http://model-gateway:8088', MODEL_GATEWAY_SERVICE_KEY: 'private-key', CONVERSATION_ENGINE_V2_TENANTS: 'tenant-a' };
    expect(conversationEngineV2EnabledForTenant('tenant-a', configured)).toBe(true);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, CONVERSATION_ENGINE_V2_ENABLED: 'true' })).toBe(true);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, CONVERSATION_ENGINE_V2_ENABLED: 'false' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-b', configured)).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, MODEL_GATEWAY_SERVICE_KEY: '' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, PYTHON_MODEL_URL: '' })).toBe(false);
    expect(conversationEngineV2EnabledForTenant('tenant-a', { ...configured, CONVERSATION_ENGINE_V2_TENANTS: '' })).toBe(true);
  });

  it('fails production startup clearly when v2 is enabled without a private gateway', () => {
    expect(() => assertConversationEngineV2Configuration('production', { CONVERSATION_ENGINE_V2_ENABLED: 'true' })).toThrow('PYTHON_MODEL_URL');
    expect(() => assertConversationEngineV2Configuration('production', {})).toThrow('PYTHON_MODEL_URL');
    expect(() => assertConversationEngineV2Configuration('production', { CONVERSATION_ENGINE_V2_ENABLED: 'false' })).not.toThrow();
  });


  it('preserves Zara first-contact dialogue when the model omits question metadata', async () => {
    const request = envelope();
    request.persona.assistantName = 'Zara';
    const answer = "Hi, I'm Zara. How can I help you today?";
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.candidateGuardReason).toBe('accepted');
    expect(output.response.answer).toBe(answer);
    expect(output.response.nextQuestion).toBe('How can I help you today?');
    expect(output.response.nextQuestionKey).toBe('conversation_focus');
    expect(output.response.reasonNoQuestion).toBeNull();
    expect(output.repairApplied).toBe(true);
    expect(output.claimProvenance).toEqual([]);
  });

  it('retains the model greeting when an optional first-contact question is correctly keyed', async () => {
    const request = envelope();
    request.persona.assistantName = 'Zara';
    const answer = "Hello, I'm Zara, your AI assistant. What would you like help with?";
    const question = 'What would you like help with?';
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, nextQuestion: question, nextQuestionKey: 'conversation_focus', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.response.answer).toBe(answer);
    expect(output.repairApplied).toBe(false);
  });

  it('uses a pinned greeting instead of robotic fallback when a bare first-contact hello is rejected', async () => {
    const request = envelope();
    request.customerMessageMasked = 'hello';
    request.persona.assistantName = 'Zara';
    const candidate = "Hello! I'm Zara, your highly experienced company registration advisor. How can I help?";
    const output = await new V2ConversationCoordinator({ turn: async () => result(candidate) })
      .run({ envelope: request, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
    expect(output.candidateGuardReason).toBe('unsupported_claim');
    expect(output.response.answer).toBe("Hello! I'm Zara. How can I help you today?");
    expect(output.response.nextQuestion).toBe('How can I help you today?');
    expect(output.response.nextQuestionKey).toBe('conversation_focus');
    expect(output.response.citationIds).toEqual([]);
    expect(output.response.answer).not.toContain('highly experienced');
  });

  it('does not repeat a first-contact introduction after prior conversation turns', async () => {
    const request = envelope();
    request.persona.assistantName = 'Zara';
    request.latestTurns = [{ role: 'customer', content: 'hello' }, { role: 'assistant', content: 'Hello!' }];
    const output = await new V2ConversationCoordinator({ turn: async () => result("Hello, I'm Alex. How can I help you today?") })
      .run({ envelope: request, questionPolicy: 'optional' });
    expect(output.response.answer).not.toContain("I'm Zara.");
    expect(output.response.answer).not.toContain("I'm Alex.");
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
  });

  it('does not turn a greeting with an invented license price into accepted dialogue', async () => {
    const request = envelope();
    request.persona.assistantName = 'Zara';
    const answer = "Hi, I'm Zara. A license costs AED 999. How can I help you today?";
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'optional' });
    expect(output.candidateGuardReason).toBe('unsupported_claim');
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
    expect(output.response.answer).not.toContain('999');
  });

  it('rejects a different unverified persona introduction', async () => {
    const request = envelope();
    request.persona.assistantName = 'Zara';
    const answer = "Hi, I'm Alex. How can I help you today?";
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'optional' });
    expect(output.candidateGuardReason).toBe('unsupported_claim');
    expect(output.response.answer).not.toContain("I'm Alex");
  });

  it('returns only a guarded draft and preserves the agent trace', async () => {
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('Hello, how can I help?') });
    const output = await coordinator.run({ envelope: envelope() });
    expect(output.draft).toEqual({ answer: 'Hello, how can I help?', citationIds: [], proposedIntent: null });
    expect(output.guardReason).toBe('accepted_model_dialogue');
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

  it('never replaces repeated unanswered company-setup questions with generic refocusing', async () => {
    const request = envelope();
    request.customerMessageMasked = 'can you tell me about the process of starting a company in ajman freezone';
    request.latestTurns = [
      { role:'customer',content:request.customerMessageMasked },
      { role:'assistant',content:'I cannot verify the setup steps.' },
    ];
    const coordinator = new V2ConversationCoordinator({turn:async()=>result('I’m keeping your request in view. What would you like to focus on next?')});
    const output = await coordinator.run({envelope:request,questionPolicy:'optional'});
    expect(output.guardReason).toBe('missing_approved_knowledge');
    expect(output.response.answer).toContain('approved company-formation process guidance');
    expect(output.response.answer).not.toContain('focus on next');
    expect(output.response.citationIds).toEqual([]);
  });

  it('accepts a safe model-authored business follow-up when RAG is empty', async () => {
    const request = envelope();
    request.customerMessageMasked = 'I would like to discuss company formation.';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: 'business_activity' };
    const question = 'What business activity are you planning?';
    const answer = `I can help you work through that. ${question}`;
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, {
      response: { ...result(answer).response, nextQuestion: question, nextQuestionKey: 'business_activity', reasonNoQuestion: null },
    }) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.response.answer).toBe(answer);
    expect(output.response.citationIds).toEqual([]);
    expect(output.claimProvenance).toEqual([]);
  });

  it('accepts safe uncited dialogue when approved evidence is available but not needed', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Could you explain that before I answer?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: 'business_activity' };
    const question = 'What business activity are you planning?';
    const answer = `Thanks for clarifying. ${question}`;
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, nextQuestion: question, nextQuestionKey: 'business_activity', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({
      envelope: request,
      evidence: [{ citationId: 'approved-1', text: 'Approved setup information.', sourceVersion: 'version-12345678', approved: true, revoked: false, sourceRef: 'source-12345678' }],
      questionPolicy: 'required',
    });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.response.answer).toBe(answer);
  });

  it('accepts a natural GPT-authored next question when the required slot remains unanswered', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Before I reply, can you help me understand the request?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: 'entity_type' };
    const question = 'What company structure are you considering?';
    const answer = `Thanks for clarifying. ${question}`;
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, nextQuestion: question, nextQuestionKey: 'entity_type', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({ envelope: request, lastQuestionKey: 'entity_type', questionPolicy: 'required' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.candidateGuardReason).toBe('accepted');
    expect(output.response.answer).toBe(answer);
  });

  it('preserves original factual rejection cause even when a safe question is delivered', async () => {
    const request = envelope();
    request.customerMessageMasked = 'How much does the company licence cost?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: 'business_activity' };
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('The licence costs AED 999.') });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
    expect(output.candidateGuardReason).toBe('invalid_question');
    expect(output.response.answer).not.toContain('999');
  });

  it('does not treat a Python model fallback as a successful conversation when a goal is active', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: null };
    const broken = result('I cannot finish right now.');
    broken.response.decisionRef = 'fallback-request-12345678';
    const coordinator = new V2ConversationCoordinator({ turn: async () => broken });
    const output = await coordinator.run({ envelope: request, fallbackTemplates });
    expect(output.guardReason).toBe('model_or_tool_unavailable');
    expect(output.response.answer).toBe(fallbackTemplates.templates.tool_unavailable);
  });

  it('does not disguise failed tool calls as missing knowledge', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: null };
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('Hello, how can I help?', {
      toolTrace: [{ toolCallId: 'call-12345678', toolName: 'get_journey_state', status: 'temporarily_unavailable', resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: [] }],
    }) });
    const output = await coordinator.run({ envelope: request, fallbackTemplates });
    expect(output.guardReason).toBe('model_or_tool_unavailable');
  });

  it('preserves independently grounded knowledge when an optional package tool fails', async () => {
    const answer = 'The approved package costs 42 credits.';
    const response = result(answer, {
      response: { ...result(answer).response, citationIds: ['valid-public-12345678'] },
      approvedEvidence: [{ citationId: 'valid-public-12345678', text: answer,
        sourceVersion: 'version-12345678', sourceRef: 'source-12345678',
        approved: true, revoked: false }],
      toolTrace: [
        { toolCallId: 'search-12345678', toolName: 'search_knowledge', status: 'ok',
          resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: ['valid-public-12345678'] },
        { toolCallId: 'optional-12345678', toolName: 'get_available_packages',
          status: 'temporarily_unavailable', resultDigest: 'b'.repeat(64),
          elapsedMs: 2, evidenceRefs: [] },
      ],
    });
    const output = await new V2ConversationCoordinator({ turn: async () => response })
      .run({ envelope: envelope(), fallbackTemplates });
    expect(output.guardReason).toBe('accepted');
    expect(output.response.answer).toBe(answer);
    expect(output.response.citationIds).toEqual(['valid-public-12345678']);
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

  it('fails closed rather than bypassing an enforced reviewer for oversized factual answers', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What are the company formation steps?';
    request.budgets = { ...request.budgets, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Choose your business activity and submit the required documents.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    request.approvedKnowledge = [snippet];
    const answer = Array(9).fill(snippet.text).join(' ');
    const review = vi.fn(async () => [{ claimId: '1', citationId: snippet.citationId, verdict: 'supported' as const }]);
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, {
      response: { ...result(answer).response, citationIds: [snippet.citationId] },
    }) }, { verify: review });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(output.candidateGuardReason).toBe('accepted');
    expect(output.guardReason).toBe('grounding_review_rejected');
    expect(output.groundingReviewStatus).toBe('unreviewable');
    expect(output.response.citationIds).toEqual([]);
    expect(review).not.toHaveBeenCalled();
  });

  it('requires independent grounding even when a legacy lexical heuristic would accept the answer', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What are the approved formation steps?';
    request.budgets = { ...request.budgets, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Choose your business activity and submit the required documents.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    request.approvedKnowledge = [snippet];
    const turn = vi.fn(async () => result(snippet.text, {
      response: { ...result(snippet.text).response, citationIds: [snippet.citationId] },
    }));
    const coordinator = new V2ConversationCoordinator({ turn }, {
      verify: async () => [{ claimId: '1', citationId: null, verdict: 'insufficient' }],
    });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(output.candidateGuardReason).toBe('accepted');
    expect(output.guardReason).toBe('grounding_review_rejected');
    expect(output.groundingReviewStatus).toBe('rejected');
    expect(output.response.answer).not.toBe(snippet.text);
    expect(output.response.citationIds).toEqual([]);
    expect(output.modelRequestCount).toBe(2);
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it('accepts a legitimate paraphrase with independent source-bound entailment, counting the model request', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What company registration documents are needed?';
    request.budgets = { ...request.budgets, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Submit your passport and choose software consulting.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    const answer = 'Provide travel identification and select technology advisory.';
    request.approvedKnowledge = [snippet];
    const turn = vi.fn(async () => result(answer, {
      response: { ...result(answer).response, citationIds: [snippet.citationId] },
    }));
    const review = vi.fn(async () => [{ claimId: '1', citationId: snippet.citationId, verdict: 'supported' as const }]);
    const coordinator = new V2ConversationCoordinator({ turn }, { verify: review });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(output.guardReason).toBe('accepted_entailment');
    expect(output.candidateGuardReason).toBe('unsupported_claim');
    expect(output.groundingReviewStatus).toBe('accepted');
    expect(output.modelRequestCount).toBe(2);
    expect(output.claimProvenance).toHaveLength(1);
    expect(output.claimProvenance[0]?.sourceRefs).toEqual([snippet.sourceRef]);
    expect(output.response.answer).toBe(answer);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an independent reviewer cannot substantiate a paraphrase', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What company registration documents are needed?';
    request.budgets = { ...request.budgets, maxModelRequests: 4, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Submit your passport and choose software consulting.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    request.approvedKnowledge = [snippet];
    const answer = 'Provide travel identification and select technology advisory.';
    const turn = vi.fn(async () => result(answer, {
      response: { ...result(answer).response, citationIds: [snippet.citationId] },
    }));
    const coordinator = new V2ConversationCoordinator({ turn }, {
      verify: async () => [{ claimId: '1', citationId: null, verdict: 'insufficient' }],
    });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(output.guardReason).toBe('unsupported_claim');
    expect(output.groundingReviewStatus).toBe('rejected');
    expect(output.modelRequestCount).toBe(2);
    expect(output.response.citationIds).toEqual([]);
    expect(output.response.answer).not.toContain('technology advisory');
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it('answers a factual knowledge detour with citations even if a goal is already active', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What are the steps for forming a company?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: null };
    request.budgets = { ...request.budgets, maxModelRequests: 4,
      deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Choose your business activity and submit the required documents.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    request.approvedKnowledge = [snippet];
    let calls = 0;
    const coordinator = new V2ConversationCoordinator({ turn: async () => {
      calls += 1;
      return result(snippet.text, { response: { ...result(snippet.text).response,
        citationIds: calls === 1 ? [] : [snippet.citationId] } });
    } });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(calls).toBe(2);
    expect(output.guardReason).toBe('accepted_knowledge_repair');
    expect(output.knowledgeRepairStatus).toBe('accepted');
    expect(output.response.citationIds).toEqual([snippet.citationId]);
  });

  it('can replace a rejected invented completed-action claim without authorizing it', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Tell me the steps for forming a company';
    request.budgets = { ...request.budgets, maxModelRequests: 4,
      deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Choose your business activity and submit the required documents.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    request.approvedKnowledge = [snippet];
    let calls = 0;
    const coordinator = new V2ConversationCoordinator({ turn: async () => {
      calls += 1;
      return calls === 1
        ? result('Your company was registered and payment completed.', { response: {
          ...result('Your company was registered and payment completed.').response,
          citationIds: [snippet.citationId] } })
        : result(snippet.text, { response: { ...result(snippet.text).response,
          citationIds: [snippet.citationId] } });
    } });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(calls).toBe(2);
    expect(output.guardReason).toBe('accepted_knowledge_repair');
    expect(output.response.answer).toBe(snippet.text);
    expect(output.response.answer).not.toContain('registered');
    expect(output.response.planning).toBeNull();
  });

  it('reports when a grounded repair was skipped because the turn deadline was too close', async () => {
    const request = envelope();
    request.customerMessageMasked = 'What are the steps for forming a company?';
    request.budgets = { ...request.budgets, maxModelRequests: 4,
      deadlineAt: new Date(Date.now() + 1_500).toISOString() };
    const snippet = { citationId: 'chunk-12345678',
      text: 'Choose your business activity and submit the required documents.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678' };
    request.approvedKnowledge = [snippet];
    let calls = 0;
    const coordinator = new V2ConversationCoordinator({ turn: async () => {
      calls += 1;
      return result('The setup costs AED 999.', { response: {
        ...result('The setup costs AED 999.').response, citationIds: [snippet.citationId] } });
    } });
    const output = await coordinator.run({ envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }], fallbackTemplates });
    expect(calls).toBe(1);
    expect(output.guardReason).toBe('unsupported_claim');
    expect(output.knowledgeRepairStatus).toBe('skipped_budget');
    expect(output.response.answer).toBe(fallbackTemplates.templates.invalid_model);
  });

  it('repairs a cited, rejected factual question even when the wording lacks process-regex keywords', async () => {
    const request = envelope();
    // This wording was already eligible for Node RAG prefetch but not the
    // narrower asksForProcess regular expression in the coordinator.
    request.customerMessageMasked = 'How does incorporation work at Ajman Free Zone?';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: null };
    request.budgets = { ...request.budgets, maxModelRequests: 4,
      deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const approved = [
      { citationId: 'formation-chunk-12345678',
        sourceRef: 'formation-source-12345678', sourceVersion: 'version-12345678',
        text: 'Choose a business activity and submit the required application documents.' },
      { citationId: 'faq-chunk-12345678',
        sourceRef: 'faq-source-12345678', sourceVersion: 'version-22345678',
        text: 'The free zone offers company formation information.' },
      { citationId: 'licenses-chunk-12345678',
        sourceRef: 'licenses-source-12345678', sourceVersion: 'version-32345678',
        text: 'Licence requirements depend on the selected business activity.' },
    ];
    request.approvedKnowledge = approved;
    const calls: TurnEnvelopeV2[] = [];
    const agent = { turn: async (turn: TurnEnvelopeV2) => {
      calls.push(turn);
      if (calls.length === 1) {
        return result('Formation is guaranteed in one day for AED 999.', {
          response: { ...result('Formation is guaranteed in one day for AED 999.').response,
            citationIds: approved.map(item => item.citationId) },
        });
      }
      expect(turn.knowledgeRepair).toEqual({ reason: 'unsupported_claim', strategy: 'source_close' });
      expect(turn.toolAllowlist).toEqual([]);
      return result(approved[0]!.text, {
        response: { ...result(approved[0]!.text).response, citationIds: [approved[0]!.citationId] },
      });
    } };
    const output = await new V2ConversationCoordinator(agent).run({
      envelope: request, evidence: approved.map(item => ({ ...item, approved: true, revoked: false })),
      fallbackTemplates, questionPolicy: 'optional',
    });
    expect(calls).toHaveLength(2);
    expect(output.guardReason).toBe('accepted_knowledge_repair');
    expect(output.knowledgeRepairStatus).toBe('accepted');
    expect(output.candidateGuardReason).toBe('unsupported_claim');
    expect(output.response.answer).toBe(approved[0]!.text);
    expect(output.response.citationIds).toEqual([approved[0]!.citationId]);
    expect(output.response.planning).toBeNull();
    expect(output.modelRequestCount).toBe(2);
    expect(output.toolCallCount).toBe(0);
  });

  it('repairs a rejected process claim once using only the exact trusted prefetch', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Can you tell me about the steps for forming a company?';
    request.budgets = { ...request.budgets, maxModelRequests: 4, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const snippet = {
      citationId: 'chunk-12345678', text: 'Choose your business activity and submit the required documents.',
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678',
    };
    request.approvedKnowledge = [snippet];
    const calls: TurnEnvelopeV2[] = [];
    const agent = { turn: async (turn: TurnEnvelopeV2) => {
      calls.push(turn);
      if (calls.length === 1) return result('The setup costs AED 900.', {
        response: { ...result('The setup costs AED 900.').response, citationIds: [snippet.citationId] },
      });
      expect(turn.knowledgeRepair).toEqual({ reason: 'unsupported_claim', strategy: 'source_close' });
      expect(turn.toolAllowlist).toEqual([]);
      expect(turn.budgets.maxModelRequests).toBe(1);
      expect(turn.budgets.maxToolCalls).toBe(0);
      expect(turn.budgets.maxToolRounds).toBe(0);
      expect(turn.approvedKnowledge).toEqual([snippet]);
      return result(snippet.text, {
        response: { ...result(snippet.text).response, citationIds: [snippet.citationId], planning: {
          turnCategory: 'business_goal', primaryGoalKey: 'anc.company_formation',
          candidateGoalKeys: [], matchedSignalIds: [], supportingTopicKeys: [],
          runnerUpScore: null, nextMove: 'confirm_goal', nextQuestion: null,
          proposedToolKey: null, confidenceBand: 'high', proposedFacts: [],
        } },
      });
    } };
    const output = await new V2ConversationCoordinator(agent).run({
      envelope: request,
      evidence: [{ ...snippet, approved: true, revoked: false }],
      fallbackTemplates, questionPolicy: 'optional',
    });
    expect(calls).toHaveLength(2);
    expect(output.guardReason).toBe('accepted_knowledge_repair');
    expect(output.candidateGuardReason).toBe('unsupported_claim');
    expect(output.response.answer).toBe(snippet.text);
    expect(output.response.citationIds).toEqual([snippet.citationId]);
    expect(output.response.planning).toBeNull();
    expect(output.claimProvenance).toHaveLength(1);
    expect(output.modelRequestCount).toBe(2);
    expect(output.toolCallCount).toBe(0);
  });

  it('does not repair from model-invented evidence, missing prefetch, or unsupported repair text', async () => {
    const text = 'Choose your business activity and submit the required documents.';
    const snippet = {
      citationId: 'chunk-12345678', text,
      sourceRef: 'source-12345678', sourceVersion: 'version-12345678',
      approved: true, revoked: false,
    };
    const makeEnvelope = () => {
      const request = envelope();
      request.customerMessageMasked = 'Can you tell me about the steps for forming a company?';
      request.budgets = { ...request.budgets, maxModelRequests: 4, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
      return request;
    };
    const unsupported = result('The setup costs AED 900.', {
      response: { ...result('The setup costs AED 900.').response, citationIds: [snippet.citationId] },
    });
    const calls: TurnEnvelopeV2[] = [];
    const agent = { turn: async (turn: TurnEnvelopeV2) => {
      calls.push(turn);
      return calls.length === 1 ? unsupported : result('The setup costs AED 999.', {
        response: { ...result('The setup costs AED 999.').response, citationIds: [snippet.citationId] },
      });
    } };
    const noPrefetch = await new V2ConversationCoordinator(agent).run({
      envelope: makeEnvelope(), evidence: [snippet], fallbackTemplates,
    });
    expect(noPrefetch.guardReason).toBe('unsupported_claim');
    expect(calls).toHaveLength(1);
    const request = makeEnvelope();
    request.approvedKnowledge = [{
      citationId: snippet.citationId, text: snippet.text,
      sourceRef: snippet.sourceRef, sourceVersion: snippet.sourceVersion,
    }];
    const rejectedRepair = await new V2ConversationCoordinator(agent).run({
      envelope: request, evidence: [snippet], fallbackTemplates,
    });
    expect(rejectedRepair.guardReason).toBe('unsupported_claim');
    expect(rejectedRepair.response.answer).toBe(fallbackTemplates.templates.invalid_model);
    expect(rejectedRepair.response.citationIds).toEqual([]);
    expect(rejectedRepair.modelRequestCount).toBe(2);
    expect(rejectedRepair.knowledgeRepairStatus).toBe('attempted_rejected');
    expect(rejectedRepair.initialClaimFailureReason).toBe('numeric_value_not_in_cited_source');
    expect(rejectedRepair.initialFailedClauseOrdinal).toBe(1);
    expect(rejectedRepair.repairCitationCount).toBe(1);
    expect(rejectedRepair.repairFailureReason).toBe('repair_guard_unsupported_claim');
    expect(rejectedRepair.repairClaimFailureReason).toBe('numeric_value_not_in_cited_source');
    expect(rejectedRepair.repairFailedClauseOrdinal).toBe(1);
    expect(calls).toHaveLength(3);
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
    expect(output.claimProvenance).toHaveLength(1);
    expect(output.claimProvenance[0]).toMatchObject({ citationIds: ['search-source'], sourceVersions: ['version-12345678'], sourceRefs: ['source-12345678'] });
  });

  it('repairs a rejected answer from evidence returned by a successful search tool', async () => {
    const request = envelope();
    request.customerMessageMasked = 'How does the company formation process work?';
    request.budgets = { ...request.budgets, maxModelRequests: 4, deadlineAt: new Date(Date.now() + 60_000).toISOString() };
    const source = { citationId: 'tool-source-12345678', sourceRef: 'source-12345678', sourceVersion: 'version-12345678', text: 'Choose your business activity and submit the required documents.' };
    const calls: TurnEnvelopeV2[] = [];
    const agent = { turn: async (turn: TurnEnvelopeV2) => {
      calls.push(turn);
      if (calls.length === 1) return result('The setup costs AED 999.', {
        response: { ...result('The setup costs AED 999.').response, citationIds: [source.citationId] },
        approvedEvidence: [{ ...source, approved: true, revoked: false }],
        toolTrace: [{ toolCallId: 'search-call-12345678', toolName: 'search_knowledge', status: 'ok', resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: [source.citationId] }],
      });
      expect(turn.toolAllowlist).toEqual([]);
      expect(turn.approvedKnowledge).toEqual([source]);
      return result(source.text, { response: { ...result(source.text).response, citationIds: [source.citationId] } });
    } };
    const output = await new V2ConversationCoordinator(agent).run({ envelope: request, fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_knowledge_repair');
    expect(output.response.answer).toBe(source.text);
    expect(output.response.citationIds).toEqual([source.citationId]);
    expect(output.knowledgeRepairStatus).toBe('accepted');
    expect(calls).toHaveLength(2);
  });

  it('accepts evidence correlated to a successful authoritative state tool trace', async () => {
    const coordinator = new V2ConversationCoordinator({
      turn: async () => result('The Account request is awaiting verified provider evidence.', {
        response: { ...result('The Account request is awaiting verified provider evidence.').response, citationIds: ['journey-source'] },
        approvedEvidence: [{ citationId: 'journey-source', text: 'The Account request is awaiting verified provider evidence.', sourceVersion: 'catalog-12345678', approved: true, revoked: false, sourceRef: 'tool-get_journey_state' }],
        toolTrace: [{ toolCallId: 'call-journey-1234', toolName: 'get_journey_state', status: 'ok', resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: ['journey-source'] }],
      }),
    });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted');
    expect(output.response.citationIds).toEqual(['journey-source']);
  });

  it('keeps safe uncited dialogue eligible when another tool returned evidence', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: 'business_activity' };
    const question = 'What business activity are you planning?';
    const answer = `Thanks for clarifying. ${question}`;
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, {
      response: { ...result(answer).response, nextQuestion: question, nextQuestionKey: 'business_activity', reasonNoQuestion: null },
      approvedEvidence: [{ citationId: 'journey-source', text: 'The current journey remains in qualification.', sourceVersion: 'catalog-12345678', approved: true, revoked: false, sourceRef: 'tool-get_journey_state' }],
      toolTrace: [{ toolCallId: 'call-journey-1234', toolName: 'get_journey_state', status: 'ok', resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: ['journey-source'] }],
    }) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.response.answer).toBe(answer);
  });

  it('preserves a verified customer fact when the model cites an unavailable source', async () => {
    const request = envelope();
    request.customerMessageMasked = 'My business is technology consulting.';
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_generation', pendingRequirementKey: null,
      confirmedCustomerFacts: { business_activity: 'technology consulting' } };
    const candidate = result('I have noted that. What would you like to discuss next?', {
      response: { ...result('I have noted that. What would you like to discuss next?').response, citationIds: ['missing-source-12345678'] },
    });
    const output = await new V2ConversationCoordinator({ turn: async () => candidate })
      .run({ envelope: request, fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('safe_no_evidence_dialogue');
    expect(output.candidateGuardReason).toBe('invalid_citation');
    expect(output.response.answer).toContain('technology consulting');
    expect(output.response.answer).not.toContain('cannot verify');
  });

  it('accepts an exact, cited customer-stated fact only from Node verified context', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: null,
      confirmedCustomerFacts: { entity_type: 'LLC' } };
    const answer = 'The customer stated their company structure is LLC.';
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, {
      response: { ...result(answer).response, citationIds: ['customer-fact-entity_type'] },
    }) });
    const trusted = [{ factId: 'customer-fact-entity_type', text: answer, sourceVersion: 'catalog-12345678', verified: true }];
    const accepted = await coordinator.run({ envelope: request, verifiedFacts: trusted, questionPolicy: 'optional' });
    expect(accepted.guardReason).toBe('accepted');
    expect(accepted.response.answer).toBe(answer);
    const denied = await coordinator.run({ envelope: request, questionPolicy: 'optional', fallbackTemplates });
    expect(denied.guardReason).toBe('invalid_citation');
    expect(denied.response.answer).not.toBe(answer);
  });

  it('adds only matching Node-verified fact citations when the model omitted them', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: 'email',
      confirmedCustomerFacts: { entity_type: 'LLC' } };
    const question = 'What email address should we use for this request?';
    const answer = `Thanks for checking. I have your company structure noted as LLC. ${question}`;
    const fact = { factId: 'customer-fact-entity_type', text: 'The customer stated their company structure is LLC.', sourceVersion: 'catalog-12345678', verified: true };
    const output = await new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, nextQuestion: question, nextQuestionKey: 'email', reasonNoQuestion: null,
    } }) }).run({ envelope: request, verifiedFacts: [fact], questionPolicy: 'required' });
    expect(output.guardReason).toBe('accepted');
    expect(output.response.citationIds).toEqual(['customer-fact-entity_type']);
  });

  it('does not treat the purposeful follow-up question as an unsupported factual claim', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true,
      currentStageKey: 'lead_qualification', pendingRequirementKey: 'email',
      confirmedCustomerFacts: { entity_type: 'LLC' } };
    const fact = 'The customer stated their company structure is LLC.';
    const question = 'What email address should we use for this request?';
    const answer = `${fact} ${question}`;
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, citationIds: ['customer-fact-entity_type'], nextQuestion: question, nextQuestionKey: 'email', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({ envelope: request, verifiedFacts: [{ factId: 'customer-fact-entity_type', text: fact, sourceVersion: 'catalog-12345678', verified: true }], questionPolicy: 'required' });
    expect(output.guardReason).toBe('accepted');
    expect(output.response.answer).toBe(answer);
  });

  it('repairs one duplicated trailing question without changing its meaning', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'lead_qualification', pendingRequirementKey: 'email' };
    const question = 'What email address should we use for this request?';
    const answer = `Thanks for clarifying. ${question}\n\n${question}`;
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, nextQuestion: question, nextQuestionKey: 'email', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'required' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.repairApplied).toBe(true);
    expect(output.response.answer).toBe(`Thanks for clarifying. ${question}`);
  });

  it('repairs one missing trailing question when the remaining dialogue is safe', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'account_creation', pendingRequirementKey: null };
    const question = 'What would you like to review next about your company-formation request?';
    const answer = 'I can’t verify from the approved information how that required business document is handled after package confirmation. I can still help with other verified parts of your company-formation request.';
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, nextQuestion: question, nextQuestionKey: 'stage:account_creation', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({ envelope: request, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_model_dialogue');
    expect(output.repairApplied).toBe(true);
    expect(output.response.answer).toBe(`${answer} ${question}`);
  });

  it('repairs a stage placeholder only from the authoritative active stage', async () => {
    const request = envelope();
    request.intentProjection = { primaryGoalKey: 'anc.company_formation', goalConfirmed: true, currentStageKey: 'account_creation', pendingRequirementKey: null };
    const evidence = [{ citationId: 'journey-source', text: 'The verified action shows lead registration is awaiting verified provider evidence. The authoritative journey is currently at account_creation.', sourceVersion: 'catalog-12345678', approved: true, revoked: false, sourceRef: 'tool-get_journey_state' }];
    const answer = 'The verified action shows lead registration is awaiting verified provider evidence, and the journey is currently at account_creation.';
    const question = 'What would you like to review about the [ID_1] stage?';
    const coordinator = new V2ConversationCoordinator({ turn: async () => result(answer, { response: {
      ...result(answer).response, citationIds: ['journey-source'], nextQuestion: question, nextQuestionKey: 'stage:account_creation', reasonNoQuestion: null,
    } }) });
    const output = await coordinator.run({ envelope: request, evidence, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted');
    expect(output.repairApplied).toBe(true);
    expect(output.response.answer).toContain('Account creation');
    expect(output.response.answer).not.toContain('[ID_');
  });

  it('ignores evidence emitted by mutation tools even when execution status is ok', async () => {
    const coordinator = new V2ConversationCoordinator({ turn: async () => result('The Account was created.', {
      response: { ...result('The Account was created.').response, citationIds: ['mutation-evidence'] },
      approvedEvidence: [{ citationId: 'mutation-evidence', text: 'provider_record_verified: The Account was created.', sourceVersion: 'provider-v1', approved: true, revoked: false, sourceRef: 'provider-result' }],
      toolTrace: [{ toolCallId: 'mutation-call-12345678', toolName: 'create_account', status: 'ok', resultDigest: 'a'.repeat(64), elapsedMs: 2, evidenceRefs: ['mutation-evidence'] }],
    }) });
    const output = await coordinator.run({ envelope: envelope(), fallbackTemplates });
    expect(output.guardReason).toBe('invalid_citation');
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

  it('returns one authorized source excerpt when paraphrase repair fails', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Tell me about company formation';
    request.approvedKnowledge = [{ citationId: 'formation-chunk-12345678', sourceRef: 'formation-source-12345678', sourceVersion: 'version-12345678', text: 'Company formation requires an application form and proof of residence.' }];
    const output = await new V2ConversationCoordinator({ turn: async () => result('Formation is guaranteed in one day.', {
      response: { ...result('Formation is guaranteed in one day.').response, citationIds: ['formation-chunk-12345678'] },
    }) }).run({ envelope: request, evidence: [{ ...request.approvedKnowledge[0]!, approved: true, revoked: false }], fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_knowledge_excerpt');
    expect(output.response.answer).toBe('Company formation requires an application form and proof of residence.');
    expect(output.response.citationIds).toEqual(['formation-chunk-12345678']);
  });

  it('recovers a source-close process statement after a polarity rejection', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Tell me about company formation';
    const processText = 'Company registration and licence issuance can be completed in as little as 2 hours, provided all required documents are in order.';
    request.approvedKnowledge = [{ citationId: 'process-chunk-12345678', sourceRef: 'formation-source-12345678', sourceVersion: 'version-12345678', text: processText }];
    const output = await new V2ConversationCoordinator({ turn: async () => result('Company registration is complete.', {
      response: { ...result('Company registration is complete.').response, citationIds: ['process-chunk-12345678'] },
    }) }).run({ envelope: request, evidence: [{ ...request.approvedKnowledge[0]!, approved: true, revoked: false }], fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_knowledge_excerpt');
    expect(output.response.answer).toBe(processText);
  });

  it('does not return a source question as the answer during excerpt recovery', async () => {
    const request = envelope();
    request.customerMessageMasked = 'Tell me about company formation';
    request.approvedKnowledge = [{ citationId: 'formation-chunk-12345678', sourceRef: 'formation-source-12345678', sourceVersion: 'version-12345678', text: 'What documents are required for company registration? Company formation requires an application form and proof of residence.' }];
    const output = await new V2ConversationCoordinator({ turn: async () => result('Formation is guaranteed in one day.', {
      response: { ...result('Formation is guaranteed in one day.').response, citationIds: ['formation-chunk-12345678'] },
    }) }).run({ envelope: request, evidence: [{ ...request.approvedKnowledge[0]!, approved: true, revoked: false }], fallbackTemplates, questionPolicy: 'optional' });
    expect(output.guardReason).toBe('accepted_knowledge_excerpt');
    expect(output.response.answer).toBe('Company formation requires an application form and proof of residence.');
    expect(output.response.answer).not.toMatch(/\?$/u);
  });
});

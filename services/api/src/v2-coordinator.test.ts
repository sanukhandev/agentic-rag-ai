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
});

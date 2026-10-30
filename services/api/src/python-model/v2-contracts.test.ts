import { describe, expect, it } from 'vitest';
import { personaComposedResponseSchema, toolRequestSchema, turnEnvelopeSchema, validateToolRequest } from './v2-contracts.js';

const envelope = {
  schemaVersion: 2,
  requestId: 'request-12345678',
  clientMessageId: 'client-12345678',
  scopeRef: 'scope-12345678',
  sessionRevision: 4,
  intentRevision: 2,
  catalogVersionId: 'catalog-v2-12345678',
  personaVersionId: 'persona-v2-12345678',
  customerMessageMasked: 'I need help with a company.',
  latestTurns: [],
  persona: {
    personaVersionId: 'persona-v2-12345678',
    assistantName: 'Zara',
    assistantRole: 'AI assistant',
    permittedLanguages: ['en'],
    tone: ['clear'],
    speakingStyle: 'Concise and helpful.',
    fallbackTemplateVersion: 'fallback-v2-12345678',
  },
  catalogDigest: 'a'.repeat(64),
  intentProjection: { primaryGoalKey: null, goalConfirmed: false, currentStageKey: null, pendingRequirementKey: null },
  toolAllowlist: ['search_knowledge'],
  budgets: { maxModelRequests: 3, maxToolCalls: 4, maxToolRounds: 2, deadlineAt: '2026-10-30T10:00:00Z' },
};

describe('conversation engine v2 contracts', () => {
  it('accepts a pinned envelope and rejects unknown fields', () => {
    expect(turnEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(turnEnvelopeSchema.safeParse({ ...envelope, tenantId: 'must-not-cross-boundary' }).success).toBe(false);
  });

  it('rejects persona pin and model-provided identity scope mismatches', () => {
    expect(turnEnvelopeSchema.safeParse({ ...envelope, personaVersionId: 'persona-other-12345678' }).success).toBe(false);
    expect(toolRequestSchema.safeParse({
      schemaVersion: 2, toolCallId: 'call-12345678', toolName: 'search_knowledge',
      arguments: { tenantId: 'customer-controlled' }, scopeRef: envelope.scopeRef,
      expectedStateRevision: 4, deadlineAt: envelope.budgets.deadlineAt,
    }).success).toBe(false);
  });

  it('accepts only the trusted scope, allowlist and current revision', () => {
    const request = { schemaVersion: 2, toolCallId: 'call-12345678', toolName: 'search_knowledge', arguments: {}, scopeRef: envelope.scopeRef, expectedStateRevision: 4, deadlineAt: envelope.budgets.deadlineAt };
    expect(validateToolRequest(request, envelope)).toMatchObject({ toolName: 'search_knowledge' });
    expect(() => validateToolRequest({ ...request, scopeRef: 'scope-other-12345678' }, envelope)).toThrow('TOOL_SCOPE_MISMATCH');
    expect(() => validateToolRequest({ ...request, expectedStateRevision: 3 }, envelope)).toThrow('STALE_CONTEXT');
    expect(() => validateToolRequest({ ...request, toolName: 'create_account' }, envelope)).toThrow('TOOL_NOT_ALLOWED');
  });

  it('rejects an unapproved customer-visible response reference', () => {
    expect(personaComposedResponseSchema.safeParse({
      schemaVersion: 2, personaVersionId: envelope.personaVersionId, language: 'en', answer: 'Ready.',
      citationIds: [], nextQuestion: null, nextQuestionKey: null, reasonNoQuestion: 'farewell', decisionRef: 'decision-12345678',
      internalTrace: 'not-public',
    }).success).toBe(false);
  });
});

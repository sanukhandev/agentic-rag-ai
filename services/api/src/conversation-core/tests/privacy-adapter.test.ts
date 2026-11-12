import { describe, expect, it } from 'vitest';
import { SessionScopedPrivacyAdapter } from '../adapters/privacy-adapter.js';
import type { ModelTurnEnvelope, TrustedActor } from '../contracts.js';

const actor: TrustedActor = { tenantId: 'tenant-1', sessionId: 'session-1', role: 'customer', principalId: 'verified-hash' };
const envelope: ModelTurnEnvelope = {
  requestId: 'turn-1', tenantId: 'tenant-1', sessionId: 'session-1', customerMessage: 'Email: customer@example.test',
  persona: { versionId: 'persona-1', instructions: 'Be helpful' }, catalogVersionId: 'catalog-1',
  publishedGoalKeys: [], conversationSummary: 'Earlier request.', latestTurns: [], verifiedFacts: [],
  pendingActionStatus: [], allowedReadTools: [], readToolScopeRef: 'signed-scope',
  limits: { maxModelCalls: 4, maxToolCalls: 8, maxToolRounds: 3, deadlineMs: 60_000 },
};

describe('P2 privacy boundary', () => {
  it('masks customer input and keeps the trusted scope unchanged', async () => {
    const adapter = new SessionScopedPrivacyAdapter({
      async maskAndPersist(_actor, input) { return input.replace('customer@example.test', '[EMAIL_1]'); },
      async assertMaskedAndKnown(_actor, input) { if (input.includes('@')) throw new Error('Raw PII'); },
    });
    const result = await adapter.prepareForModel(actor, envelope);
    expect(result.customerMessage).toBe('Email: [EMAIL_1]');
    expect(result.tenantId).toBe(actor.tenantId);
    expect(result.readToolScopeRef).toBe(envelope.readToolScopeRef);
  });

  it('refuses raw PII in model output and persisted facts', async () => {
    const adapter = new SessionScopedPrivacyAdapter({
      async maskAndPersist(_actor, input) { return input; },
      async assertMaskedAndKnown(_actor, input) { if (input.includes('@')) throw new Error('Raw PII'); },
    });
    await expect(adapter.validateMaskedResponse(actor, {
      message: 'Email customer@example.test', evidenceRefs: [], goalCandidateKeys: [], proposedFacts: [], actionProposal: null,
    })).rejects.toThrow('Raw PII');
    await expect(adapter.assertSafeMaskedText(actor, 'customer@example.test', 'fact')).rejects.toThrow('Raw PII');
  });
});

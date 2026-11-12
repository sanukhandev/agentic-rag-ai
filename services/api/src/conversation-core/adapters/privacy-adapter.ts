import type { ModelCandidate, ModelTurnEnvelope, PrivacyBoundary, TrustedActor } from '../contracts.js';
import type { MaskedPersistencePolicy } from './postgres-repository.js';

/**
 * Production implementation must bind each operation to the same authenticated
 * tenant/session and store reversible tokens in the existing encrypted vault.
 * It must never use process-local token maps as durable memory.
 */
export interface ScopedPrivacyVault {
  maskAndPersist(actor: TrustedActor, rawText: string): Promise<string>;
  assertMaskedAndKnown(actor: TrustedActor, maskedText: string): Promise<void>;
}

/** P2 boundary adapter: no implicit bypass and no raw-PII model fallback. */
export class SessionScopedPrivacyAdapter implements PrivacyBoundary, MaskedPersistencePolicy {
  constructor(private readonly vault: ScopedPrivacyVault) {}

  async prepareForModel(actor: TrustedActor, envelope: ModelTurnEnvelope): Promise<ModelTurnEnvelope> {
    if (actor.sessionId !== envelope.sessionId || actor.tenantId !== envelope.tenantId) {
      throw new Error('Privacy scope mismatch');
    }
    const customerMessage = await this.vault.maskAndPersist(actor, envelope.customerMessage);
    await Promise.all([
      this.vault.assertMaskedAndKnown(actor, customerMessage),
      this.vault.assertMaskedAndKnown(actor, envelope.conversationSummary),
      ...envelope.latestTurns.map(turn => this.vault.assertMaskedAndKnown(actor, turn.text)),
      ...envelope.verifiedFacts.map(fact => this.vault.assertMaskedAndKnown(actor, fact.value)),
    ]);
    return { ...envelope, customerMessage };
  }

  async validateMaskedResponse(actor: TrustedActor, candidate: ModelCandidate): Promise<void> {
    await Promise.all([
      this.vault.assertMaskedAndKnown(actor, candidate.message),
      ...candidate.proposedFacts.map(fact => this.vault.assertMaskedAndKnown(actor, fact.value)),
      ...(candidate.actionProposal ? [this.vault.assertMaskedAndKnown(actor, JSON.stringify(candidate.actionProposal.input))] : []),
    ]);
  }

  async assertSafeMaskedText(actor: TrustedActor, value: string, _category: 'message' | 'fact' | 'summary'): Promise<void> {
    await this.vault.assertMaskedAndKnown(actor, value);
  }
}

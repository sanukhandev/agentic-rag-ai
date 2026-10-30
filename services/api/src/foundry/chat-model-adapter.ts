import { randomUUID } from 'node:crypto';
import { buildFoundryChatContext, formatFoundryInput } from './context.js';
import { foundryAgentClientFromEnv, FoundryAgentClient } from './agent-client.js';
import { FoundryFunctionDispatcher, FoundryToolExecution } from '../foundry-functions.js';
import type { ChatModel, ModelDraft } from '../model.js';
import type { Store } from '../types.js';

type DraftInput = Parameters<NonNullable<ChatModel['draft']>>[0] & { trustedContext?: { tenantId: string; sessionId: string } };

export class FoundryChatModelAdapter implements ChatModel {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly store: Store, private readonly client: FoundryAgentClient, private readonly agentName: string, private readonly agentVersion: string, private readonly toolExecution?: FoundryToolExecution, private readonly bindingTtlMs = 1_800_000) {}

  async draft(input: DraftInput): Promise<ModelDraft> {
    const trusted = input.trustedContext;
    if (!trusted) throw new Error('Foundry invocation requires trusted tenant and session context.');
    const lockKey = `${trusted.tenantId}:${trusted.sessionId}:${this.agentName}`;
    const previous = this.locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.locks.set(lockKey, queued);
    await previous;
    try {
      const binding = await this.store.getFoundryConversationBinding(trusted.tenantId, trusted.sessionId, this.agentName);
      const context = buildFoundryChatContext(input);
      const toolExecution = this.toolExecution;
      const result = await this.client.respond({ message: formatFoundryInput(input), ...(binding ? { conversationId: binding.foundryConversationId } : {}) }, {
        ...(toolExecution ? { onToolCalls: (calls) => toolExecution.execute({ tenantId: trusted.tenantId, sessionId: trusted.sessionId }, calls) } : {}),
      });
      const now = new Date().toISOString();
      if (binding) {
        const touched = await this.store.touchFoundryConversationBinding({ id: binding.id, tenantId: trusted.tenantId, sessionId: trusted.sessionId, lastUsedAt: now, expiresAt: new Date(Date.now() + this.bindingTtlMs).toISOString() });
        if (!touched) throw new Error('Foundry conversation binding changed while responding.');
      } else {
        await this.store.createFoundryConversationBinding({ id: randomUUID(), tenantId: trusted.tenantId, sessionId: trusted.sessionId, foundryConversationId: result.conversationId, foundryAgentId: this.agentName, foundryAgentVersion: this.agentVersion, status: 'active', revision: 1, createdAt: now, lastUsedAt: now, expiresAt: new Date(Date.now() + this.bindingTtlMs).toISOString(), revokedAt: null });
      }
      return { answer: result.answer.slice(0, 12_000), citationIds: context.knowledge.approvedEvidence.map((item) => item.citationId), proposedIntent: null };
    } finally {
      release();
      if (this.locks.get(lockKey) === queued) this.locks.delete(lockKey);
    }
  }
}

export const foundryChatModelFromEnv = (nodeEnv: string, store: Store, embedding?: import('../embedding.js').EmbeddingProvider): FoundryChatModelAdapter | undefined => {
  const config = foundryAgentClientFromEnv(nodeEnv);
  const toolExecution = embedding ? new FoundryToolExecution(new FoundryFunctionDispatcher({ store, embedding }), { store }) : undefined;
  return config ? new FoundryChatModelAdapter(store, config.client, config.agentName, config.agentVersion, toolExecution) : undefined;
};

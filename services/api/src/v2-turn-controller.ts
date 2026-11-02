import type { V2ConversationCoordinator, V2CoordinatorRequest, V2CoordinatorResult } from './v2-coordinator.js';

/**
 * Single, auditable entry point for a bounded GPT/LangGraph turn.
 * Python proposes dialogue and read-tool calls. Node validates tool scope,
 * grounded output, business state and authorization separately.
 *
 * Never fall back to unguarded model text if this gate rejects a result.
 */
export const executeV2Turn = async (
  coordinator: Pick<V2ConversationCoordinator, 'run'>,
  request: V2CoordinatorRequest,
): Promise<V2CoordinatorResult> => {
  const result = await coordinator.run(request);
  const budget = request.envelope.budgets;
  if (!Number.isSafeInteger(result.modelRequestCount)
      || !Number.isSafeInteger(result.toolCallCount)
      || result.modelRequestCount < 0
      || result.toolCallCount < 0
      || result.modelRequestCount > budget.maxModelRequests
      || result.toolCallCount > budget.maxToolCalls) {
    throw new Error('V2_TURN_BUDGET_EXCEEDED');
  }
  if (new Set(result.response.citationIds).size !== result.response.citationIds.length) {
    throw new Error('V2_DUPLICATE_CITATIONS');
  }
  return result;
};

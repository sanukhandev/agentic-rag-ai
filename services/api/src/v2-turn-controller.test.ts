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

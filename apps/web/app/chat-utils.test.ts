import { describe, expect, it } from 'vitest';
import { applyActionState, historyToReplies, isChatActionState, isValidTenantSlug } from './chat-utils';

describe('web chat utilities', () => {
  it('accepts only tenant-safe slugs', () => {
    expect(isValidTenantSlug('tenant-a')).toBe(true);
    expect(isValidTenantSlug('Tenant A')).toBe(false);
    expect(isValidTenantSlug('../other')).toBe(false);
  });

  it('restores only assistant replies from masked history', () => {
    expect(historyToReplies([
      { role: 'user', content: 'Question', citations: [] },
      { role: 'assistant', content: 'Answer', citations: [{ title: 'FAQ', locator: 'page 1' }] },
    ])).toEqual([{ answer: 'Answer', grounded: true, citations: [{ title: 'FAQ', locator: 'page 1' }] }]);
  });

  it('renders terminal workflow states and keeps unknown actions retryable', () => {
    const replies = [{ answer: 'Done', grounded: true, citations: [], actionProposal: { id: 'action-1', intent: 'lead.capture', confirmation: 'Confirm' } }];
    expect(isChatActionState('completed')).toBe(true);
    expect(isChatActionState('invalid')).toBe(false);
    expect(applyActionState(replies, 'action-1', 'completed')[0]).toMatchObject({ actionState: 'completed', actionProposal: null });
    expect(applyActionState(replies, 'action-1', 'unknown')[0]).toMatchObject({ actionState: 'unknown', actionProposal: { id: 'action-1' } });
  });
});

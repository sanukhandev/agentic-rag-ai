import { describe, expect, it } from 'vitest';
import { historyToReplies, isValidTenantSlug } from './chat-utils';

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
});

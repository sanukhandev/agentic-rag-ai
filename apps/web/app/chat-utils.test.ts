import { describe, expect, it } from 'vitest';
import {
  applyActionState,
  escapeHtml,
  formatInlineMarkdown,
  formatNaturalAbstention,
  historyToReplies,
  isChatActionState,
  isValidTenantSlug,
  renderMarkdown,
  resolveTenantSlug
} from './chat-utils';

describe('web chat utilities', () => {
  it('accepts only tenant-safe slugs', () => {
    expect(isValidTenantSlug('tenant-a')).toBe(true);
    expect(isValidTenantSlug('Tenant A')).toBe(false);
    expect(isValidTenantSlug('../other')).toBe(false);
    expect(isValidTenantSlug('evil/slug')).toBe(false);
  });

  it('resolves tenant slug from search query or uses the supplied fallback', () => {
    expect(resolveTenantSlug('?tenant=acme-corp')).toBe('acme-corp');
    expect(resolveTenantSlug('?tenantSlug=beta')).toBe('beta');
    expect(resolveTenantSlug('', 'tenant-a')).toBe('tenant-a');
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

  it('safely escapes HTML and formats markdown blocks and inline tokens', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    const rendered = renderMarkdown('Key points:\n- Point 1\n- Point 2');
    expect(rendered).toContain('<ul class="my-2.5 space-y-1 list-disc list-inside text-neutral-800">');
    expect(rendered).toContain('<li class="leading-relaxed">Point 1</li>');
  });

  it('converts technical abstention text into concise, human phrasing', () => {
    const technical = "I’m Sales assistant. The approved knowledge does not establish an answer to that question, so I won’t guess.";
    const natural = formatNaturalAbstention(technical, 'Sales assistant');
    expect(natural).not.toContain('won’t guess');
    expect(natural).toContain('I don’t have verified documentation on that topic in our current records');
  });
});

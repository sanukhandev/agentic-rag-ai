import { describe, expect, it } from 'vitest';
import {
  applyActionState,
  actionOutcomeText,
  escapeHtml,
  formatNaturalAbstention,
  formatVoiceCountdownText,
  getVoiceStateMeta,
  historyToReplies,
  isChatActionState,
  isValidTenantSlug,
  normalizeVoiceTranscript,
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

  it('normalizes browser voice transcript fragments into one chat message', () => {
    expect(normalizeVoiceTranscript(['  hello', 'there  ', '', 'Nova'])).toBe('hello there Nova');
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
    expect(isChatActionState('reconcile_required')).toBe(true);
    expect(isChatActionState('invalid')).toBe(false);
    expect(applyActionState(replies, 'action-1', 'completed')[0]).toMatchObject({ actionState: 'completed', actionProposal: null });
    expect(applyActionState(replies, 'action-1', 'unknown')[0]).toMatchObject({ actionState: 'unknown', actionProposal: { id: 'action-1' } });
    expect(actionOutcomeText('completed')).toContain('submitted successfully');
    expect(actionOutcomeText('failed')).toContain('could not submit');
    expect(actionOutcomeText('processing')).toContain('registered');
    expect(actionOutcomeText('reconcile_required')).toContain('needs review');
  });

  it('safely escapes HTML and formats markdown blocks and inline tokens', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    const rendered = renderMarkdown('Key points:\n- Point 1\n- Point 2');
    expect(rendered).toContain('<ul class="my-2.5 space-y-1 list-disc list-inside text-neutral-800">');
    expect(rendered).toContain('<li class="leading-relaxed">Point 1</li>');
  });

  it('converts technical abstention text into concise, human phrasing', () => {
    const technical = "I’m Sales assistant. The approved knowledge does not establish an answer to that question, so I won’t guess.";
    const natural = formatNaturalAbstention(technical);
    expect(natural).not.toContain('won’t guess');
    expect(natural).toContain('information available here');
  });

  it('formats voice countdown and provides voice state metadata', () => {
    expect(formatVoiceCountdownText(10)).toBe('Auto-closing in 10s');
    expect(formatVoiceCountdownText(0)).toBe('Auto-closing in 0s');
    expect(formatVoiceCountdownText(null)).toBe('');

    const waitingMeta = getVoiceStateMeta('waiting_for_next', 10, 'Ava');
    expect(waitingMeta.badgeText).toBe('10s remaining');
    expect(waitingMeta.title).toBe('Waiting for Next Question');
    expect(waitingMeta.subtitle).toContain('10s');

    const listeningMeta = getVoiceStateMeta('listening', null);
    expect(listeningMeta.badgeText).toBe('Listening');
    expect(listeningMeta.title).toBe('Listening...');

    const speakingMeta = getVoiceStateMeta('speaking', null, 'Ava');
    expect(speakingMeta.badgeText).toBe('Speaking');
    expect(speakingMeta.title).toBe('Ava Speaking');
  });
});

import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatInlineMarkdown,
  formatNaturalAbstention,
  isValidTenantSlug,
  renderMarkdown,
  resolveTenantSlug
} from './index.js';

describe('shared chat utilities', () => {
  it('validates tenant slugs and resolves supported query keys', () => {
    expect(isValidTenantSlug('acme-corp')).toBe(true);
    expect(isValidTenantSlug('../other')).toBe(false);
    expect(resolveTenantSlug('?tenantSlug=Acme')).toBe('acme');
    expect(resolveTenantSlug('?other=value', 'fallback')).toBe('fallback');
  });

  it('escapes markup before applying supported inline formatting', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    const formatted = formatInlineMarkdown('*bold* _italic_ ~removed~ `ID-1`');
    expect(formatted).toContain('<strong');
    expect(formatted).toContain('<em');
    expect(formatted).toContain('<del');
    expect(formatted).toContain('<code');
    expect(renderMarkdown('- one\n- two')).toContain('<ul');
    expect(renderMarkdown('• one\n• two')).toContain('<ul');
  });

  it('normalizes technical abstentions without changing ordinary answers', () => {
    const technical = 'The approved knowledge does not establish an answer, so I won’t guess.';
    expect(formatNaturalAbstention(technical, 'Not available.')).toBe('Not available.');
    expect(formatNaturalAbstention('Grounded answer')).toBe('Grounded answer');
  });
});

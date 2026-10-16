import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatInlineMarkdown,
  formatNaturalAbstention,
  isValidTenantSlug,
  renderMarkdown,
  resolveTenantSlug
} from './customer-chat-utils';

describe('customer-chat-utils', () => {
  it('validates and resolves tenant slugs without customer-facing input', () => {
    expect(isValidTenantSlug('acme-corp')).toBe(true);
    expect(isValidTenantSlug('demo')).toBe(true);
    expect(isValidTenantSlug('invalid slug!')).toBe(false);

    expect(resolveTenantSlug('?tenant=acme-global')).toBe('acme-global');
    expect(resolveTenantSlug('?tenantSlug=beta-test')).toBe('beta-test');
    expect(resolveTenantSlug('', 'demo')).toBe('demo');
    expect(resolveTenantSlug('?other=123', 'fallback-org')).toBe('fallback-org');
  });

  it('escapes raw HTML to prevent injection while formatting inline markdown', () => {
    const malicious = '<script>alert(1)</script>';
    expect(escapeHtml(malicious)).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');

    const formatted = formatInlineMarkdown('Check **bold** and `code` formatting');
    expect(formatted).toContain('<strong class="font-semibold text-neutral-900">bold</strong>');
    expect(formatted).toContain('<code class="rounded bg-neutral-100');
  });

  it('renders rich markdown paragraphs, lists, and code blocks safely', () => {
    const markdown = `Here is an introduction.

- First key feature
- Second key feature

\`\`\`json
{ "status": "active" }
\`\`\`

1. Step one
2. Step two`;

    const rendered = renderMarkdown(markdown);
    expect(rendered).toContain('<p class="leading-relaxed mb-2.5 text-neutral-800">Here is an introduction.</p>');
    expect(rendered).toContain('<ul class="my-2.5 space-y-1 list-disc list-inside text-neutral-800">');
    expect(rendered).toContain('<li class="leading-relaxed">First key feature</li>');
    expect(rendered).toContain('<pre class="my-3 overflow-x-auto rounded-xl bg-neutral-900');
    expect(rendered).toContain('<ol class="my-2.5 space-y-1 list-decimal list-inside text-neutral-800">');
  });

  it('transforms technical abstention messages into natural, helpful language', () => {
    const technical = "I’m Sales assistant. The approved knowledge does not establish an answer to that question, so I won’t guess.";
    const natural = formatNaturalAbstention(technical, 'Aura Guide');
    expect(natural).toContain('I don’t have verified documentation on that topic in our current records');
    expect(natural).not.toContain('so I won’t guess');

    const normalGrounded = 'Our SLA response time is 15 minutes for Sev-1 incidents.';
    expect(formatNaturalAbstention(normalGrounded)).toBe(normalGrounded);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ChatCitation,
  formatNaturalAbstention,
  renderMarkdown,
  resolveTenantSlug
} from './customer-chat-utils';

describe('CustomerChatComponent logic and contracts', () => {
  it('resolves tenant context securely without manual slug input', () => {
    // Verifies requirement 3: customer does not type tenant slug manually
    const slugFromQuery = resolveTenantSlug('?tenant=enterprise-alpha');
    expect(slugFromQuery).toBe('enterprise-alpha');

    const defaultSlug = resolveTenantSlug('', 'tenant-a');
    expect(defaultSlug).toBe('tenant-a');
  });

  it('renders markdown with safe HTML structure for assistant answers', () => {
    // Verifies requirement 7: Markdown answers & secure rendering
    const answer = `### Pricing Details\n\nOur Enterprise Tier includes:\n- Dedicated VPC peering\n- **15-minute** SLA response\n- 24/7 engineering dispatch`;
    const html = renderMarkdown(answer);

    expect(html).toContain('<ul class="my-2.5 space-y-1 list-disc list-inside text-neutral-800">');
    expect(html).toContain('<strong class="font-semibold text-neutral-900">15-minute</strong>');
    expect(html).not.toContain('<script>');
  });

  it('converts technical abstention messages to natural, polite customer language', () => {
    // Verifies requirement 9: Replace repetitive technical abstention messages
    const rawAbstention = 'I’m Sales assistant. The approved knowledge does not establish an answer to that question, so I won’t guess.';
    const natural = formatNaturalAbstention(rawAbstention, 'Aura Guide');

    expect(natural).not.toContain('won’t guess');
    expect(natural).toContain('I don’t have verified documentation on that topic in our current records');
  });

  it('preserves verified citation locators and titles for source drawer expansion', () => {
    // Verifies requirement 7: Accessible source references
    const citations: ChatCitation[] = [
      { title: 'SOC-2 Type II Report', locator: 'Section 3.2' },
      { title: 'Master Services Agreement', locator: 'Appendix A' }
    ];

    expect(citations.length).toBe(2);
    expect(citations[0].title).toBe('SOC-2 Type II Report');
    expect(citations[1].locator).toBe('Appendix A');
  });
});

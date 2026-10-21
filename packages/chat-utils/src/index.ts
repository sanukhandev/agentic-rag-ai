export type ChatCitation = { title: string; locator: string };

export const isValidTenantSlug = (slug: string): boolean => /^[a-z0-9-]+$/i.test(slug.trim());

export const resolveTenantSlug = (search?: string, fallback = ''): string => {
  if (typeof window === 'undefined' && !search) return fallback;
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(query);
  const candidate = params.get('tenant') ?? params.get('tenantSlug') ?? '';
  if (candidate && isValidTenantSlug(candidate)) return candidate.toLowerCase().trim();
  return fallback;
};

export const escapeHtml = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const formatInlineMarkdown = (text: string): string => text
  .replace(/`([^`]+)`/g, '<code class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-900 border border-neutral-200/60">$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-neutral-900">$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');

export const renderMarkdown = (raw: string): string => {
  if (!raw || !raw.trim()) return '';
  const lines = escapeHtml(raw.trim()).split('\n');
  const blocks: string[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const flushList = () => {
    if (!currentList) return;
    const tag = currentList.type;
    const listClass = tag === 'ul' ? 'my-2.5 space-y-1 list-disc list-inside text-neutral-800' : 'my-2.5 space-y-1 list-decimal list-inside text-neutral-800';
    const itemsHtml = currentList.items.map((item) => `<li class="leading-relaxed">${item}</li>`).join('');
    blocks.push(`<${tag} class="${listClass}">${itemsHtml}</${tag}>`);
    currentList = null;
  };

  const flushCode = () => {
    if (!inCodeBlock) return;
    blocks.push(`<pre class="my-3 overflow-x-auto rounded-xl bg-neutral-900 p-3.5 font-mono text-xs text-neutral-100 shadow-subtle"><code>${codeBuffer.join('\n')}</code></pre>`);
    codeBuffer = [];
    inCodeBlock = false;
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCodeBlock) flushCode();
      else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.*)$/);
    if (unordered) {
      if (currentList && currentList.type !== 'ul') flushList();
      if (!currentList) currentList = { type: 'ul', items: [] };
      currentList.items.push(formatInlineMarkdown(unordered[1] ?? ''));
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      if (currentList && currentList.type !== 'ol') flushList();
      if (!currentList) currentList = { type: 'ol', items: [] };
      currentList.items.push(formatInlineMarkdown(ordered[1] ?? ''));
      continue;
    }

    if (!line.trim()) {
      flushList();
      continue;
    }

    flushList();
    blocks.push(`<p class="leading-relaxed mb-2.5 text-neutral-800">${formatInlineMarkdown(line)}</p>`);
  }

  flushList();
  flushCode();
  return blocks.join('');
};

const technicalAbstentionPatterns = [
  /approved knowledge does not establish an answer/i,
  /approved sources contain conflicting facts/i,
  /won’t guess|wont guess/i,
  /no approved evidence — no claim made/i,
  /not documented in approved enterprise sources/i,
  /in accordance with zero-speculation policy/i
];

export const formatNaturalAbstention = (
  rawAnswer: string,
  fallback = 'I don’t have that detail in the information available here. I can help with the products, services, projects, or public links covered by this assistant.'
): string => technicalAbstentionPatterns.some((pattern) => pattern.test(rawAnswer)) ? fallback : rawAnswer;

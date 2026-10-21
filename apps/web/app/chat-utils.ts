export const isValidTenantSlug = (slug: string): boolean => /^[a-z0-9-]+$/i.test(slug.trim());

export const resolveTenantSlug = (search?: string, fallback = ''): string => {
  if (typeof window === 'undefined' && !search) return fallback;
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(query);
  const candidate = params.get('tenant') ?? params.get('tenantSlug') ?? '';
  if (candidate && isValidTenantSlug(candidate)) {
    return candidate.toLowerCase().trim();
  }
  return fallback;
};

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'waiting_for_next';

export const formatVoiceCountdownText = (countdown: number | null): string => {
  if (countdown === null || countdown === undefined) return '';
  return `Auto-closing in ${Math.max(0, countdown)}s`;
};

export const getVoiceStateMeta = (
  state: VoiceState,
  countdown: number | null,
  agentName = 'Assistant'
): {
  title: string;
  subtitle: string;
  badgeText: string;
  badgeClass: string;
} => {
  switch (state) {
    case 'listening':
      return {
        title: 'Listening...',
        subtitle: 'Speak your question clearly into your microphone',
        badgeText: 'Listening',
        badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700'
      };
    case 'processing':
      return {
        title: 'Transcribing & Reasoning...',
        subtitle: 'Validating against approved tenant knowledge',
        badgeText: 'Transcribing',
        badgeClass: 'border-neutral-300 bg-neutral-100 text-neutral-700'
      };
    case 'speaking':
      return {
        title: `${agentName} Speaking`,
        subtitle: 'Reading the verified response aloud',
        badgeText: 'Speaking',
        badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700'
      };
    case 'waiting_for_next':
      return {
        title: 'Waiting for Next Question',
        subtitle:
          countdown !== null
            ? `Speak your follow-up question (${formatVoiceCountdownText(countdown)})`
            : 'Speak your follow-up question',
        badgeText: countdown !== null ? `${countdown}s remaining` : 'Waiting',
        badgeClass: 'border-amber-300 bg-amber-50 text-amber-800'
      };
    case 'idle':
    default:
      return {
        title: 'Voice Inactive',
        subtitle: 'Click the microphone to start voice conversation',
        badgeText: 'Idle',
        badgeClass: 'border-neutral-200 bg-neutral-50 text-neutral-500'
      };
  }
};

export const normalizeVoiceTranscript = (parts: readonly string[]): string =>
  parts.map((part) => part.trim()).filter(Boolean).join(' ');

export type ChatCitation = { title: string; locator: string };
export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string; citations: ChatCitation[]; conversational?: boolean };
export type ChatActionState = 'awaiting_confirmation' | 'approved' | 'processing' | 'completed' | 'failed' | 'unknown';
export type ChatActionProposal = { id: string; intent: string; confirmation: string; consentRequired?: boolean; expiresAt?: string };
export type ChatReply = {
  answer: string;
  grounded: boolean;
  conversational?: boolean;
  citations: ChatCitation[];
  actionProposal?: ChatActionProposal | null;
  actionState?: ChatActionState;
  copied?: boolean;
  feedback?: 'up' | 'down';
  expandedCitations?: boolean;
};

export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  grounded: boolean;
  conversational?: boolean;
  citations: ChatCitation[];
  actionProposal?: ChatActionProposal | null;
  actionState?: ChatActionState;
  createdAt: string;
  copied?: boolean;
  feedback?: 'up' | 'down';
  expandedCitations?: boolean;
  naturalAnswer?: string;
}

export const historyToReplies = (messages: readonly ChatHistoryMessage[]): ChatReply[] =>
  messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      answer: message.content,
      grounded: message.citations.length > 0,
      ...(message.conversational ? { conversational: true } : {}),
      citations: message.citations
    }));

export const isChatActionState = (value: unknown): value is ChatActionState =>
  value === 'awaiting_confirmation' || value === 'approved' || value === 'processing' || value === 'completed' || value === 'failed' || value === 'unknown';

export const actionOutcomeText = (state: ChatActionState): string | null =>
  state === 'completed'
    ? 'Your contact request has been submitted successfully. Sanu’s team can follow up using the details you provided.'
    : state === 'failed'
      ? 'I could not submit your contact request. Please try again or contact Sanu directly.'
      : state === 'approved' || state === 'processing'
        ? 'Your request is registered. We’ll continue processing it asynchronously.'
      : null;

export const applyActionState = (replies: readonly ChatReply[], proposalId: string, state: ChatActionState): ChatReply[] =>
  replies.map((reply) =>
    reply.actionProposal?.id !== proposalId
      ? reply
      : { ...reply, actionState: state, actionProposal: state === 'awaiting_confirmation' || state === 'unknown' ? reply.actionProposal : null }
  );

export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const formatInlineMarkdown = (text: string): string => {
  return text
    .replace(/`([^`]+)`/g, '<code class="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs text-neutral-900 border border-neutral-200/60">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-neutral-900">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em class="italic">$1</em>');
};

export const renderMarkdown = (raw: string): string => {
  if (!raw || !raw.trim()) return '';
  const escaped = escapeHtml(raw.trim());
  const lines = escaped.split('\n');
  const blocks: string[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  const flushList = () => {
    if (currentList) {
      const tag = currentList.type;
      const listClass = tag === 'ul' ? 'my-2.5 space-y-1 list-disc list-inside text-neutral-800' : 'my-2.5 space-y-1 list-decimal list-inside text-neutral-800';
      const itemsHtml = currentList.items.map((it) => `<li class="leading-relaxed">${it}</li>`).join('');
      blocks.push(`<${tag} class="${listClass}">${itemsHtml}</${tag}>`);
      currentList = null;
    }
  };

  const flushCode = () => {
    if (inCodeBlock) {
      blocks.push(`<pre class="my-3 overflow-x-auto rounded-xl bg-neutral-900 p-3.5 font-mono text-xs text-neutral-100 shadow-subtle"><code>${codeBuffer.join('\n')}</code></pre>`);
      codeBuffer = [];
      inCodeBlock = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        flushCode();
      } else {
        flushList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (currentList && currentList.type !== 'ul') flushList();
      if (!currentList) currentList = { type: 'ul', items: [] };
      currentList.items.push(formatInlineMarkdown(ulMatch[1]));
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (currentList && currentList.type !== 'ol') flushList();
      if (!currentList) currentList = { type: 'ol', items: [] };
      currentList.items.push(formatInlineMarkdown(olMatch[1]));
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

export const formatNaturalAbstention = (rawAnswer: string, agentName = 'our assistant'): string => {
  const technicalPatterns = [
    /approved knowledge does not establish an answer/i,
    /approved sources contain conflicting facts/i,
    /won’t guess|wont guess/i,
    /no approved evidence — no claim made/i,
    /not documented in approved enterprise sources/i,
    /in accordance with zero-speculation policy/i
  ];

  const isTechnicalAbstention = technicalPatterns.some((pattern) => pattern.test(rawAnswer));
  if (isTechnicalAbstention) {
    return 'I don’t have that detail in the information available here. I can help with the products, services, projects, or public links covered by this assistant.';
  }
  return rawAnswer;
};

export { escapeHtml, formatInlineMarkdown, formatNaturalAbstention, isValidTenantSlug, renderMarkdown, resolveTenantSlug } from '@agentic-rag/chat-utils';
export type { ChatCitation } from '@agentic-rag/chat-utils';
import type { ChatCitation } from '@agentic-rag/chat-utils';

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

export const formatAgentGreeting = (greeting: string | undefined, fallback: string): string => {
  const normalized = greeting?.replace(/\s+/gu, ' ').replace(/([.!؟?])(?=\p{L})/gu, '$1 ').trim() ?? '';
  return normalized || fallback;
};

export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string; citations: ChatCitation[]; conversational?: boolean; pendingRequirementKey?: string | null };
export type ChatActionState = 'awaiting_confirmation' | 'approved' | 'processing' | 'completed' | 'failed' | 'reconcile_required' | 'awaiting_customer' | 'human_review' | 'unknown';
export type ChatActionProposal = { id: string; intent: string; confirmation: string; consentRequired?: boolean; expiresAt?: string };
export type ChatReply = {
  answer: string;
  grounded: boolean;
  conversational?: boolean;
  citations: ChatCitation[];
  pendingRequirementKey?: string | null;
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
  pendingRequirementKey?: string | null;
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
  value === 'awaiting_confirmation' || value === 'approved' || value === 'processing' || value === 'completed' || value === 'failed' || value === 'reconcile_required' || value === 'awaiting_customer' || value === 'human_review' || value === 'unknown';

export const isTerminalChatActionState = (state: ChatActionState): boolean => state === 'completed' || state === 'failed' || state === 'reconcile_required' || state === 'awaiting_customer' || state === 'human_review';

export const actionOutcomeText = (state: ChatActionState): string | null =>
  state === 'completed'
    ? 'Your contact request has been submitted successfully. Sanu’s team can follow up using the details you provided.'
      : state === 'failed'
        ? 'I could not submit your contact request. Please try again or contact Sanu directly.'
        : state === 'reconcile_required'
          ? 'Your request is registered, but the external confirmation needs review before I can mark it complete.'
        : state === 'awaiting_customer'
          ? 'Your request is saved. I still need a few details from you before it can proceed.'
        : state === 'human_review'
          ? 'Your request is registered and has been sent for team review.'
      : null;

export const applyActionState = (replies: readonly ChatReply[], proposalId: string, state: ChatActionState): ChatReply[] =>
  replies.map((reply) =>
    reply.actionProposal?.id !== proposalId
      ? reply
      : { ...reply, actionState: state, actionProposal: state === 'awaiting_confirmation' || state === 'unknown' || !isTerminalChatActionState(state) ? reply.actionProposal : null }
  );

import { formatNaturalAbstention as formatSharedNaturalAbstention } from '@agentic-rag/chat-utils';
import type { ChatCitation } from '@agentic-rag/chat-utils';

export { escapeHtml, formatInlineMarkdown, isValidTenantSlug, renderMarkdown, resolveTenantSlug } from '@agentic-rag/chat-utils';
export type { ChatCitation } from '@agentic-rag/chat-utils';

export interface ChatActionProposal {
  id: string;
  intent: string;
  confirmation: string;
  consentRequired?: boolean;
  expiresAt?: string;
}

export type ChatActionState = 'awaiting_confirmation' | 'approved' | 'processing' | 'completed' | 'failed' | 'reconcile_required' | 'awaiting_customer' | 'human_review' | 'unknown';

export interface CustomerChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  grounded: boolean;
  conversational?: boolean;
  citations: ChatCitation[];
  actionProposal?: ChatActionProposal | null;
  actionState?: ChatActionState;
  actionOutcome?: string;
  createdAt: string;
  copied?: boolean;
  feedback?: 'up' | 'down';
  expandedCitations?: boolean;
  renderedHtml?: string;
  naturalAnswer?: string;
  diagnostics?: {
    requestId?: string;
    sessionId?: string;
    rawGrounded?: boolean;
    rawConversational?: boolean;
    latencyMs?: number;
    tokens?: { input: number; output: number };
  };
}

const ADMIN_ABSTENTION_FALLBACK = 'I don’t have verified documentation on that topic in our current records. I\'m happy to help with questions covered in our published products, pricing, or service specifications.';

export const formatNaturalAbstention = (rawAnswer: string): string =>
  formatSharedNaturalAbstention(rawAnswer, ADMIN_ABSTENTION_FALLBACK);

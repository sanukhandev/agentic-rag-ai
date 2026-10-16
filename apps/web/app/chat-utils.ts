export const isValidTenantSlug = (slug: string): boolean => /^[a-z0-9-]+$/.test(slug);

export type ChatCitation = { title: string; locator: string };
export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string; citations: ChatCitation[]; conversational?: boolean };
export type ChatActionState = 'awaiting_confirmation' | 'completed' | 'failed' | 'unknown';
export type ChatActionProposal = { id: string; intent: string; confirmation: string; expiresAt?: string };
export type ChatReply = { answer: string; grounded: boolean; conversational?: boolean; citations: ChatCitation[]; actionProposal?: ChatActionProposal | null; actionState?: ChatActionState };

export const historyToReplies = (messages: readonly ChatHistoryMessage[]): ChatReply[] => messages.filter((message) => message.role === 'assistant').map((message) => ({ answer: message.content, grounded: message.citations.length > 0, ...(message.conversational ? { conversational: true } : {}), citations: message.citations }));

export const isChatActionState = (value: unknown): value is ChatActionState => value === 'awaiting_confirmation' || value === 'completed' || value === 'failed' || value === 'unknown';

export const applyActionState = (replies: readonly ChatReply[], proposalId: string, state: ChatActionState): ChatReply[] => replies.map((reply) => reply.actionProposal?.id !== proposalId
  ? reply
  : { ...reply, actionState: state, actionProposal: state === 'completed' || state === 'failed' ? null : reply.actionProposal });

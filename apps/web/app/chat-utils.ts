export const isValidTenantSlug = (slug: string): boolean => /^[a-z0-9-]+$/.test(slug);

export type ChatCitation = { title: string; locator: string };
export type ChatHistoryMessage = { role: 'user' | 'assistant'; content: string; citations: ChatCitation[] };
export type ChatReply = { answer: string; grounded: boolean; citations: ChatCitation[] };

export const historyToReplies = (messages: readonly ChatHistoryMessage[]): ChatReply[] => messages.filter((message) => message.role === 'assistant').map((message) => ({ answer: message.content, grounded: message.citations.length > 0, citations: message.citations }));

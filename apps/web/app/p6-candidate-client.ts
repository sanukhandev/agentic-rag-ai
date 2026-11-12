import type { ChatReply } from './chat-utils';

interface P6PreviewResponse {
  readonly answer?: unknown;
  readonly grounded?: unknown;
  readonly conversational?: unknown;
  readonly citations?: unknown;
  readonly engine?: unknown;
  readonly error?: { readonly code?: string };
}

/** Preview-only transport; returns the existing ChatReply shape. Never sends
 * a V2 workflow postback or exposes a session credential in the URL.
 */
export async function sendP6CandidateTurn(
  apiBase: string, sessionId: string, sessionToken: string,
  clientMessageId: string, message: string,
  transport: typeof fetch = fetch,
): Promise<ChatReply> {
  if (!sessionId || !sessionToken || !clientMessageId || !message.trim()) {
    throw new Error('A secure P6 candidate session and nonempty message are required.');
  }
  const response = await transport(`${apiBase.replace(/\/$/u, '')}/api/v1/chat/candidate/turn`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-agentic-session-token': sessionToken,
    },
    body: JSON.stringify({ sessionId, clientMessageId, message }),
    cache: 'no-store',
  });
  const raw: unknown = await response.json().catch(() => null);
  const data: P6PreviewResponse = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as P6PreviewResponse : {};
  if (!response.ok) {
    throw new Error(data.error?.code === 'P6_FRESH_SESSION_REQUIRED'
      ? 'Start a new P6 preview conversation instead of continuing a V2 session.'
      : 'The P6 candidate is unavailable. Your existing V2 conversation is unchanged.');
  }
  if (data.engine !== 'p6-candidate' || typeof data.answer !== 'string'
    || !Array.isArray(data.citations)) throw new Error('Invalid P6 candidate response.');
  return {
    answer: data.answer, grounded: data.grounded === true,
    conversational: data.conversational !== false,
    citations: data.citations as ChatReply['citations'],
  };
}

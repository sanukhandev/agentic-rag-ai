import type { ChatReply } from './chat-utils';

type StreamEvent = {
  type: string;
  id?: string;
  sessionId?: string;
  clientMessageId?: string;
  answer?: string;
  response?: Record<string, unknown>;
  error?: { code?: string; message?: string; retryable?: boolean };
};

type PendingTurn = {
  answer?: string;
  resolve: (reply: ChatReply) => void;
  reject: (error: Error) => void;
};

const asReply = (event: StreamEvent, answer?: string): ChatReply => {
  const response = event.response ?? {};
  return {
    ...(response as Partial<ChatReply>),
    answer: typeof response.answer === 'string' ? response.answer : answer ?? '',
    grounded: response.grounded === true,
    conversational: response.conversational !== false,
    citations: Array.isArray(response.citations) ? response.citations as ChatReply['citations'] : [],
  };
};

export class ChatStreamClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private lastEventId = '0-0';
  private sessionId: string | null = null;
  private sessionToken: string | null = null;
  private readonly pending = new Map<string, PendingTurn>();

  constructor(private readonly url: string) {}

  private handleEvent(event: StreamEvent): void {
    if (event.id) this.lastEventId = event.id;
    if (event.type === 'turn.failed' && event.clientMessageId) {
      const turn = this.pending.get(event.clientMessageId);
      if (turn) {
        this.pending.delete(event.clientMessageId);
        turn.reject(new Error(event.error?.message ?? 'The conversation could not continue right now.'));
      }
      return;
    }
    if (event.type === 'assistant.message' && event.clientMessageId) {
      const turn = this.pending.get(event.clientMessageId);
      if (turn && typeof event.answer === 'string') turn.answer = event.answer;
      return;
    }
    if (event.type !== 'turn.completed' || !event.clientMessageId) return;
    const turn = this.pending.get(event.clientMessageId);
    if (!turn) return;
    this.pending.delete(event.clientMessageId);
    turn.resolve(asReply(event, turn.answer));
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer || this.pending.size === 0) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.sessionId && this.sessionToken) void this.connect(this.sessionId, this.sessionToken).catch(() => this.scheduleReconnect());
    }, 500);
  }

  async connect(sessionId: string, sessionToken: string): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.closed = false;
    this.sessionId = sessionId;
    this.sessionToken = sessionToken;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let authenticated = false;
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'authenticate', sessionId, sessionToken, ...(this.lastEventId !== '0-0' ? { afterEventId: this.lastEventId } : {}) }));
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as StreamEvent;
          if (event.type === 'authenticated') {
            authenticated = true;
            resolve();
          }
          this.handleEvent(event);
        } catch {
          if (!authenticated) reject(new Error('The conversation stream returned an invalid response.'));
        }
      };
      socket.onerror = () => {
        if (!authenticated) reject(new Error('The conversation stream is unavailable.'));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (!authenticated) reject(new Error('The conversation stream could not be opened.'));
        this.scheduleReconnect();
      };
    }).finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  async send(sessionId: string, sessionToken: string, clientMessageId: string, message: string, postbackValue?: string): Promise<ChatReply> {
    await this.connect(sessionId, sessionToken);
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('The conversation stream is unavailable.');
    return new Promise<ChatReply>((resolve, reject) => {
      this.pending.set(clientMessageId, { resolve, reject });
      socket.send(JSON.stringify({ type: 'message', clientMessageId, message, ...(postbackValue ? { postbackValue } : {}) }));
    });
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const turn of this.pending.values()) turn.reject(new Error('The conversation stream was closed.'));
    this.pending.clear();
    this.socket?.close();
    this.socket = null;
    this.sessionId = null;
    this.sessionToken = null;
  }
}

export const chatStreamUrl = (apiBase: string): string => {
  const target = new URL(apiBase || window.location.origin, window.location.origin);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  target.pathname = '/api/chat/stream';
  target.search = '';
  target.hash = '';
  return target.toString();
};

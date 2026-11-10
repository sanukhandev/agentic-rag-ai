import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';

const authFrame = z.object({ type: z.literal('authenticate'), sessionId: z.string().trim().min(8).max(128), sessionToken: z.string().trim().min(16).max(512) }).strict();
const messageFrame = z.object({
  type: z.literal('message'),
  clientMessageId: z.string().trim().min(8).max(256),
  message: z.string().trim().min(1).max(5_000),
  postbackValue: z.string().trim().max(256).optional(),
}).strict();

export type ChatStreamMessageFrame = z.infer<typeof messageFrame>;
export type ChatStreamAuthFrame = z.infer<typeof authFrame>;
export type ChatStreamFrame = ChatStreamAuthFrame | ChatStreamMessageFrame;

export const parseChatStreamFrame = (raw: string | Buffer): ChatStreamFrame => {
  const parsed: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  const result = typeof parsed === 'object' && parsed !== null && 'type' in parsed && parsed.type === 'authenticate'
    ? authFrame.safeParse(parsed)
    : messageFrame.safeParse(parsed);
  if (!result.success) throw new Error('INVALID_CHAT_STREAM_FRAME');
  return result.data;
};

export const retryableStreamError = (code: string): { code: string; message: string; retryable: boolean } => code === 'MODEL_QUEUE_OVERLOADED'
  ? { code, message: 'Conversation volume is high right now. Please ask your question again in a moment.', retryable: true }
  : { code: 'CHAT_STREAM_FAILED', message: 'The conversation could not continue right now. Please try again.', retryable: true };

type Socket = WebSocket & { isAlive?: boolean };

export interface ChatStreamDependencies {
  authorize: (sessionId: string, sessionToken: string, request: IncomingMessage) => Promise<void>;
  handleMessage: (sessionId: string, sessionToken: string, frame: ChatStreamMessageFrame, request: IncomingMessage) => Promise<{ answer?: string; response?: Record<string, unknown> }>;
  allowedOrigins?: Set<string>;
  maxConnections?: number;
}

const send = (socket: Socket, event: Record<string, unknown>): void => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
};

export const attachChatStream = (server: Server, dependencies: ChatStreamDependencies): { close: () => Promise<void> } => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
  const sockets = new Set<Socket>();
  const maxConnections = Math.max(1, dependencies.maxConnections ?? 100);
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (socket.isAlive === false) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  const upgrade = (request: IncomingMessage, socket: NodeJS.WritableStream & { destroy: () => void }, head: Buffer): void => {
    const url = new URL(request.url ?? '/', 'http://internal');
    if (url.pathname !== '/api/chat/stream') return;
    const origin = request.headers.origin;
    if (origin && dependencies.allowedOrigins && !dependencies.allowedOrigins.has(origin)) { socket.destroy(); return; }
    if (sockets.size >= maxConnections) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket as never, head, (client) => wss.emit('connection', client, request));
  };
  server.on('upgrade', upgrade);

  wss.on('connection', (rawSocket, request) => {
    const socket = rawSocket as Socket;
    sockets.add(socket);
    socket.isAlive = true;
    let identity: { sessionId: string; sessionToken: string } | null = null;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('close', () => { sockets.delete(socket); });
    socket.on('message', (payload) => {
      void (async () => {
        try {
          const frame = parseChatStreamFrame(payload as Buffer);
          if (!identity) {
            if (frame.type !== 'authenticate') throw new Error('CHAT_STREAM_AUTH_REQUIRED');
            await dependencies.authorize(frame.sessionId, frame.sessionToken, request);
            identity = { sessionId: frame.sessionId, sessionToken: frame.sessionToken };
            send(socket, { type: 'authenticated', sessionId: frame.sessionId });
            return;
          }
          if (frame.type !== 'message') throw new Error('CHAT_STREAM_ALREADY_AUTHENTICATED');
          send(socket, { type: 'turn.accepted', clientMessageId: frame.clientMessageId });
          const result = await dependencies.handleMessage(identity.sessionId, identity.sessionToken, frame, request);
          if (result.answer) send(socket, { type: 'assistant.message', clientMessageId: frame.clientMessageId, answer: result.answer });
          send(socket, { type: 'turn.completed', clientMessageId: frame.clientMessageId, ...(result.response ? { response: result.response } : {}) });
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'CHAT_STREAM_FAILED';
          const safe = retryableStreamError(code);
          console.error(JSON.stringify({ event: 'chat_stream.failure', code, message: error instanceof Error ? error.message : String(error) }));
          send(socket, { type: 'turn.failed', error: safe });
        }
      })();
    });
  });

  return { close: async () => { clearInterval(heartbeat); for (const socket of sockets) socket.close(); await new Promise<void>((resolve) => wss.close(() => resolve())); server.off('upgrade', upgrade); } };
};

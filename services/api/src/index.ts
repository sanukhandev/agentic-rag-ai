import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { attachChatStream, type ChatStreamMessageFrame } from './chat-stream.js';
import { embeddingProviderFromEnv } from './embedding.js';
import { pythonSummaryModelFromEnv } from './python-model/chat-model-adapter.js';
import { createCache } from './cache.js';
import { MemoryStore } from './store-memory.js';
import { PostgresStore } from './store-postgres.js';
import { assertConversationEngineV2Configuration, ConversationTurnCoordinator, HttpV2ConversationAgent } from './conversation/coordinator.js';
import { HttpV2GroundingVerifier } from './conversation/grounding-verifier.js';
import { RedisChatTurnQueue } from './chat-turn-queue.js';

const port = Number(process.env.PORT ?? 4000);
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv === 'production' && (process.env.STORE !== 'postgres' || !process.env.DATABASE_URL)) throw new Error('Production requires STORE=postgres and DATABASE_URL.');
if (nodeEnv === 'production' && !process.env.REDIS_URL) throw new Error('Production requires REDIS_URL.');
assertConversationEngineV2Configuration(nodeEnv);
const pool = process.env.STORE === 'postgres' && process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const store = pool ? new PostgresStore(pool) : new MemoryStore();
const cache = createCache(process.env.REDIS_URL);
const chatTurnQueue = process.env.REDIS_URL && process.env.CHAT_STREAM_INTERNAL_SECRET ? new RedisChatTurnQueue(process.env.REDIS_URL) : undefined;
const embedding = embeddingProviderFromEnv();
// The canonical turn coordinator is the only active chat planner. The legacy
// model adapter remains available only for the separate CRM summary route.
const model = undefined;
const summaryModel = pythonSummaryModelFromEnv();
const v2Coordinator = process.env.PYTHON_MODEL_URL && process.env.MODEL_GATEWAY_SERVICE_KEY
  ? new ConversationTurnCoordinator(
    new HttpV2ConversationAgent(process.env.PYTHON_MODEL_URL, process.env.MODEL_GATEWAY_SERVICE_KEY, Number(process.env.PYTHON_MODEL_TIMEOUT_MS ?? 90_000)),
    // Explicit opt-in during calibrated evaluation; not safe to enable
    // automatically until live unsupported-claim and false-rejection gates pass.
    process.env.V2_GROUNDING_ENTAILMENT_MODE === 'enforce'
      ? new HttpV2GroundingVerifier(process.env.PYTHON_MODEL_URL, process.env.MODEL_GATEWAY_SERVICE_KEY, Number(process.env.V2_GROUNDING_TIMEOUT_MS ?? 10_000))
      : undefined,
  )
  : undefined;
const { app } = createApp({ store, cache, nodeEnv, ...(model ? { model } : {}), ...(summaryModel ? { summaryModel } : {}), ...(embedding ? { embedding } : {}), ...(v2Coordinator ? { v2Coordinator } : {}) });
const server = createServer(app);
const streamError = (code: string, message: string): Error & { code: string } => Object.assign(new Error(message), { code });
const streamResponse = (payload: unknown): Record<string, unknown> =>
  typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
const stream = attachChatStream(server, {
  ...(chatTurnQueue ? { queue: chatTurnQueue } : {}),
  allowedOrigins: new Set([process.env.WEB_ORIGIN ?? 'http://localhost', 'http://localhost', 'http://127.0.0.1']),
  authorize: async (sessionId, sessionToken, request) => {
    const session = await store.getSession(sessionId);
    if (!session) throw streamError('SESSION_NOT_FOUND', 'Session not found.');
    const valid = await store.verifySessionAccessToken(sessionId, createHash('sha256').update(sessionToken).digest('hex'));
    if (!valid) throw streamError('SESSION_TOKEN_INVALID', 'A valid session access token is required.');
    const tenant = await store.getTenant(session.tenantId);
    if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled) throw streamError('TENANT_UNAVAILABLE', 'This tenant is not accepting public chat.');
    const origin = request.headers.origin;
    if (tenant.publicOrigin && origin !== tenant.publicOrigin) throw streamError('CHAT_ORIGIN_FORBIDDEN', 'This chat channel is not authorized for the request origin.');
  },
  ...(chatTurnQueue ? {
    resolveTenantId: async (sessionId: string) => {
      const session = await store.getSession(sessionId);
      if (!session) throw streamError('SESSION_NOT_FOUND', 'Session not found.');
      return session.tenantId;
    },
    handleQueuedMessage: async (sessionId: string, sessionTokenHash: string, frame: ChatStreamMessageFrame, origin: string) => {
      const postMessage = async (): Promise<{ response: Response; payload: unknown }> => {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-agentic-session-token-hash': sessionTokenHash, 'x-agentic-internal-secret': process.env.CHAT_STREAM_INTERNAL_SECRET!, origin: origin || process.env.WEB_ORIGIN || 'http://localhost' },
          body: JSON.stringify({ sessionId, type: 'text', message: frame.message, clientMessageId: frame.clientMessageId, ...(frame.postbackValue ? { postbackValue: frame.postbackValue } : {}) }),
        });
        return { response, payload: await response.json().catch(() => null) };
      };
      let result = await postMessage();
      const firstError = typeof result.payload === 'object' && result.payload !== null && 'error' in result.payload ? result.payload.error : null;
      const firstErrorCode = typeof firstError === 'object' && firstError !== null && 'code' in firstError && typeof firstError.code === 'string' ? firstError.code : null;
      if (!result.response.ok && firstErrorCode === 'V2_STALE_SESSION') {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
        result = await postMessage();
      }
      const { response, payload } = result;
      if (!response.ok) {
        const error = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null;
        const errorRecord = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null;
        throw streamError(typeof errorRecord?.code === 'string' ? errorRecord.code : 'CHAT_REQUEST_FAILED', typeof errorRecord?.message === 'string' ? errorRecord.message : 'The conversation could not continue right now.');
      }
      const body = streamResponse(payload);
      return { ...(typeof body.answer === 'string' ? { answer: body.answer } : {}), response: body };
    },
  } : {}),
  handleMessage: async (sessionId, sessionToken, frame, request) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agentic-session-token': sessionToken, origin: request.headers.origin ?? process.env.WEB_ORIGIN ?? 'http://localhost' },
      body: JSON.stringify({ sessionId, type: 'text', message: frame.message, clientMessageId: frame.clientMessageId, ...(frame.postbackValue ? { postbackValue: frame.postbackValue } : {}) }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null;
      const errorRecord = typeof error === 'object' && error !== null ? error as Record<string, unknown> : null;
      const code = typeof errorRecord?.code === 'string' ? errorRecord.code : 'CHAT_REQUEST_FAILED';
      const message = typeof errorRecord?.message === 'string' ? errorRecord.message : 'The conversation could not continue right now. Please try again.';
      throw streamError(code, message);
    }
    const body = streamResponse(payload);
    const result: { answer?: string; response?: Record<string, unknown> } = {};
    if (typeof body.answer === 'string') result.answer = body.answer;
    result.response = body;
    return result;
  },
});
server.listen(port, '0.0.0.0', () => console.log(`agentic-rag-api listening on ${port}`));
let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const closeServer = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await Promise.allSettled([closeServer, stream.close(), cache.close(), pool?.end()]);
  process.exit(0);
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

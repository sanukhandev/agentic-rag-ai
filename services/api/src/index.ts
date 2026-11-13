import { createServer } from 'node:http';
import type { Express } from 'express';
import { NodeReadToolRegistry } from './conversation-core/read-tool-registry.js';
import { ExistingSessionTokenAuthorizer } from './conversation-core/adapters/session-authorizer.js';
import { PostgresConversationRepository } from './conversation-core/adapters/postgres-repository.js';
import { registerP3ReadTools } from './conversation-core/adapters/rag-read-tool.js';
import { ScopedP3ReadTools } from './conversation-core/adapters/read-tool-scope.js';
import { P4EvidenceSigner } from './conversation-core/adapters/evidence-receipt.js';
import { registerP4ReadRoute } from './conversation-core/adapters/p4-read-route.js';
import { EvidenceClaimVerifier } from './conversation-core/adapters/authorized-claim-verifier.js';
import { P5PinnedCatalogReader } from './conversation-core/adapters/p5-catalog.js';
import { createP5CandidateEngine } from './conversation-core/adapters/p5-candidate-factory.js';
import { SessionScopedPrivacyAdapter } from './conversation-core/adapters/privacy-adapter.js';
import { PostgresScopedPrivacyVault } from './conversation-core/adapters/p6-session-vault.js';
import { P6TrustedActionStateReader } from './conversation-core/adapters/p6-trusted-action-state.js';
import { registerP6CandidateRoute } from './conversation-core/adapters/p6-candidate-route.js';
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
let p4ReadGateway: ((app: Express) => void) | undefined;
let p6CandidateApi: ((app: Express) => void) | undefined;
const p6Enabled = process.env.P6_CANDIDATE_ENABLED === 'true';
if (p6Enabled && (
  process.env.P4_INTERNAL_READS_ENABLED !== 'true'
  || process.env.P4_GATEWAY_ENABLED !== 'true'
  || process.env.P5_CANDIDATE_ENABLED !== 'true')) {
  throw new Error('P6 requires P3/P4/P5 private reads; independent P6 claim verification is mandatory.');
}
if (process.env.P4_INTERNAL_READS_ENABLED === 'true') {
  if (!pool || !embedding) throw new Error('Private tool gateway requires PostgreSQL and configured embeddings.');
  const authorizer = new ExistingSessionTokenAuthorizer(store);
  const readOnlyRepository = new PostgresConversationRepository(pool, authorizer, {
    async assertSafeMaskedText(): Promise<void> { throw new Error('Private read gateway cannot persist data'); },
  });
  const registry = new NodeReadToolRegistry();
  registerP3ReadTools(registry, { repository: readOnlyRepository, store, embedding });
  const tools = new ScopedP3ReadTools(process.env.P4_READ_SCOPE_SECRET ?? '', readOnlyRepository, store, registry);
  const signer = new P4EvidenceSigner(process.env.P4_EVIDENCE_SIGNING_KEY ?? '');
  p4ReadGateway = (app: Express) => registerP4ReadRoute(app, tools, signer, process.env.MODEL_GATEWAY_SERVICE_KEY ?? '');

  if (p6Enabled) {
    if (!process.env.PYTHON_MODEL_URL || !process.env.MODEL_GATEWAY_SERVICE_KEY
      || !process.env.PII_VAULT_KEY) throw new Error('P6 requires private Python, gateway and PII vault credentials.');
    const allowedTenants = new Set((process.env.P6_CANARY_TENANT_IDS ?? '')
      .split(',').map(id => id.trim()).filter(Boolean));
    if (allowedTenants.size === 0 || [...allowedTenants].some(id =>
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id))) {
      throw new Error('P6 requires an explicit UUID tenant canary allowlist');
    }
    const vault = new PostgresScopedPrivacyVault(pool, authorizer, process.env.PII_VAULT_KEY);
    const privacy = new SessionScopedPrivacyAdapter(vault);
    const repository = new PostgresConversationRepository(pool, authorizer, privacy);
    const verifier = new EvidenceClaimVerifier(signer, store,
      new HttpV2GroundingVerifier(process.env.PYTHON_MODEL_URL, process.env.MODEL_GATEWAY_SERVICE_KEY));
    const engine = createP5CandidateEngine({
      repository, tools, verifier, privacy, catalogReader: new P5PinnedCatalogReader(store),
      actions: new P6TrustedActionStateReader(store, authorizer),
      pythonUrl: process.env.PYTHON_MODEL_URL, serviceKey: process.env.MODEL_GATEWAY_SERVICE_KEY,
    });
    p6CandidateApi = (app: Express) => registerP6CandidateRoute(app, {
      store, pool, engine, vault, allowedTenantIds: allowedTenants,
      sessionTtlMs: Number(process.env.CHAT_SESSION_TTL_MS ?? 600_000),
      nodeEnv, localOrigin: process.env.WEB_ORIGIN ?? 'http://localhost',
    });
  }
}
const { app } = createApp({ store, cache, nodeEnv, ...(model ? { model } : {}), ...(summaryModel ? { summaryModel } : {}), ...(embedding ? { embedding } : {}), ...(v2Coordinator ? { v2Coordinator } : {}), ...(p4ReadGateway ? { p4ReadGateway } : {}), ...(p6CandidateApi ? { p6CandidateApi } : {}) });
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

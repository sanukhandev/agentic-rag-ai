/** Single new-architecture composition root. No compatibility controller. */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { NodeReadToolRegistry } from './conversation-core/read-tool-registry.js';
import { ExistingSessionTokenAuthorizer } from './conversation-core/adapters/session-authorizer.js';
import { PostgresConversationRepository } from './conversation-core/adapters/postgres-repository.js';
import { registerP3ReadTools } from './conversation-core/adapters/rag-read-tool.js';
import { ScopedP3ReadTools } from './conversation-core/adapters/read-tool-scope.js';
import { P4EvidenceSigner } from './conversation-core/adapters/evidence-receipt.js';
import { registerP4ReadRoute } from './conversation-core/adapters/p4-read-route.js';
import { EvidenceClaimVerifier } from './conversation-core/adapters/authorized-claim-verifier.js';
import { PrivateGroundingReviewer } from './conversation-core/authorization/grounding.js';
import { P5PinnedCatalogReader } from './conversation-core/adapters/p5-catalog.js';
import { createP5CandidateEngine } from './conversation-core/adapters/p5-candidate-factory.js';
import { SessionScopedPrivacyAdapter } from './conversation-core/adapters/privacy-adapter.js';
import { PostgresScopedPrivacyVault } from './conversation-core/adapters/p6-session-vault.js';
import { SessionActionAuthorityReader } from './conversation-core/adapters/session-action-authority.js';
import { createConversationApp } from './conversation-core/http/public-app.js';
import { attachChatStream } from './chat-stream.js';
import { embeddingProviderFromEnv } from './embedding.js';
import { createCache } from './cache.js';
import { PostgresStore } from './store-postgres.js';

const env = process.env;
const port = Number(env.PORT ?? 4000);
const nodeEnv = env.NODE_ENV ?? 'development';
const origin = env.WEB_ORIGIN ?? 'http://localhost';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API port');
if (env.STORE !== 'postgres' || !env.DATABASE_URL) {
  throw new Error('The conversation architecture requires a PostgreSQL Store');
}
const required = [
  'PYTHON_MODEL_URL', 'MODEL_GATEWAY_SERVICE_KEY', 'P4_READ_SCOPE_SECRET',
  'P4_EVIDENCE_SIGNING_KEY', 'PII_VAULT_KEY', 'JWT_SECRET', 'CHANNEL_CREDENTIAL_KEY',
] as const;
for (const name of required) if (!env[name]) throw new Error(`Missing private server setting: ${name}`);

const gatewayUrl = env.PYTHON_MODEL_URL!;
const gatewayKey = env.MODEL_GATEWAY_SERVICE_KEY!;
const pool = new Pool({ connectionString: env.DATABASE_URL });
const store = new PostgresStore(pool);
const cache = createCache(env.REDIS_URL);
const embedding = embeddingProviderFromEnv();
if (!embedding) throw new Error('Private embedding configuration is required');

const authorizer = new ExistingSessionTokenAuthorizer(store);
const vault = new PostgresScopedPrivacyVault(pool, authorizer, env.PII_VAULT_KEY!);
const privacy = new SessionScopedPrivacyAdapter(vault);
const repository = new PostgresConversationRepository(pool, authorizer, privacy);
const readOnlyRepository = new PostgresConversationRepository(pool, authorizer, {
  async assertSafeMaskedText(): Promise<void> { throw new Error('Read tools may not mutate the conversation'); },
});
const registry = new NodeReadToolRegistry();
registerP3ReadTools(registry, { repository: readOnlyRepository, store, embedding });
const tools = new ScopedP3ReadTools(
  env.P4_READ_SCOPE_SECRET!, readOnlyRepository, store, registry,
);
const signer = new P4EvidenceSigner(env.P4_EVIDENCE_SIGNING_KEY!);
const verifier = new EvidenceClaimVerifier(
  signer, store, new PrivateGroundingReviewer(gatewayUrl, gatewayKey),
);
const engine = createP5CandidateEngine({
  repository, tools, verifier, privacy,
  catalogReader: new P5PinnedCatalogReader(store),
  actions: new SessionActionAuthorityReader(store, pool, authorizer),
  pythonUrl: gatewayUrl, serviceKey: gatewayKey,
});
const sessionTtlMs = Number(env.CHAT_SESSION_TTL_MS ?? 600_000);
const { app } = createConversationApp({
  store, cache, embedding, vault, nodeEnv, origin, sessionTtlMs,
  customerTurn: { pool, engine, sessionTtlMs },
  jwtSecret: env.JWT_SECRET!,
  vaultSecret: env.PII_VAULT_KEY!,
  channelSecret: env.CHANNEL_CREDENTIAL_KEY!,
  documentStorageRoot: env.PRIVATE_DOCUMENT_STORAGE_ROOT ?? '/app/data/documents',
  ingestionWorkerSecret: env.INGESTION_WORKER_SECRET ?? '',
});
registerP4ReadRoute(app, tools, signer, gatewayKey);

const server = createServer(app);
const stream = attachChatStream(server, {
  // Every socket is checked independently against the current session,
  // tenant status, token revocation and configured public origin.
  authorize: async (sessionId, token, request) => {
    const session = await store.getSession(sessionId);
    if (!session || session.closedAt !== null
      || !Number.isFinite(Date.parse(session.lastActivityAt))
      || Date.parse(session.lastActivityAt) + sessionTtlMs <= Date.now()
      || !await store.verifySessionAccessToken(sessionId, createHash('sha256').update(token).digest('hex'))) {
      throw new Error('CHAT_SESSION_UNAVAILABLE');
    }
    const tenant = await store.getTenant(session.tenantId);
    const actualOrigin = request.headers.origin;
    if (!tenant || tenant.status !== 'active' || !tenant.publicChatEnabled
      || !actualOrigin || actualOrigin !== (tenant.publicOrigin ?? (nodeEnv !== 'production' ? origin : null))) {
      throw new Error('CHAT_SESSION_UNAVAILABLE');
    }
  },
  handleMessage: async (sessionId, token, frame, request) => {
    // The WebSocket adapter does not own a dialogue planner or a second
    // persistence flow. It uses the same authenticated HTTP turn boundary.
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agentic-session-token': token,
        origin: request.headers.origin ?? origin,
      },
      body: JSON.stringify({
        sessionId, type: 'text', clientMessageId: frame.clientMessageId, message: frame.message,
      }),
    });
    const raw: unknown = await response.json().catch(() => null);
    if (!response.ok || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('CHAT_TURN_UNAVAILABLE');
    }
    const payload = raw as Record<string, unknown>;
    if (typeof payload.answer !== 'string') throw new Error('CHAT_TURN_UNAVAILABLE');
    return { answer: payload.answer, response: payload };
  },
});

server.listen(port, '0.0.0.0', () => {
  console.info(JSON.stringify({ event: 'conversation.ready', port, architecture: 'gpt-first' }));
});
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.allSettled([
    new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    stream.close(), cache.close(), pool.end(),
  ]);
  process.exit(0);
}
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

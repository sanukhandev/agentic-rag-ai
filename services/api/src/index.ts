import { Pool } from 'pg';
import { createApp } from './app.js';
import { AzureEmbeddingProvider } from './embedding.js';
import { pythonChatModelFromEnv } from './python-model/chat-model-adapter.js';
import { createCache } from './cache.js';
import { MemoryStore } from './store-memory.js';
import { PostgresStore } from './store-postgres.js';
import { assertConversationEngineV2Configuration, HttpV2ConversationAgent, V2ConversationCoordinator } from './v2-coordinator.js';
import { HttpV2GroundingVerifier } from './v2-grounding-verifier.js';

const port = Number(process.env.PORT ?? 4000);
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv === 'production' && (process.env.STORE !== 'postgres' || !process.env.DATABASE_URL)) throw new Error('Production requires STORE=postgres and DATABASE_URL.');
if (nodeEnv === 'production' && !process.env.REDIS_URL) throw new Error('Production requires REDIS_URL.');
assertConversationEngineV2Configuration(nodeEnv);
const pool = process.env.STORE === 'postgres' && process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
const store = pool ? new PostgresStore(pool) : new MemoryStore();
const cache = createCache(process.env.REDIS_URL);
const embedding = process.env.AZURE_AI_ENDPOINT && process.env.AZURE_AI_EMBEDDING_DEPLOYMENT && process.env.AZURE_AI_API_KEY && process.env.AZURE_AI_API_VERSION ? new AzureEmbeddingProvider(process.env.AZURE_AI_ENDPOINT, process.env.AZURE_AI_EMBEDDING_DEPLOYMENT, process.env.AZURE_AI_API_KEY, process.env.AZURE_AI_API_VERSION, Number(process.env.AZURE_AI_EMBEDDING_DIMENSION ?? 1536)) : undefined;
// Python V1 planning is an emergency rollback path only, not a parallel GPT planner.
const model = process.env.CONVERSATION_ENGINE_V2_ENABLED === 'false' ? pythonChatModelFromEnv() : undefined;
const v2Coordinator = process.env.CONVERSATION_ENGINE_V2_ENABLED !== 'false' && process.env.PYTHON_MODEL_URL && process.env.MODEL_GATEWAY_SERVICE_KEY
  ? new V2ConversationCoordinator(
    new HttpV2ConversationAgent(process.env.PYTHON_MODEL_URL, process.env.MODEL_GATEWAY_SERVICE_KEY, Number(process.env.PYTHON_MODEL_TIMEOUT_MS ?? 90_000)),
    // Explicit opt-in during calibrated evaluation; not safe to enable
    // automatically until live unsupported-claim and false-rejection gates pass.
    process.env.V2_GROUNDING_ENTAILMENT_MODE === 'enforce'
      ? new HttpV2GroundingVerifier(process.env.PYTHON_MODEL_URL, process.env.MODEL_GATEWAY_SERVICE_KEY, Number(process.env.V2_GROUNDING_TIMEOUT_MS ?? 10_000))
      : undefined,
  )
  : undefined;
const { app } = createApp({ store, cache, nodeEnv, ...(model ? { model } : {}), ...(embedding ? { embedding } : {}), ...(v2Coordinator ? { v2Coordinator } : {}) });
const server = app.listen(port, '0.0.0.0', () => console.log(`agentic-rag-api listening on ${port}`));
let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  const closeServer = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await Promise.allSettled([closeServer, cache.close(), pool?.end()]);
  process.exit(0);
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

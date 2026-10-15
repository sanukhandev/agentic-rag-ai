import { Pool } from 'pg';
import { createApp } from './app.js';
import { HttpN8nWorkflowAdapter } from './actions.js';
import { AzureEmbeddingProvider } from './embedding.js';
import { AzureFoundryModel } from './model.js';
import { MemoryStore } from './store-memory.js';
import { PostgresStore } from './store-postgres.js';

const port = Number(process.env.PORT ?? 4000);
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv === 'production' && (process.env.STORE !== 'postgres' || !process.env.DATABASE_URL)) throw new Error('Production requires STORE=postgres and DATABASE_URL.');
const store = process.env.STORE === 'postgres' && process.env.DATABASE_URL ? new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL })) : new MemoryStore();
const model = process.env.AZURE_AI_ENDPOINT && process.env.AZURE_AI_CHAT_DEPLOYMENT && process.env.AZURE_AI_API_KEY ? new AzureFoundryModel(process.env.AZURE_AI_ENDPOINT, process.env.AZURE_AI_CHAT_DEPLOYMENT, process.env.AZURE_AI_API_KEY, process.env.AZURE_AI_API_VERSION) : undefined;
const embedding = process.env.AZURE_AI_ENDPOINT && process.env.AZURE_AI_EMBEDDING_DEPLOYMENT && process.env.AZURE_AI_API_KEY && process.env.AZURE_AI_API_VERSION ? new AzureEmbeddingProvider(process.env.AZURE_AI_ENDPOINT, process.env.AZURE_AI_EMBEDDING_DEPLOYMENT, process.env.AZURE_AI_API_KEY, process.env.AZURE_AI_API_VERSION, Number(process.env.AZURE_AI_EMBEDDING_DIMENSION ?? 1536)) : undefined;
const workflow = process.env.N8N_INTERNAL_URL && process.env.N8N_WEBHOOK_SECRET ? new HttpN8nWorkflowAdapter(process.env.N8N_INTERNAL_URL, process.env.N8N_WEBHOOK_SECRET) : undefined;
const { app } = createApp({ store, nodeEnv, ...(model ? { model } : {}), ...(embedding ? { embedding } : {}), ...(workflow ? { workflow } : {}) });
app.listen(port, '0.0.0.0', () => console.log(`agentic-rag-api listening on ${port}`));

import { createDefaultApp } from './app.js';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { MemoryStore } from './store-memory.js';
import { PostgresStore } from './store-postgres.js';

const port = Number(process.env.PORT ?? 4000);
const store = process.env.STORE === 'postgres' && process.env.DATABASE_URL ? new PostgresStore(new Pool({ connectionString: process.env.DATABASE_URL })) : new MemoryStore();
const { app } = createApp({ store });
app.listen(port, '0.0.0.0', () => console.log(`agentic-rag-api listening on ${port}`));

import { Pool } from 'pg';
import { PostgresStore } from './store-postgres.js';
import { OutboxRelay, RedisStreamBus } from './event-bus.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error('DATABASE_URL and REDIS_URL are required for the event relay.');

const pool = new Pool({ connectionString: databaseUrl });
const store = new PostgresStore(pool);
const bus = new RedisStreamBus(redisUrl);
const relay = new OutboxRelay(store, bus);
let stopping = false;

const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([bus.close(), pool.end()]);
};

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

while (!stopping) {
  try { await relay.runOnce(); } catch (error) { console.error(JSON.stringify({ event: 'event_relay.error', message: error instanceof Error ? error.message : String(error) })); }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

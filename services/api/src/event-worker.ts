import { Pool } from 'pg';
import { EVENT_STREAMS } from './events.js';
import { EventConsumer, N8nEventBridge, RedisStreamBus } from './event-bus.js';
import { PostgresStore } from './store-postgres.js';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const n8nUrl = process.env.N8N_INTERNAL_URL;
const n8nSecret = process.env.N8N_WEBHOOK_SECRET;
if (!databaseUrl || !redisUrl || !n8nUrl || !n8nSecret) throw new Error('DATABASE_URL, REDIS_URL, N8N_INTERNAL_URL and N8N_WEBHOOK_SECRET are required for event workers.');

const pool = new Pool({ connectionString: databaseUrl });
const store = new PostgresStore(pool);
const bus = new RedisStreamBus(redisUrl);
const completionDeadlineMs = Number(process.env.N8N_COMPLETION_DEADLINE_MS ?? 15 * 60_000);
const bridge = new N8nEventBridge(store, n8nUrl, n8nSecret, 5_000, Number.isFinite(completionDeadlineMs) && completionDeadlineMs > 0 ? completionDeadlineMs : 15 * 60_000);
const consumer = new EventConsumer(store, bus, bridge);
const groups: Record<string, string> = { [EVENT_STREAMS.crm]: 'crm-workers', [EVENT_STREAMS.documents]: 'document-workers', [EVENT_STREAMS.actions]: 'intent-workers', [EVENT_STREAMS.notifications]: 'channel-workers' };
const configuredStreams = (process.env.EVENT_WORKER_STREAMS ?? Object.keys(groups).join(',')).split(',').map((value) => value.trim()).filter((value): value is keyof typeof groups => value in groups);
let stopping = false;
let lastExecutionRecoveryAt = 0;

const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([bus.close(), pool.end()]);
};

process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });

while (!stopping) {
  if (Date.now() - lastExecutionRecoveryAt >= 5_000) {
    lastExecutionRecoveryAt = Date.now();
    try { await store.reconcileExpiredActionExecutions(new Date().toISOString()); } catch (error) { console.error(JSON.stringify({ event: 'event_worker.execution_recovery_error', message: error instanceof Error ? error.message : String(error) })); }
  }
  await Promise.all(configuredStreams.map(async (stream) => {
    const group = groups[stream];
    if (!group) return;
    try { await consumer.runOnce(stream, group, 250); } catch (error) { console.error(JSON.stringify({ event: 'event_worker.error', stream, message: error instanceof Error ? error.message : String(error) })); }
  }));
}

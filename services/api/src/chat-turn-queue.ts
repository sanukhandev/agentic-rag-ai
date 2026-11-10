import { createClient } from 'redis';

export type ChatTurnEvent = { id?: string; tenantId: string; sessionId: string; type: 'turn.accepted' | 'assistant.message' | 'turn.completed' | 'turn.failed'; clientMessageId: string; answer?: string; response?: Record<string, unknown>; error?: Record<string, unknown> };
export type ChatTurnJob = { tenantId: string; sessionId: string; clientMessageId: string; sessionTokenHash: string; origin: string; message: string; postbackValue?: string };

export const chatTurnStreamKey = (tenantId: string, sessionId: string): string => `chat:events:v1:${tenantId}:${sessionId}`;
const jobStream = 'chat:turns:v1';
const serialize = (value: unknown): string => JSON.stringify(value);

export interface ChatTurnQueue {
  enqueue(job: ChatTurnJob): Promise<string>;
  publish(event: ChatTurnEvent): Promise<string>;
  replay(tenantId: string, sessionId: string, afterId?: string): Promise<ChatTurnEvent[]>;
  pending(): Promise<ChatTurnJob[]>;
  close(): Promise<void>;
  run(handler: (job: ChatTurnJob) => Promise<void>): Promise<() => Promise<void>>;
}

export class InMemoryChatTurnQueue implements ChatTurnQueue {
  private readonly jobs: ChatTurnJob[] = [];
  private readonly events = new Map<string, ChatTurnEvent[]>();
  private nextId = 1;

  async enqueue(job: ChatTurnJob): Promise<string> {
    const existing = this.jobs.find((candidate) => candidate.tenantId === job.tenantId && candidate.sessionId === job.sessionId && candidate.clientMessageId === job.clientMessageId);
    if (existing) return `${this.jobs.indexOf(existing) + 1}-0`;
    this.jobs.push(job);
    return `${this.jobs.length}-0`;
  }
  async publish(event: ChatTurnEvent): Promise<string> {
    const id = `${this.nextId++}-0`;
    const stream = chatTurnStreamKey(event.tenantId, event.sessionId);
    const list = this.events.get(stream) ?? [];
    list.push({ ...event, id });
    this.events.set(stream, list);
    return id;
  }
  async replay(tenantId: string, sessionId: string, afterId = '0-0'): Promise<ChatTurnEvent[]> {
    const events = this.events.get(chatTurnStreamKey(tenantId, sessionId)) ?? [];
    const cursor = Number.parseInt(afterId.split('-', 1)[0] ?? '0', 10);
    return events.filter((event) => Number.parseInt((event.id ?? '0-0').split('-', 1)[0] ?? '0', 10) > cursor);
  }
  async pending(): Promise<ChatTurnJob[]> { return [...this.jobs]; }
  async close(): Promise<void> {}
  async run(handler: (job: ChatTurnJob) => Promise<void>): Promise<() => Promise<void>> {
    const pending = [...this.jobs];
    this.jobs.length = 0;
    for (const job of pending) await handler(job);
    return async () => undefined;
  }
}

export class RedisChatTurnQueue implements ChatTurnQueue {
  private readonly client: ReturnType<typeof createClient>;
  private connection: Promise<void> | null = null;
  private readonly maxLength = Math.max(1_000, Number(process.env.REDIS_CHAT_STREAM_MAXLEN ?? 10_000));

  constructor(private readonly url: string) { this.client = createClient({ url }); this.client.on('error', () => undefined); }
  private async connect(): Promise<void> { if (this.client.isReady) return; if (!this.connection) this.connection = this.client.connect().then(() => undefined).finally(() => { this.connection = null; }); await this.connection; }
  async enqueue(job: ChatTurnJob): Promise<string> { await this.connect(); const existing = (await this.client.xRange(jobStream, '-', '+', { COUNT: this.maxLength })) ?? []; const duplicate = existing.find((entry) => entry.message.tenantId === job.tenantId && entry.message.sessionId === job.sessionId && entry.message.clientMessageId === job.clientMessageId); if (duplicate) return duplicate.id; return this.client.xAdd(jobStream, '*', job as unknown as Record<string, string>, { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: this.maxLength } }); }
  async publish(event: ChatTurnEvent): Promise<string> { await this.connect(); const stream = chatTurnStreamKey(event.tenantId, event.sessionId); const { id: _id, ...fields } = event; return this.client.xAdd(stream, '*', Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === 'string' ? value : serialize(value)])), { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: this.maxLength } }); }
  async replay(tenantId: string, sessionId: string, afterId = '0-0'): Promise<ChatTurnEvent[]> { await this.connect(); const stream = chatTurnStreamKey(tenantId, sessionId); const rows = (await this.client.xRange(stream, afterId === '0-0' ? '-' : `(${afterId}`, '+')) ?? []; return rows.map((row) => ({ id: row.id, tenantId: row.message.tenantId!, sessionId: row.message.sessionId!, type: row.message.type as ChatTurnEvent['type'], clientMessageId: row.message.clientMessageId!, ...(row.message.answer ? { answer: row.message.answer } : {}), ...(row.message.response ? { response: JSON.parse(row.message.response) as Record<string, unknown> } : {}), ...(row.message.error ? { error: JSON.parse(row.message.error) as Record<string, unknown> } : {}) })); }
  async pending(): Promise<ChatTurnJob[]> { await this.connect(); const rows = (await this.client.xRange(jobStream, '-', '+', { COUNT: this.maxLength })) ?? []; return rows.map((row) => ({ tenantId: row.message.tenantId!, sessionId: row.message.sessionId!, clientMessageId: row.message.clientMessageId!, sessionTokenHash: row.message.sessionTokenHash!, origin: row.message.origin!, message: row.message.message!, ...(row.message.postbackValue ? { postbackValue: row.message.postbackValue } : {}) })); }
  async run(handler: (job: ChatTurnJob) => Promise<void>): Promise<() => Promise<void>> { await this.connect(); const group = 'chat-turn-workers'; const consumer = `worker-${process.pid}`; try { await this.client.xGroupCreate(jobStream, group, '0-0', { MKSTREAM: true }); } catch (error) { if (!String(error).includes('BUSYGROUP')) throw error; } let running = true; const processRows = async (rows: Array<{ id: string; message: Record<string, string> }>): Promise<void> => { for (const row of rows) { const job = row.message as unknown as ChatTurnJob; try { await handler(job); await this.client.xAck(jobStream, group, row.id); } catch { /* leave the job pending for reclaim/retry */ } } }; const loop = async (): Promise<void> => { while (running) { const reclaimed = await this.client.xAutoClaim(jobStream, group, consumer, 30_000, '0-0', { COUNT: 10 }); await processRows((reclaimed.messages ?? []).filter((row): row is { id: string; message: Record<string, string> } => row !== null)); const rows = await this.client.xReadGroup(group, consumer, [{ key: jobStream, id: '>' }], { COUNT: 10, BLOCK: 1_000 }); for (const batch of rows ?? []) await processRows(batch.messages); } }; void loop(); return async () => { running = false; }; }
  async close(): Promise<void> { if (this.client.isOpen) await this.client.quit(); }
}

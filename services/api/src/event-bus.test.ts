import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { OutboxEvent } from './types.js';
import { createOutboxEvent } from './events.js';
import { EventConsumer, OutboxRelay, type StreamBus, type StreamMessage, N8nEventBridge } from './event-bus.js';
import { MemoryStore } from './store-memory.js';

class FakeBus implements StreamBus {
  readonly appended: OutboxEvent[] = [];
  readonly pending: StreamMessage[] = [];
  readonly acknowledged: string[] = [];
  readonly deadLetters: Array<{ event: OutboxEvent; reason: string }> = [];
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async ensureGroup(): Promise<void> {}
  async append(event: OutboxEvent): Promise<string> { this.appended.push(event); return String(this.appended.length); }
  async read(): Promise<StreamMessage[]> { const values = this.pending.splice(0); return values; }
  async reclaim(): Promise<StreamMessage[]> { return []; }
  async acknowledge(_stream: string, _group: string, messageId: string): Promise<void> { this.acknowledged.push(messageId); }
  async deadLetter(event: OutboxEvent, reason: string): Promise<void> { this.deadLetters.push({ event, reason }); }
}

describe('Redis event orchestration primitives', () => {
  it('publishes an outbox event once and leaves the durable row marked', async () => {
    const store = new MemoryStore();
    const bus = new FakeBus();
    await store.enqueueOutboxEvent(createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'session-ref', idempotencyKey: 'notify-1' }));
    const relay = new OutboxRelay(store, bus);
    expect(await relay.runOnce()).toBe(1);
    expect(await relay.runOnce()).toBe(0);
    expect(bus.appended).toHaveLength(1);
  });

  it('deduplicates a successfully handled stream event before acknowledgement', async () => {
    const store = new MemoryStore();
    const bus = new FakeBus();
    const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'session-ref', idempotencyKey: 'notify-2' });
    bus.pending.push({ id: '1-0', event }, { id: '1-1', event });
    const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, 'https://n8n.example', 'secret'));
    expect(await consumer.runOnce('rag:v2:notifications', 'channel-workers', 0)).toBe(1);
    expect(bus.acknowledged).toEqual(['1-0', '1-1']);
  });

  it('accepts an immediate webhook response while the workflow continues asynchronously', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    try {
      const store = new MemoryStore();
      const tenantId = randomUUID();
      const sessionId = randomUUID();
      const action = await store.createAction({ id: randomUUID(), tenantId, sessionId, workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', intentKey: 'lead.capture', state: 'processing', opaqueReference: 'opaque-async', idempotencyKey: 'async-response', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' } });
      await new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret', 1_000).dispatch(event);
      expect((await store.getAction(action.id))?.state).toBe('processing');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('reconciles and acknowledges a workflow rejection instead of leaving it processing', async () => {
    const server = createServer((_request, response) => { response.writeHead(500).end('workflow failed'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    try {
      const store = new MemoryStore();
      const bus = new FakeBus();
      const tenantId = randomUUID();
      const sessionId = randomUUID();
      const action = await store.createAction({ id: randomUUID(), tenantId, sessionId, workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', intentKey: 'lead.capture', intentScore: 80, intentConfidence: 0.9, catalogVersionId: null, idempotencyKey: 'reconcile-test', state: 'approved', opaqueReference: 'opaque-reconcile', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' } });
      bus.pending.push({ id: 'reconcile-1', event });
      const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret'));
      expect(await consumer.runOnce('rag:v2:actions', 'intent-workers', 0)).toBe(0);
      expect((await store.getAction(action.id))?.state).toBe('reconcile_required');
      expect(bus.acknowledged).toEqual(['reconcile-1']);
      expect(bus.deadLetters).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

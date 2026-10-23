import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { IntentCatalog, OutboxEvent } from './types.js';
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

class FailingBus extends FakeBus {
  async append(): Promise<string> { throw new Error('redis unavailable'); }
}

class DeadLetterUnavailableBus extends FailingBus {
  private failDeadLetter = true;
  async deadLetter(event: OutboxEvent, reason: string): Promise<void> { if (this.failDeadLetter) throw new Error('redis dlq unavailable'); await super.deadLetter(event, reason); }
  recoverDeadLetter(): void { this.failDeadLetter = false; }
}

class AcceptancePersistenceFailStore extends MemoryStore {
  async recordActionExecution(): Promise<never> { throw new Error('postgres unavailable after workflow acceptance'); }
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
      const accepted = await store.updateActionExecution({ actionId: action.id, tenantId, providerStatus: 'completed', n8nExecutionRef: 'execution-1' });
      expect(accepted).toMatchObject({ attempt: 1, providerStatus: 'completed' });
      expect(accepted?.deadlineAt).not.toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('retries a transient workflow rejection without acknowledging it', async () => {
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
      expect((await store.getAction(action.id))?.state).toBe('approved');
      expect(bus.acknowledged).toEqual([]);
      expect(bus.deadLetters).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('resolves the active catalog workflow identity for n8n dispatch', async () => {
    let received = '';
    const server = createServer(async (request, response) => {
      for await (const chunk of request) received += chunk.toString();
      response.writeHead(202).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    try {
      const store = new MemoryStore();
      const tenantId = randomUUID();
      const sessionId = randomUUID();
      const workflowKey = 'crm.lead.create';
      const n8nWorkflowId = 'catalog-workflow-1';
      const catalog: IntentCatalog = { tenantScope: null, intents: [], signals: [], slots: [], relations: [], workflowBindings: [{ workflowKey, n8nWorkflowId, webhookPath: 'catalog-lead', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }] };
      const version = await store.createIntentCatalogVersion({ tenantId, status: 'draft', sourceFileName: 'test.json', sourceHash: 'hash', parserVersion: 'test', catalog });
      const action = await store.createAction({ id: randomUUID(), tenantId, sessionId, workflowKey, webhookPath: 'legacy-lead', intentKey: 'lead.capture', catalogVersionId: version.id, state: 'processing', opaqueReference: 'opaque-catalog', idempotencyKey: 'catalog-route', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, sessionId, actionId: action.id, aggregateId: action.id, workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId, workflowKey, webhookPath: action.webhookPath ?? 'legacy-lead' } });
      await new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret').dispatch(event);
      expect(JSON.parse(received)).toMatchObject({ webhookPath: 'catalog-lead', workflowKey, n8nWorkflowId, contract: 'crm-lead-v1' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('marks an action failed after bounded transient retries', async () => {
    const server = createServer((_request, response) => { response.writeHead(500).end('workflow failed'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    try {
      const store = new MemoryStore();
      const bus = new FakeBus();
      const tenantId = randomUUID();
      const sessionId = randomUUID();
      const action = await store.createAction({ id: randomUUID(), tenantId, sessionId, workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', intentKey: 'lead.capture', state: 'approved', opaqueReference: 'opaque-failed', idempotencyKey: 'failed-action', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' } });
      bus.pending.push({ id: 'failed-1', event });
      const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret'), 'test-worker', 1);
      expect(await consumer.runOnce('rag:v2:actions', 'intent-workers', 0)).toBe(0);
      expect((await store.getAction(action.id))?.state).toBe('failed');
      expect(bus.acknowledged).toEqual(['failed-1']);
      expect(bus.deadLetters).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('keeps an active inbox lease exclusive and recovers an expired retry', async () => {
    const store = new MemoryStore();
    const consumer = 'intent-workers';
    const eventId = randomUUID();
    expect((await store.claimInboxEvent(consumer, eventId, 60_000)).claimed).toBe(true);
    expect((await store.claimInboxEvent(consumer, eventId, 60_000)).claimed).toBe(false);
    await store.scheduleInboxRetry(consumer, eventId, 'temporary', new Date(Date.now() - 1).toISOString());
    const recovered = await store.claimInboxEvent(consumer, eventId, 60_000);
    expect(recovered).toMatchObject({ claimed: true, state: 'processing', attempts: 2 });
    await store.completeInboxEvent(consumer, eventId);
    expect((await store.claimInboxEvent(consumer, eventId, 60_000)).claimed).toBe(false);
  });

  it('does not acknowledge a duplicate while another consumer still owns its lease', async () => {
    const store = new MemoryStore();
    const bus = new FakeBus();
    const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'session-ref', idempotencyKey: 'leased-duplicate' });
    await store.claimInboxEvent('channel-workers', event.eventId, 60_000);
    bus.pending.push({ id: 'leased-duplicate-1', event });
    const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, 'https://n8n.example', 'secret'));
    expect(await consumer.runOnce('rag:v2:notifications', 'channel-workers', 0)).toBe(0);
    expect(bus.acknowledged).toEqual([]);
  });

  it('dead-letters an outbox event after bounded publish attempts', async () => {
    const store = new MemoryStore();
    const bus = new FailingBus();
    await store.enqueueOutboxEvent(createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'session-ref', idempotencyKey: 'notify-dead-letter' }));
    const relay = new OutboxRelay(store, bus, 0, 1);
    expect(await relay.runOnce()).toBe(0);
    expect(bus.deadLetters).toHaveLength(1);
    expect(await relay.runOnce()).toBe(0);
    expect(bus.deadLetters).toHaveLength(1);
  });

  it('keeps the durable dead-letter state when Redis DLQ publication is unavailable', async () => {
    const store = new MemoryStore();
    const bus = new DeadLetterUnavailableBus();
    await store.enqueueOutboxEvent(createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'session-ref', idempotencyKey: 'notify-dlq-retry' }));
    const relay = new OutboxRelay(store, bus, 0, 1);
    expect(await relay.runOnce()).toBe(0);
    expect(bus.deadLetters).toHaveLength(0);
    bus.recoverDeadLetter();
    expect(await relay.runOnce()).toBe(0);
    expect(bus.deadLetters).toHaveLength(1);
  });

  it('moves accepted-workflow persistence failures to reconciliation', async () => {
    const server = createServer((_request, response) => { response.writeHead(202).end(); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    try {
      const store = new AcceptancePersistenceFailStore();
      const tenantId = randomUUID();
      const sessionId = randomUUID();
      const action = await store.createAction({ id: randomUUID(), tenantId, sessionId, workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', intentKey: 'lead.capture', state: 'approved', opaqueReference: 'opaque-accepted', idempotencyKey: 'accepted-persistence', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' } });
      await expect(new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret').dispatch(event)).rejects.toThrow('reconciliation is required');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('moves an unavailable workflow route to reconciliation and acknowledges it', async () => {
    const server = createServer((_request, response) => { response.writeHead(404).end('missing'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    try {
      const store = new MemoryStore();
      const bus = new FakeBus();
      const tenantId = randomUUID();
      const sessionId = randomUUID();
      const action = await store.createAction({ id: randomUUID(), tenantId, sessionId, workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', intentKey: 'lead.capture', state: 'approved', opaqueReference: 'opaque-missing-route', idempotencyKey: 'missing-route', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, sessionId, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id, sessionId, workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' } });
      bus.pending.push({ id: 'missing-route-1', event });
      const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret'));
      expect(await consumer.runOnce('rag:v2:actions', 'intent-workers', 0)).toBe(0);
      expect((await store.getAction(action.id))?.state).toBe('reconcile_required');
      expect(bus.acknowledged).toEqual(['missing-route-1']);
      expect(bus.deadLetters).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});

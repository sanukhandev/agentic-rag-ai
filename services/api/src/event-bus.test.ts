import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { OutboxEvent } from './types.js';
import { createOutboxEvent } from './events.js';
import { EventConsumer, OutboxRelay, type StreamBus, type StreamMessage, N8nEventBridge } from './event-bus.js';
import { MemoryStore } from './store-memory.js';

class FakeBus implements StreamBus {
  readonly appended: OutboxEvent[] = [];
  readonly pending: StreamMessage[] = [];
  readonly acknowledged: string[] = [];
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async ensureGroup(): Promise<void> {}
  async append(event: OutboxEvent): Promise<string> { this.appended.push(event); return String(this.appended.length); }
  async read(): Promise<StreamMessage[]> { const values = this.pending.splice(0); return values; }
  async reclaim(): Promise<StreamMessage[]> { return []; }
  async acknowledge(_stream: string, _group: string, messageId: string): Promise<void> { this.acknowledged.push(messageId); }
  async deadLetter(): Promise<void> {}
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
});

import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import { createOutboxEvent } from './events.js';
import { RedisStreamBus } from './event-bus.js';

describe.skipIf(!process.env.REDIS_URL)('Redis Streams integration', () => {
  it('replays an event published before group creation and acknowledges it once', async () => {
    const stream = 'rag:v2:notifications';
    const group = `integration-${randomUUID()}`;
    const consumer = `consumer-${randomUUID()}`;
    const bus = new RedisStreamBus(process.env.REDIS_URL!);
    const cleanup = createClient({ url: process.env.REDIS_URL! });
    const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'integration-ref', idempotencyKey: `integration-${randomUUID()}` });
    let messageId: string | null = null;
    try {
      await bus.append(event);
      await bus.ensureGroup(stream, group);
      const messages = await bus.read(stream, group, consumer, 1, 100);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.event.eventId).toBe(event.eventId);
      messageId = messages[0]?.id ?? null;
      await bus.acknowledge(stream, group, messageId!);
      expect(await bus.read(stream, group, consumer, 1, 1)).toHaveLength(0);
    } finally {
      await bus.close();
      await cleanup.connect();
      await cleanup.xGroupDestroy(stream, group).catch(() => undefined);
      if (messageId) await cleanup.xDel(stream, messageId);
      await cleanup.quit();
    }
  }, 20_000);
});

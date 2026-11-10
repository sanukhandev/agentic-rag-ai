import { describe, expect, it } from 'vitest';
import { InMemoryChatTurnQueue, chatTurnStreamKey } from './chat-turn-queue.js';

describe('chat turn queue', () => {
  it('keeps turn jobs tenant/session scoped and replays events after a cursor', async () => {
    const queue = new InMemoryChatTurnQueue();
    expect(chatTurnStreamKey('tenant-a', 'session-a')).toBe('chat:events:v1:tenant-a:session-a');
    await queue.publish({ tenantId: 'tenant-a', sessionId: 'session-a', type: 'turn.accepted', clientMessageId: 'm-1' });
    await queue.publish({ tenantId: 'tenant-a', sessionId: 'session-a', type: 'assistant.message', clientMessageId: 'm-1', answer: 'Hello' });
    const events = await queue.replay('tenant-a', 'session-a', '0-0');
    expect(events).toHaveLength(2);
    expect((await queue.replay('tenant-a', 'session-b', '0-0'))).toEqual([]);
    expect((await queue.replay('tenant-a', 'session-a', events[0]?.id ?? '0-0'))).toHaveLength(1);
  });

  it('deduplicates a queued client message', async () => {
    const queue = new InMemoryChatTurnQueue();
    const first = await queue.enqueue({ tenantId: 'tenant-a', sessionId: 'session-a', clientMessageId: 'm-1', sessionTokenHash: 'hash', origin: 'http://localhost', message: 'Hello' });
    const second = await queue.enqueue({ tenantId: 'tenant-a', sessionId: 'session-a', clientMessageId: 'm-1', sessionTokenHash: 'hash', origin: 'http://localhost', message: 'Hello' });
    expect(second).toEqual(first);
    expect(await queue.pending()).toHaveLength(1);
  });
});

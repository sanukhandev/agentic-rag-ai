import { describe, expect, it } from 'vitest';
import { parseChatStreamFrame, retryableStreamError } from './chat-stream.js';

describe('chat stream protocol', () => {
  it('accepts a bounded customer message frame', () => {
    expect(parseChatStreamFrame(JSON.stringify({ type: 'message', clientMessageId: 'client-12345678', message: 'Hello' }))).toEqual({
      type: 'message', clientMessageId: 'client-12345678', message: 'Hello',
    });
  });

  it('rejects frames without a bounded message identifier', () => {
    expect(() => parseChatStreamFrame(JSON.stringify({ type: 'message', clientMessageId: 'x', message: 'Hello' }))).toThrow();
  });

  it('turns queue overload into a safe retry event', () => {
    expect(retryableStreamError('MODEL_QUEUE_OVERLOADED')).toEqual({
      code: 'MODEL_QUEUE_OVERLOADED',
      message: 'Conversation volume is high right now. Please ask your question again in a moment.',
      retryable: true,
    });
  });
});

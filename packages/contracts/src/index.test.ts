import { describe, expect, it } from 'vitest';
import { chatMessageRequestSchema, citationSchema } from './index.js';

describe('shared contracts', () => {
  it('rejects oversized or empty chat messages and accepts a valid citation', () => {
    expect(chatMessageRequestSchema.safeParse({ sessionId: 'not-a-uuid', message: '', clientMessageId: '' }).success).toBe(false);
    expect(citationSchema.safeParse({ sourceId: 'not-a-uuid' }).success).toBe(false);
  });
});

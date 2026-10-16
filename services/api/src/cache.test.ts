import { describe, expect, it } from 'vitest';
import { MemoryCache, cacheKey } from './cache.js';

describe('cache primitives', () => {
  it('provides bounded LRU semantics and expires entries', async () => {
    const cache = new MemoryCache(2);
    await cache.set('a', { value: 1 }, 10);
    await cache.set('b', { value: 2 }, 10);
    await expect(cache.get('a')).resolves.toEqual({ value: 1 });
    await cache.set('c', { value: 3 }, 10);
    await expect(cache.get('b')).resolves.toBeNull();
    await expect(cache.get('c')).resolves.toEqual({ value: 3 });
    await cache.set('expired', 'value', 0);
    await expect(cache.get('expired')).resolves.toBeNull();
  });

  it('namespaces and encodes composite keys', () => {
    expect(cacheKey('chat-response', 'tenant/a', 'message id')).toBe('agentic:chat-response:tenant%2Fa:message%20id');
  });
});

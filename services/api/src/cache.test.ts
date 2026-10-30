import { describe, expect, it } from 'vitest';
import { MemoryCache, Singleflight, cacheKey } from './cache.js';

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

  it('invalidates only the requested tenant scope', async () => {
    const cache = new MemoryCache();
    await cache.set('agentic:tenant:tenant-a:answer', 'a', 10);
    await cache.set('agentic:tenant:tenant-b:answer', 'b', 10);
    await cache.invalidate('agentic:tenant:tenant-a');
    await expect(cache.get('agentic:tenant:tenant-a:answer')).resolves.toBeNull();
    await expect(cache.get('agentic:tenant:tenant-b:answer')).resolves.toBe('b');
  });

  it('coalesces concurrent work for one cache key', async () => {
    const flights = new Singleflight();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const work = () => flights.run('same-key', async () => { calls += 1; await gate; return 'value'; });
    const first = work();
    const second = work();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual(['value', 'value']);
    expect(calls).toBe(1);
  });

});

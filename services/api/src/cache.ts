import { createClient } from 'redis';

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  invalidate(prefix: string): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

type Entry = { value: unknown; expiresAt: number };

const ttlMs = (ttlSeconds: number): number => Number.isFinite(ttlSeconds) ? Math.max(0, Math.floor(ttlSeconds * 1000)) : 0;

export const cacheKey = (...parts: string[]): string => `agentic:${parts.map((part) => encodeURIComponent(part)).join(':')}`;

export class Singleflight {
  private readonly pending = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;
    const current = Promise.resolve().then(work);
    this.pending.set(key, current);
    try { return await current; } finally { if (this.pending.get(key) === current) this.pending.delete(key); }
  }
}

export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly maxEntries = 2_048) { if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error('Cache maxEntries must be a positive integer.'); }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs(ttlSeconds);
    if (expiresAt <= Date.now()) return;
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> { this.entries.delete(key); }

  async invalidate(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  async ping(): Promise<boolean> { return true; }

  async close(): Promise<void> { this.entries.clear(); }
}

export class RedisCache implements CacheStore {
  private readonly client: ReturnType<typeof createClient>;
  private readonly fallback = new MemoryCache();
  private connection: Promise<boolean> | null = null;
  private retryAfter = 0;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', () => undefined);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!(await this.ensureConnected())) return this.fallback.get<T>(key);
    try {
      const value = await this.client.get(key);
      if (value === null) {
        await this.fallback.delete(key);
        return null;
      }
      try {
        const parsed = JSON.parse(value) as T;
        await this.fallback.set(key, parsed, 5);
        return parsed;
      } catch {
        await this.client.del(key);
        await this.fallback.delete(key);
        return null;
      }
    } catch {
      this.markUnavailable();
      return this.fallback.get<T>(key);
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (ttlMs(ttlSeconds) === 0) { await this.delete(key); return; }
    if (!(await this.ensureConnected())) {
      await this.fallback.set(key, value, Math.min(ttlSeconds, 5));
      return;
    }
    try {
      await this.client.set(key, JSON.stringify(value), { EX: Math.max(1, Math.floor(ttlSeconds)) });
      await this.fallback.set(key, value, Math.min(ttlSeconds, 5));
    } catch {
      this.markUnavailable();
      await this.fallback.set(key, value, Math.min(ttlSeconds, 5));
    }
  }

  async delete(key: string): Promise<void> {
    await this.fallback.delete(key);
    if (!(await this.ensureConnected())) return;
    try { await this.client.del(key); } catch { this.markUnavailable(); }
  }

  async invalidate(prefix: string): Promise<void> {
    await this.fallback.invalidate(prefix);
    if (!(await this.ensureConnected())) return;
    try {
      const keys: string[] = [];
      for await (const batch of this.client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) keys.push(...batch);
      for (const key of keys) await this.client.del(key);
    } catch { this.markUnavailable(); }
  }

  async ping(): Promise<boolean> {
    if (!(await this.ensureConnected())) return false;
    try { return (await this.client.ping()) === 'PONG'; } catch { this.markUnavailable(); return false; }
  }

  async close(): Promise<void> {
    await this.fallback.close();
    if (this.client.isOpen) {
      try { await this.client.quit(); } catch { this.client.disconnect(); }
    }
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.client.isReady) return true;
    if (Date.now() < this.retryAfter) return false;
    if (!this.connection) {
      this.connection = this.client.connect().then(() => true).catch(() => { this.markUnavailable(); return false; }).finally(() => { this.connection = null; });
    }
    return this.connection;
  }

  private markUnavailable(): void { this.retryAfter = Date.now() + 5_000; }
}

export const createCache = (redisUrl?: string): CacheStore => redisUrl ? new RedisCache(redisUrl) : new MemoryCache();

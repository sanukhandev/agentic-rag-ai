import type { Express } from 'express';
import type { CacheStore } from '../cache.js';
import type { Store } from '../types.js';

export const registerHealthRoutes = (app: Express, dependencies: { store: Store; cache: CacheStore }): void => {
  app.get('/api/v1/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      await dependencies.store.countUsers();
      res.json({ status: 'ready', store: 'available', cache: (await dependencies.cache.ping()) ? 'available' : 'degraded' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  });
};

import type { Express, RequestHandler } from 'express';
import type { AuthService, AuthedRequest } from '../auth.js';
import { HttpError, parse } from '../http/errors.js';
import type { Store, User } from '../types.js';
import { z } from 'zod';

const platformRegistrationSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/\d/, 'Password must contain a number.') });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

type PublicUser = (user: User) => { id: string; email: string; role: string; tenantId: string | null };

export const registerAuthRoutes = (app: Express, dependencies: {
  store: Store;
  auth: AuthService;
  nodeEnv: string;
  protectedApi: RequestHandler;
  publicUser: PublicUser;
}): void => {
  app.post('/api/v1/auth/register-platform', async (req, res, next) => {
    try {
      if (dependencies.nodeEnv === 'production') throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      if (await dependencies.store.countUsers() > 0) throw new HttpError(409, 'BOOTSTRAP_COMPLETE', 'Platform bootstrap is already complete.');
      const input = parse(platformRegistrationSchema, req.body);
      const user = await dependencies.store.createUser({ email: input.email, passwordHash: await dependencies.auth.hashPassword(input.password), role: 'platform_admin', tenantId: null });
      res.status(201).json({ token: await dependencies.auth.issue(user), user: dependencies.publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/login', async (req, res, next) => {
    try {
      const input = parse(loginSchema, req.body);
      const user = await dependencies.store.getUserByEmail(input.email);
      if (!user || !(await dependencies.auth.verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
      res.json({ token: await dependencies.auth.issue(user), user: dependencies.publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/logout', dependencies.protectedApi, async (req, res) => {
    const token = req.header('authorization')?.slice(7);
    if (token) await dependencies.auth.revoke(token);
    res.status(204).send();
  });

  app.get('/api/v1/auth/me', dependencies.protectedApi, (req, res) => {
    const current = (req as AuthedRequest).auth;
    if (!current) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
      return;
    }
    res.json({ user: current });
  });
};

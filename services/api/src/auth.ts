import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { cacheKey, MemoryCache, type CacheStore } from './cache.js';
import type { Role, Store, User } from './types.js';

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

export type AuthedRequest = Request & { auth?: AuthContext; requestId?: string };
type CachedAuthSession = { userId: string; expiresAt: string };

const userToContext = (user: User): AuthContext => ({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId });

export class AuthService {
  constructor(private readonly store: Store, private readonly secret: string, private readonly cache: CacheStore = new MemoryCache(), private readonly cacheTtlSeconds = 10) {}

  async hashPassword(password: string): Promise<string> { return bcrypt.hash(password, 12); }
  async verifyPassword(password: string, passwordHash: string): Promise<boolean> { return bcrypt.compare(password, passwordHash); }

  async issue(user: User): Promise<string> {
    const token = jwt.sign(userToContext(user), this.secret, { expiresIn: '2h', issuer: 'agentic-rag-api' });
    const session = { tokenHash: this.hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), revokedAt: null };
    await this.store.createAuthSession(session);
    await this.cache.set(this.sessionCacheKey(token), { userId: session.userId, expiresAt: session.expiresAt }, this.cacheTtl(session.expiresAt));
    return token;
  }

  async revoke(token: string): Promise<void> { await this.store.revokeAuthSession(this.hashToken(token)); await this.cache.delete(this.sessionCacheKey(token)); }

  async verify(token: string): Promise<AuthContext | null> {
    try {
      const decoded = jwt.verify(token, this.secret, { issuer: 'agentic-rag-api' });
      if (!decoded || typeof decoded === 'string') return null;
      const payload = decoded as jwt.JwtPayload & Partial<AuthContext>;
      if (typeof payload.userId !== 'string' || typeof payload.email !== 'string' || typeof payload.role !== 'string') return null;
      const cached = await this.cache.get<CachedAuthSession>(this.sessionCacheKey(token));
      const session = cached ? { ...cached, tokenHash: this.hashToken(token), revokedAt: null } : await this.store.getAuthSession(this.hashToken(token));
      if (!session || session.userId !== payload.userId || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
      const user = await this.store.getUser(payload.userId);
      if (user && !cached) await this.cache.set(this.sessionCacheKey(token), { userId: session.userId, expiresAt: session.expiresAt }, this.cacheTtl(session.expiresAt));
      return user ? userToContext(user) : null;
    } catch {
      return null;
    }
  }

  private cacheTtl(expiresAt: string): number { return Math.max(0, Math.min(this.cacheTtlSeconds, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000))); }
  private sessionCacheKey(token: string): string { return cacheKey('auth-session', this.hashToken(token)); }
  private hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
}

export const authMiddleware = (authService: AuthService, required = true) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const context = token ? await authService.verify(token) : null;
  if (context) (req as AuthedRequest).auth = context;
  if (required && !context) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }); return; }
  next();
};

export const requireRoles = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction): void => {
  const context = (req as AuthedRequest).auth;
  if (!context || !roles.includes(context.role)) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } }); return; }
  next();
};

export const ensureTenant = (req: Request, tenantId: string): boolean => {
  const context = (req as AuthedRequest).auth;
  return Boolean(context?.role === 'platform_admin' || context?.tenantId === tenantId);
};

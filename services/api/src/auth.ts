import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { Role, Store, User } from './types.js';

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  tenantId: string | null;
}

export type AuthedRequest = Request & { auth?: AuthContext; requestId?: string };

const userToContext = (user: User): AuthContext => ({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId });

export class AuthService {
  constructor(private readonly store: Store, private readonly secret: string) {}

  async hashPassword(password: string): Promise<string> { return bcrypt.hash(password, 12); }
  async verifyPassword(password: string, passwordHash: string): Promise<boolean> { return bcrypt.compare(password, passwordHash); }

  issue(user: User): string { return jwt.sign(userToContext(user), this.secret, { expiresIn: '2h', issuer: 'agentic-rag-api' }); }

  async verify(token: string): Promise<AuthContext | null> {
    try {
      const decoded = jwt.verify(token, this.secret, { issuer: 'agentic-rag-api' });
      if (!decoded || typeof decoded === 'string') return null;
      const payload = decoded as jwt.JwtPayload & Partial<AuthContext>;
      if (typeof payload.userId !== 'string' || typeof payload.email !== 'string' || typeof payload.role !== 'string') return null;
      const user = await this.store.getUser(payload.userId);
      return user ? userToContext(user) : null;
    } catch {
      return null;
    }
  }
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

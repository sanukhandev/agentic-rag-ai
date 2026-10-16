import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.js';
import { MemoryStore } from './store-memory.js';

class CountingStore extends MemoryStore {
  authSessionReads = 0;

  override async getAuthSession(tokenHash: string) {
    this.authSessionReads += 1;
    return super.getAuthSession(tokenHash);
  }
}

describe('development auth boundary', () => {
  it('issues, verifies and revokes a user-backed token', async () => {
    const store = new MemoryStore();
    const auth = new AuthService(store, 'test-jwt-secret');
    const user = await store.createUser({ email: 'Admin@Example.test', passwordHash: await auth.hashPassword('Password1'), role: 'tenant_admin', tenantId: 'tenant-a' });
    expect(await auth.verifyPassword('Password1', user.passwordHash)).toBe(true);
    expect(await auth.verifyPassword('wrong', user.passwordHash)).toBe(false);
    const token = await auth.issue(user);
    await expect(auth.verify(token)).resolves.toMatchObject({ userId: user.id, email: 'admin@example.test', role: 'tenant_admin', tenantId: 'tenant-a' });
    await auth.revoke(token);
    await expect(auth.verify(token)).resolves.toBeNull();
  });

  it('rejects a token whose durable session has expired', async () => {
    const store = new MemoryStore();
    const secret = 'test-jwt-secret';
    const auth = new AuthService(store, secret);
    const user = await store.createUser({ email: 'expired@example.test', passwordHash: 'hash', role: 'tenant_admin', tenantId: 'tenant-a' });
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId }, secret, { expiresIn: '2h', issuer: 'agentic-rag-api' });
    await store.createAuthSession({ tokenHash: createHash('sha256').update(token).digest('hex'), userId: user.id, expiresAt: new Date(Date.now() - 1).toISOString(), revokedAt: null });
    await expect(auth.verify(token)).resolves.toBeNull();
  });

  it('checks the durable session on every request and invalidates it on logout', async () => {
    const store = new CountingStore();
    const auth = new AuthService(store, 'test-jwt-secret');
    const user = await store.createUser({ email: 'cached@example.test', passwordHash: 'hash', role: 'tenant_admin', tenantId: 'tenant-a' });
    const token = await auth.issue(user);

    await expect(auth.verify(token)).resolves.toMatchObject({ userId: user.id });
    await expect(auth.verify(token)).resolves.toMatchObject({ userId: user.id });
    expect(store.authSessionReads).toBe(2);

    await auth.revoke(token);
    await expect(auth.verify(token)).resolves.toBeNull();
    expect(store.authSessionReads).toBe(3);
  });

  it('issues unique sessions for rapid repeated logins', async () => {
    const store = new MemoryStore();
    const auth = new AuthService(store, 'test-jwt-secret');
    const user = await store.createUser({ email: 'rapid@example.test', passwordHash: 'hash', role: 'platform_admin', tenantId: null });

    const first = await auth.issue(user);
    const second = await auth.issue(user);

    expect(second).not.toBe(first);
    await expect(auth.verify(first)).resolves.toMatchObject({ userId: user.id });
    await expect(auth.verify(second)).resolves.toMatchObject({ userId: user.id });
  });
});

import { describe, expect, it } from 'vitest';
import { AuthService } from './auth.js';
import { MemoryStore } from './store-memory.js';

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
});

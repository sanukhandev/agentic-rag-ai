import { describe, expect, it } from 'vitest';
import { customerActorFromSessionToken, ExistingSessionTokenAuthorizer } from '../adapters/session-authorizer.js';

const tenantId = 'tenant-1';
const sessionId = 'session-1';
const token = 'a-secret-bearer';
const actor = customerActorFromSessionToken({ tenantId, sessionId, sessionAccessToken: token });

const session = {
  tenantId, sessionId, tenantStatus: 'active', closedAt: null,
};

describe('P2 customer-session authentication boundary', () => {
  it('converts raw session token to a nonreversible hash', () => {
    expect(actor.principalId).not.toContain(token);
    expect(actor.principalId).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('authorizes the known session only when the existing Store confirms the token', async () => {
    const checked: string[] = [];
    const authorizer = new ExistingSessionTokenAuthorizer({
      async verifySessionAccessToken(id, hash) { checked.push(id); return id === sessionId && hash === actor.principalId; },
    });
    await expect(authorizer.assertAuthorized(actor, session)).resolves.toBeUndefined();
    expect(checked).toEqual([sessionId]);
  });

  it('rejects revoked token, tenant swap, closed session and fabricated admin authority', async () => {
    const authorizer = new ExistingSessionTokenAuthorizer({ async verifySessionAccessToken() { return false; } });
    await expect(authorizer.assertAuthorized(actor, session)).rejects.toThrow('Unauthorized');
    await expect(authorizer.assertAuthorized(actor, { ...session, tenantId: 'different' })).rejects.toThrow('Unauthorized');
    await expect(authorizer.assertAuthorized(actor, { ...session, closedAt: '2026-01-01' })).rejects.toThrow('Unauthorized');
    await expect(authorizer.assertAuthorized({ ...actor, role: 'platform_admin' }, session)).rejects.toThrow('Unauthorized');
  });
});

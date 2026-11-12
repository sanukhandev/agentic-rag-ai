import { describe, expect, it } from 'vitest';
import { PostgresScopedPrivacyVault, P6PrivacyError } from '../adapters/p6-session-vault.js';
import type { SqlPool, SqlClient } from '../adapters/postgres-repository.js';
import type { SessionAuthorizer } from '../adapters/session-authorizer.js';
import type { TrustedActor } from '../contracts.js';

const tenant = 'tenant-1';
const sessionId = 'session-1';
const actor: TrustedActor = {
  tenantId: tenant, sessionId, principalId: 'f'.repeat(64), role: 'customer',
};
const KEY = 'p6-valid-encryption-key-of-at-least-32-bytes';
const store = new Map<string, string>();

function pool(): SqlPool {
  return {
    async connect(): Promise<SqlClient> {
      return {
        async query(sql: string, values: unknown[] = []) {
          if (/^BEGIN|^COMMIT|^ROLLBACK/u.test(sql)) return { rows: [], rowCount: null };
          if (sql.includes('FROM chat_sessions')) return {
            rows: values[0] === sessionId && values[1] === tenant
              ? [{ id: sessionId, tenant_id: tenant, closed_at: null, tenant_status: 'active' }]
              : [], rowCount: 1,
          };
          if (sql.includes('SELECT token, ciphertext')) return {
            rows: [...store].map(([token, ciphertext]) => ({ token, ciphertext })), rowCount: store.size,
          };
          if (sql.includes('INSERT INTO session_tokens')) {
            const token = String(values[1]);
            if (store.has(token)) throw new Error('duplicate token');
            store.set(token, String(values[2]));
            return { rows: [], rowCount: 1 };
          }
          throw new Error('Unexpected privacy query: ' + sql);
        },
        release() {},
      };
    },
  };
}
let revoked = false;
const authorizer: SessionAuthorizer = {
  async assertAuthorized(a, scope) {
    if (revoked || a.tenantId !== tenant || a.sessionId !== sessionId
      || a.principalId !== actor.principalId || scope.tenantStatus !== 'active') {
      throw new P6PrivacyError();
    }
  },
};

describe('P6 durable encrypted privacy', () => {
  it('encrypts customer contact data and reloads placeholders from persisted ciphertext', async () => {
    store.clear(); revoked = false;
    const first = new PostgresScopedPrivacyVault(pool(), authorizer, KEY);
    const masked = await first.maskAndPersist(actor, 'Reach me at customer@example.test.');
    expect(masked).not.toContain('customer@example.test');
    expect(masked).toContain('[EMAIL_1]');
    expect([...store.values()].join(' ')).not.toContain('customer@example.test');
    const afterRestart = new PostgresScopedPrivacyVault(pool(), authorizer, KEY);
    await afterRestart.assertMaskedAndKnown(actor, masked);
    expect(await afterRestart.restoreForCustomer(actor, masked)).toContain('customer@example.test');
  });

  it('denies unrecognized privacy placeholders and unmasked contact fields', async () => {
    store.clear(); revoked = false;
    const vault = new PostgresScopedPrivacyVault(pool(), authorizer, KEY);
    await expect(vault.assertMaskedAndKnown(actor, '[EMAIL_99]')).rejects.toBeInstanceOf(P6PrivacyError);
    await expect(vault.assertMaskedAndKnown(actor, 'customer@example.test')).rejects.toBeInstanceOf(P6PrivacyError);
    await expect(vault.assertMaskedAndKnown(actor, 'contact +971501234567')).rejects.toBeInstanceOf(P6PrivacyError);
  });

  it('rejects cross-tenant reads and revoked customer sessions', async () => {
    store.clear(); revoked = false;
    const vault = new PostgresScopedPrivacyVault(pool(), authorizer, KEY);
    await expect(vault.maskAndPersist({ ...actor, tenantId: 'other' }, 'test@example.test'))
      .rejects.toBeInstanceOf(P6PrivacyError);
    revoked = true;
    await expect(vault.maskAndPersist(actor, 'test@example.test')).rejects.toBeInstanceOf(P6PrivacyError);
    revoked = false;
  });

  it('requires a production-strength key and never stores a raw key', () => {
    expect(() => new PostgresScopedPrivacyVault(pool(), authorizer, 'short')).toThrow('production-grade');
    expect(() => new PostgresScopedPrivacyVault(pool(), authorizer, 'local-development-pii-vault-key'))
      .toThrow('production-grade');
  });
});

import { describe, expect, it } from 'vitest';
import { maskPii, rehydrateForSession, saveTokens, TokenVault } from './privacy.js';

describe('privacy boundary', () => {
  it('masks email and phone values before an external boundary and rehydrates only in the same session', () => {
    const session = { id: 'session', tenantId: 'tenant', createdAt: new Date().toISOString(), tokenMap: new Map<string, string>() };
    const vault = new TokenVault('test-vault-secret-2026');
    const result = maskPii('Please email alice@example.com or call +971 50 123 4567.');
    saveTokens(session, result.tokens, vault);
    expect(result.masked).not.toContain('alice@example.com');
    expect(result.masked).not.toContain('+971 50 123 4567');
    expect([...session.tokenMap.values()].join()).not.toContain('alice@example.com');
    expect(rehydrateForSession(session, result.masked, vault)).toContain('alice@example.com');
    expect(rehydrateForSession(session, result.masked, vault, 'assistant_response')).toContain('alice@example.com');
    expect(rehydrateForSession(session, result.masked, vault, 'workflow_payload')).not.toContain('alice@example.com');
    expect(rehydrateForSession({ ...session, id: 'other-session' }, result.masked, vault)).not.toContain('alice@example.com');
  });
});

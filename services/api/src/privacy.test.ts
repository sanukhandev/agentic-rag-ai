import { describe, expect, it } from 'vitest';
import { assertKnownTokens, maskPii, rehydrateForSession, saveTokens, TokenVault } from './privacy.js';

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
    expect(() => assertKnownTokens(session, '[EMAIL_99]', vault)).toThrow('unknown privacy token');
  });

  it('masks structured names before external boundaries', () => {
    const session = { id: 'session-name', tenantId: 'tenant', createdAt: new Date().toISOString(), tokenMap: new Map<string, string>() };
    const vault = new TokenVault('test-vault-secret-2026');
    const result = maskPii('My name is Alice Karim and I need a quote.');
    saveTokens(session, result.tokens, vault);
    expect(result.masked).not.toContain('Alice Karim');
    expect(rehydrateForSession(session, result.masked, vault, 'workflow_payload')).not.toContain('Alice Karim');
    expect(rehydrateForSession(session, result.masked, vault, 'assistant_response')).toContain('Alice Karim');
  });

  it('supports key rotation and expiry without exposing the old value', () => {
    const session = { id: 'session-rotate', tenantId: 'tenant', createdAt: new Date().toISOString(), tokenMap: new Map<string, string>() };
    const vault = new TokenVault('test-vault-secret-2026');
    const rotated = new TokenVault('rotated-vault-secret-2026');
    const masked = maskPii('alice@example.com');
    saveTokens(session, masked.tokens, vault);
    vault.rotate(session, rotated);
    expect(rehydrateForSession(session, masked.masked, vault)).not.toContain('alice@example.com');
    expect(rehydrateForSession(session, masked.masked, rotated)).toContain('alice@example.com');
    const expiredSession = { id: 'session-expired', tenantId: 'tenant', createdAt: new Date().toISOString(), tokenMap: new Map<string, string>() };
    saveTokens(expiredSession, masked.tokens, new TokenVault('expired-vault-secret-2026', -1));
    expect(rehydrateForSession(expiredSession, masked.masked, new TokenVault('expired-vault-secret-2026'))).not.toContain('alice@example.com');
    expect(expiredSession.tokenMap.size).toBe(0);
  });
});

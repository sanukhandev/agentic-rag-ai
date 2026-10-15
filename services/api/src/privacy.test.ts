import { describe, expect, it } from 'vitest';
import { maskPii, rehydrateForSession, saveTokens } from './privacy.js';

describe('privacy boundary', () => {
  it('masks email and phone values before an external boundary and rehydrates only in the same session', () => {
    const session = { id: 'session', tenantId: 'tenant', createdAt: new Date().toISOString(), tokenMap: new Map<string, string>() };
    const result = maskPii('Please email alice@example.com or call +971 50 123 4567.');
    saveTokens(session, result.tokens);
    expect(result.masked).not.toContain('alice@example.com');
    expect(result.masked).not.toContain('+971 50 123 4567');
    expect(rehydrateForSession(session, result.masked)).toContain('alice@example.com');
    expect(rehydrateForSession({ ...session, tokenMap: new Map() }, result.masked)).not.toContain('alice@example.com');
  });
});

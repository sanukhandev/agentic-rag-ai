import { describe, expect, it } from 'vitest';
import { assertKnownTokens, maskPii, maskPiiForSession, rehydrateForSession, saveTokens, TokenVault } from './privacy.js';

describe('privacy boundary', () => {
  it('masks email and phone values before an external boundary and rehydrates only in the same session', () => {
    const session = { id: 'session', tenantId: 'tenant', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
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
    const session = { id: 'session-name', tenantId: 'tenant', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
    const vault = new TokenVault('test-vault-secret-2026');
    const result = maskPii('My name is Alice Karim and I need a quote.');
    saveTokens(session, result.tokens, vault);
    expect(result.masked).not.toContain('Alice Karim');
    expect(rehydrateForSession(session, result.masked, vault)).toContain('Alice Karim');
    expect(rehydrateForSession(session, result.masked, vault, 'workflow_payload')).not.toContain('Alice Karim');
    expect(rehydrateForSession(session, result.masked, vault, 'assistant_response')).toContain('Alice Karim');
    expect(maskPii('I am interested in a demo.').masked).toBe('I am interested in a demo.');
    expect(maskPii('I am Alice.').masked).toBe('[NAME_1].');
    expect(maskPii('My name is N8n Tester.').masked).toBe('[NAME_1].');
    expect(maskPii('My name is Alice smith.').masked).toBe('[NAME_1].');
    expect(maskPii('my name is alice smith.').masked).toBe('[NAME_1].');
    expect(maskPii('My name is Alice Smith Johnson.').masked).toBe('[NAME_1].');
    expect(maskPii('I am alice smith.').masked).toBe('[NAME_1].');
    expect(maskPii("I'm Anne-Marie O'Neil.").masked).toBe('[NAME_1].');
  });

  it('allocates response tokens without overwriting earlier session values', () => {
    const session = { id: 'session-output', tenantId: 'tenant', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
    const vault = new TokenVault('test-vault-secret-2026');
    const input = maskPii('Please email alice@example.com.');
    saveTokens(session, input.tokens, vault);
    const output = maskPiiForSession(session, 'Please contact bob@example.com.', vault);
    expect(output).toBe('Please contact [EMAIL_2].');
    expect(rehydrateForSession(session, input.masked, vault)).toContain('alice@example.com');
    expect(rehydrateForSession(session, output, vault)).toContain('bob@example.com');
  });

  it('keeps assistant persona names separate from a later visitor name', () => {
    const session = { id: 'session-persona-name', tenantId: 'tenant', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
    const vault = new TokenVault('persona-name-vault-secret-2026');
    const greeting = maskPiiForSession(session, "Hi! I'm Sara, your assistant.", vault);
    const visitor = maskPiiForSession(session, 'My name is Alice Karim.', vault);
    expect(rehydrateForSession(session, greeting, vault)).toContain('Sara');
    expect(rehydrateForSession(session, visitor, vault)).toContain('Alice Karim');
  });

  it('masks international names without treating ordinary lower-case speech as a name', () => {
    const result = maskPii("My name is Élodie Müller and I'm interested in a demo.");
    expect(result.masked).toContain('[NAME_1]');
    expect(result.masked).not.toContain('Élodie Müller');
    expect(result.masked).toContain("I'm interested in a demo.");
    expect(result.tokens[0]?.value).toBe('Élodie Müller');
  });

  it('supports key rotation and expiry without exposing the old value', () => {
    const session = { id: 'session-rotate', tenantId: 'tenant', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>() };
    const vault = new TokenVault('test-vault-secret-2026');
    const rotated = new TokenVault('rotated-vault-secret-2026');
    const masked = maskPii('alice@example.com');
    saveTokens(session, masked.tokens, vault);
    vault.rotate(session, rotated);
    expect(rehydrateForSession(session, masked.masked, vault)).not.toContain('alice@example.com');
    expect(rehydrateForSession(session, masked.masked, rotated)).toContain('alice@example.com');
    const expiredSession = { id: 'session-expired', tenantId: 'tenant', createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), closedAt: null, personaVersionId: null, tokenMap: new Map<string, string>(), conversationState: { phase: 'DISCOVERY' as const, catalogVersionId: null, candidateIntentKeys: [], selectedIntentKey: null, slotValues: {}, pendingPrompt: null, rollingSummary: '', summaryRevision: 0, messageSequence: 0, workflowStatus: 'none' as const, contactConsent: 'unknown' as const, consentVersion: null, consentCapturedAt: null } };
    saveTokens(expiredSession, masked.tokens, new TokenVault('expired-vault-secret-2026', -1));
    expect(rehydrateForSession(expiredSession, masked.masked, new TokenVault('expired-vault-secret-2026'), 'admin_crm')).toContain('alice@example.com');
    expect(rehydrateForSession(expiredSession, masked.masked, new TokenVault('expired-vault-secret-2026'))).not.toContain('alice@example.com');
    expect(expiredSession.tokenMap.size).toBe(0);
  });
});

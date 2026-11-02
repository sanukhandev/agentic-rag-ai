import { describe, expect, it } from 'vitest';
import { issueV2Scope, verifyV2Scope, V2_TOOL_NAMES } from './v2-tool-gateway.js';

const secret = 'unit-scoped-tool-secret-0123456789';
const now = Date.UTC(2026, 10, 2, 12);
const scope = {
  tenantId: 'tenant-12345678',
  sessionId: 'session-12345678',
  opportunityId: 'opportunity-12345678',
  catalogVersionId: 'catalog-12345678',
  personaVersionId: 'persona-12345678',
  stateRevision: 3,
  toolAllowlist: ['search_knowledge', 'get_journey_state'] as Array<(typeof V2_TOOL_NAMES)[number]>,
};

describe('V2 trusted tool scope (isolated unit)', () => {
  it('returns the pinned context and exact allowlist', () => {
    const token = issueV2Scope(scope, secret, now);
    expect(verifyV2Scope(token, secret, now + 1_000)).toMatchObject(scope);
  });
  it('rejects tampered and expired scope tokens', () => {
    const token = issueV2Scope(scope, secret, now);
    expect(verifyV2Scope(token, 'different-secret-0123456789', now)).toBeNull();
    expect(verifyV2Scope(token + 'x', secret, now)).toBeNull();
    expect(verifyV2Scope(token, secret, now + 300_001)).toBeNull();
  });
  it('refuses short signing keys', () => {
    expect(() => issueV2Scope(scope, 'short', now)).toThrow('V2_TOOL_SCOPE_SECRET_REQUIRED');
  });
});

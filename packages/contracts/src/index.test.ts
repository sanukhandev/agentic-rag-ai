import { describe, expect, it } from 'vitest';
import { actionConfirmationSchema, authContextSchema, chatMessageRequestSchema, citationSchema } from './index.js';

describe('shared contracts', () => {
  it('rejects oversized or empty chat messages and accepts a valid citation', () => {
    expect(chatMessageRequestSchema.safeParse({ sessionId: 'not-a-uuid', message: '', clientMessageId: '' }).success).toBe(false);
    expect(citationSchema.safeParse({ sourceId: 'not-a-uuid' }).success).toBe(false);
  });

  it('requires the authorized chat session when confirming an action', () => {
    expect(actionConfirmationSchema.safeParse({ confirmed: true }).success).toBe(false);
    expect(actionConfirmationSchema.safeParse({ sessionId: '00000000-0000-0000-0000-000000000001', confirmed: true }).success).toBe(true);
  });

  it('validates the server-owned current-user contract', () => {
    expect(authContextSchema.safeParse({ userId: '00000000-0000-0000-0000-000000000001', email: 'admin@example.test', role: 'tenant_admin', tenantId: '00000000-0000-0000-0000-000000000002' }).success).toBe(true);
    expect(authContextSchema.safeParse({ userId: '00000000-0000-0000-0000-000000000001', email: 'admin@example.test', role: 'tenant_admin', tenantId: 'not-a-uuid' }).success).toBe(false);
  });
});

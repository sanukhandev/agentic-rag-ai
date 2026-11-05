import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SalesforceSandboxLeadProvider } from './salesforce-sandbox-lead-provider.js';

const request = () => ({
  schemaVersion: 2 as const,
  operation: 'lead.create_or_dedupe' as const,
  providerType: 'salesforce_sandbox' as const,
  tenantId: randomUUID(),
  sessionId: randomUUID(),
  opportunityId: randomUUID(),
  catalogVersionId: 'anc:r2:test',
  actionId: randomUUID(),
  actionKey: 'lead.create',
  actionRevision: 1,
  idempotencyKey: 'lead-idempotency-test',
  opaqueReference: 'opaque-lead-test',
  payloadRef: randomUUID(),
  notificationRequested: true as const,
});

describe('Salesforce sandbox lead readback adapter', () => {
  it('requires explicit readback configuration and never fabricates evidence', async () => {
    const provider = new SalesforceSandboxLeadProvider({ accessToken: '', readbackUrl: '' });

    await expect(provider.verify({ request: request(), providerRecordId: '00Q-test' }))
      .rejects.toThrow('SALESFORCE_READBACK_NOT_CONFIGURED');
  });

  it('authenticates readback, binds the record id, and returns a trusted attestation', async () => {
    const calls: Array<{ url: string; authorization: string | undefined }> = [];
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      readbackUrl: 'https://sandbox.example.test/leads/{leadId}',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), authorization: new Headers(init?.headers).get('authorization') ?? undefined });
        return new Response(JSON.stringify({ leadId: '00Q-test', idempotencyKey: 'lead-idempotency-test' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const input = request();

    await expect(provider.verify({ request: input, providerRecordId: '00Q-test' })).resolves.toEqual({
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      opportunityId: input.opportunityId,
      providerType: 'salesforce_sandbox',
      idempotencyKey: input.idempotencyKey,
      recordRef: '00Q-test',
      evidenceTier: 'provider_record_verified',
      verificationStatus: 'verified',
    });
    expect(calls).toEqual([{ url: 'https://sandbox.example.test/leads/00Q-test', authorization: 'Bearer sandbox-token' }]);
  });

  it('rejects a readback for a different provider record or action', async () => {
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      readbackUrl: 'https://sandbox.example.test/leads/{leadId}',
      fetchImpl: async () => new Response(JSON.stringify({ leadId: '00Q-other', idempotencyKey: 'wrong-action' }), { status: 200 }),
    });

    await expect(provider.verify({ request: request(), providerRecordId: '00Q-test' }))
      .rejects.toThrow('SALESFORCE_READBACK_MISMATCH');
  });

  it('retries transient readback failures without changing the provider identity', async () => {
    let attempts = 0;
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      readbackUrl: 'https://sandbox.example.test/leads/{leadId}',
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) return new Response(null, { status: 503, headers: { 'retry-after': '0' } });
        return new Response(JSON.stringify({ leadId: '00Q-test' }), { status: 200 });
      },
    });

    await expect(provider.verify({ request: request(), providerRecordId: '00Q-test' })).resolves.toMatchObject({ recordRef: '00Q-test', evidenceTier: 'provider_record_verified' });
    expect(attempts).toBe(2);
  });

  it('verifies the three Salesforce Account relationships before returning completion evidence', async () => {
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      accountReadbackUrl: 'https://sandbox.example.test/accounts/{accountId}',
      fetchImpl: async () => new Response(JSON.stringify({ accountId: '001-test', contactId: '003-test', opportunityId: '006-test' }), { status: 200 }),
    });
    const input = request();

    await expect(provider.verifyAccount({ request: input, providerRecordId: '001-test' })).resolves.toMatchObject({
      recordRef: '001-test', evidenceTier: 'provider_record_verified', remoteAccountId: '001-test', remoteContactId: '003-test', remoteOpportunityId: '006-test',
    });
  });

  it('rejects Salesforce SF-02 readback when the attachment is not linked to the verified records', async () => {
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      documentReadbackUrl: 'https://sandbox.example.test/attachments/{attachmentId}',
      fetchImpl: async () => new Response(JSON.stringify({ attachmentId: '069-test', leadAttachmentId: '069-lead', accountAttachmentId: '069-other', remoteAccountId: '001-test', remoteContactId: '003-test', remoteOpportunityId: '006-test' }), { status: 200 }),
    });
    const input = request();

    await expect(provider.verifyDocument({ request: input, providerRecordId: '069-test', expected: { leadAttachmentId: '069-lead', accountAttachmentId: '069-account', remoteAccountId: '001-test', remoteContactId: '003-test', remoteOpportunityId: '006-test' } }))
      .rejects.toThrow('SALESFORCE_DOCUMENT_READBACK_MISMATCH');
  });
});

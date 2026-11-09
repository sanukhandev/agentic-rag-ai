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

const accountRequest = () => ({
  tenantId: randomUUID(),
  sessionId: randomUUID(),
  opportunityId: randomUUID(),
  idempotencyKey: 'account-idempotency-test',
  leadExternalId: '00Q-lead-test',
});

describe('Salesforce sandbox lead readback adapter', () => {
  it('requires explicit readback configuration and never fabricates evidence', async () => {
    const provider = new SalesforceSandboxLeadProvider({ accessToken: '', readbackUrl: '' });

    expect(provider.isLeadReadbackConfigured()).toBe(false);
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
    expect(provider.isLeadReadbackConfigured()).toBe(true);
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

  it('obtains and caches a sandbox bearer token with client credentials before readback', async () => {
    const calls: Array<{ url: string; method: string; authorization: string | undefined; body: string | undefined }> = [];
    const provider = new SalesforceSandboxLeadProvider({
      tokenUrl: 'https://sandbox.example.test/oauth/token',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      readbackUrl: 'https://sandbox.example.test/leads/{leadId}',
      fetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), method: init?.method ?? 'GET', authorization: headers.get('authorization') ?? undefined, body: typeof init?.body === 'string' ? init.body : undefined });
        if (String(input).endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'oauth-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ leadId: '00Q-test' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(provider.verify({ request: request(), providerRecordId: '00Q-test' })).resolves.toMatchObject({ recordRef: '00Q-test', evidenceTier: 'provider_record_verified' });
    await expect(provider.verify({ request: request(), providerRecordId: '00Q-test' })).resolves.toMatchObject({ recordRef: '00Q-test', evidenceTier: 'provider_record_verified' });
    expect(calls).toEqual([
      { url: 'https://sandbox.example.test/oauth/token', method: 'POST', authorization: undefined, body: 'grant_type=client_credentials&client_id=client-id&client_secret=client-secret' },
      { url: 'https://sandbox.example.test/leads/00Q-test', method: 'GET', authorization: 'Bearer oauth-token', body: undefined },
      { url: 'https://sandbox.example.test/leads/00Q-test', method: 'GET', authorization: 'Bearer oauth-token', body: undefined },
    ]);
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
      fetchImpl: async () => new Response(JSON.stringify({ accountId: '001-test', contactId: '003-test', opportunityId: '006-test', leadExternalId: '00Q-lead-test', deduplicated: false }), { status: 200 }),
    });
    const input = accountRequest();

    await expect(provider.verifyAccount({ request: input, providerRecordId: '001-test' })).resolves.toMatchObject({
      recordRef: '001-test', evidenceTier: 'provider_record_verified', remoteAccountId: '001-test', remoteContactId: '003-test', remoteOpportunityId: '006-test', leadExternalId: '00Q-lead-test', deduplicated: false,
    });
  });

  it('verifies standard Salesforce Account, Contact and Opportunity readbacks from one opaque relationship reference', async () => {
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      accountReadbackUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Account/{accountId}',
      contactReadbackUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Contact/{contactId}',
      opportunityReadbackUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Opportunity/{opportunityId}',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/Account/')) return new Response(JSON.stringify({ Id: '001-test', Description: 'Agentic account for Lead 00Q-lead-test' }), { status: 200 });
        if (url.includes('/Contact/')) return new Response(JSON.stringify({ Id: '003-test', AccountId: '001-test' }), { status: 200 });
        return new Response(JSON.stringify({ Id: '006-test', AccountId: '001-test' }), { status: 200 });
      },
    });
    const input = accountRequest();

    await expect(provider.verifyAccount({ request: input, providerRecordId: '001-test:003-test:006-test' })).resolves.toMatchObject({
      recordRef: '001-test', remoteAccountId: '001-test', remoteContactId: '003-test', remoteOpportunityId: '006-test', leadExternalId: '00Q-lead-test', deduplicated: false,
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

  it('updates a Lead description and verifies the Salesforce readback', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      readbackUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Lead/{leadId}',
      fetchImpl: async (input, init) => {
        calls.push({ method: init?.method ?? 'GET', url: String(input), ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
        if (init?.method === 'PATCH') return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ Id: '00Q-test', Description: 'OCR summary from the synthetic document.' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(provider.updateLeadDescription({ providerRecordId: '00Q-test', description: 'OCR summary from the synthetic document.' })).resolves.toEqual({
      recordRef: '00Q-test', description: 'OCR summary from the synthetic document.',
    });
    expect(calls).toEqual([
      { method: 'PATCH', url: 'https://sandbox.example.test/services/data/v68.0/sobjects/Lead/00Q-test', body: '{"Description":"OCR summary from the synthetic document."}' },
      { method: 'GET', url: 'https://sandbox.example.test/services/data/v68.0/sobjects/Lead/00Q-test' },
    ]);
  });

  it('creates a Lead attachment and verifies its parent readback', async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    const provider = new SalesforceSandboxLeadProvider({
      accessToken: 'sandbox-token',
      readbackUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Lead/{leadId}',
      attachmentUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Attachment',
      attachmentReadbackUrl: 'https://sandbox.example.test/services/data/v68.0/sobjects/Attachment/{attachmentId}',
      fetchImpl: async (input, init) => {
        calls.push({ method: init?.method ?? 'GET', url: String(input), ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
        if (init?.method === 'POST') return new Response(JSON.stringify({ id: '00P-test' }), { status: 201, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ Id: '00P-test', ParentId: '00Q-test', Name: 'synthetic.pdf', BodyLength: 4 }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(provider.createLeadAttachment({ providerRecordId: '00Q-test', fileName: 'synthetic.pdf', contentBase64: 'UERG' })).resolves.toEqual({
      attachmentRef: '00P-test', parentRef: '00Q-test', fileName: 'synthetic.pdf', sizeBytes: 3,
    });
    expect(calls).toEqual([
      { method: 'POST', url: 'https://sandbox.example.test/services/data/v68.0/sobjects/Attachment', body: '{"ParentId":"00Q-test","Name":"synthetic.pdf","Body":"UERG"}' },
      { method: 'GET', url: 'https://sandbox.example.test/services/data/v68.0/sobjects/Attachment/00P-test' },
    ]);
  });
});

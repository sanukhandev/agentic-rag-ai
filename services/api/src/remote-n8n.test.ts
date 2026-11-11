import { describe, expect, it, vi } from 'vitest';
import { dispatchRemoteN8n } from './remote-n8n.js';

const leadRoute = { webhookPath: 'n8n/webhook/salesforce-lead', payloadContract: 'remote.salesforce-lead.v1' as const };
const quoteRoute = { webhookPath: 'n8n/webhook/generate-quotation', payloadContract: 'remote.generate-quotation.v1' as const };

describe('remote n8n workflow adapter', () => {
  it('sends the exact synthetic Salesforce Lead contract without exposing the quotation key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, status: 'SUCCESS', leadId: '00Q-SYNTHETIC-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await dispatchRemoteN8n({
      baseUrl: 'https://ai.techcarrot.ae', quotationApiKey: 'synthetic-quote-key', fetchImpl,
      route: leadRoute, idempotencyKey: 'synthetic-idempotency',
      payload: { Name: 'Synthetic Customer', Company: 'Synthetic Company', Phone: '+971500000001', Email: 'synthetic@example.test', Description: 'Synthetic company formation enquiry.' },
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://ai.techcarrot.ae/n8n/webhook/salesforce-lead', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-idempotency-key': 'synthetic-idempotency' },
      body: JSON.stringify({ Name: 'Synthetic Customer', Company: 'Synthetic Company', Phone: '+971500000001', Email: 'synthetic@example.test', Description: 'Synthetic company formation enquiry.' }),
    }));
    expect(result).toMatchObject({ providerStatus: 'accepted', result: { externalReference: '00Q-SYNTHETIC-1', providerOutcome: 'success' } });
  });

  it('sends the quotation API key and accepts only a PDF response', async () => {
    const fetchImpl = vi.fn(async () => new Response(Buffer.from('%PDF-1.4 synthetic'), { status: 200, headers: { 'content-type': 'application/pdf' } }));
    const result = await dispatchRemoteN8n({
      baseUrl: 'https://ai.techcarrot.ae', quotationApiKey: 'synthetic-quote-key', fetchImpl,
      route: quoteRoute, idempotencyKey: 'synthetic-quote-idempotency',
      payload: { accountId: '001-SYNTHETIC', customerName: 'Synthetic Customer', email: 'synthetic@example.test', packageName: 'Synthetic Package', currency: 'AED', items: [{ description: 'Synthetic setup', quantity: 1, unitPrice: 100 }] },
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://ai.techcarrot.ae/n8n/webhook/generate-quotation', expect.objectContaining({
      headers: { 'content-type': 'application/json', 'x-api-key': 'synthetic-quote-key', 'x-agentic-idempotency-key': 'synthetic-quote-idempotency' },
    }));
    expect(result).toMatchObject({ providerStatus: 'accepted', result: { providerOutcome: 'pdf_generated', artifactMimeType: 'application/pdf', artifactFileName: 'quotation.pdf' } });
    expect(result.result?.artifactSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('rejects invalid provider responses without leaking credentials', async () => {
    const secret = 'synthetic-secret-that-must-not-appear';
    const fetchImpl = vi.fn(async () => new Response('not a pdf', { status: 200, headers: { 'content-type': 'text/plain' } }));
    await expect(dispatchRemoteN8n({ baseUrl: 'https://ai.techcarrot.ae', quotationApiKey: secret, fetchImpl, route: quoteRoute, idempotencyKey: 'synthetic-invalid', payload: { accountId: '001-SYNTHETIC', customerName: 'Synthetic Customer', email: 'synthetic@example.test', packageName: 'Synthetic Package', currency: 'AED', items: [] } })).rejects.toThrow('remote_n8n_invalid_quotation_response');
    try { await dispatchRemoteN8n({ baseUrl: 'https://ai.techcarrot.ae', quotationApiKey: '', fetchImpl, route: quoteRoute, idempotencyKey: 'synthetic-missing-key', payload: { accountId: '001-SYNTHETIC', customerName: 'Synthetic Customer', email: 'synthetic@example.test', packageName: 'Synthetic Package', currency: 'AED', items: [] } }); } catch (error) { expect(String(error)).not.toContain(secret); }
  });
});

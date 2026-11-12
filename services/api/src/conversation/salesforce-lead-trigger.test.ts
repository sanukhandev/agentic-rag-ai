import { describe, expect, it, vi } from 'vitest';
import {
  formatSalesforceLeadPayload,
  triggerSalesforceLeadWebhook,
} from './salesforce-lead-trigger.js';

describe('Salesforce Lead Trigger micro JS function', () => {
  it('formats payload matching user specification exactly', () => {
    const payload = formatSalesforceLeadPayload({
      name: 'Tapu Gada',
      company: 'Commercial TNT',
      phone: '+9715002133201',
      email: 'rehan.antulay@techcarrot.ae',
      interest: 'Commercial plot leasing',
      remarks: 'Looking for a 15000 sq ft plot with flexible payments.',
    });

    expect(payload).toEqual({
      Name: 'Tapu Gada',
      Company: 'Commercial TNT',
      Phone: '+9715002133201',
      Email: 'rehan.antulay@techcarrot.ae',
      Description: 'AI Chatbot Lead. Interest: Commercial plot leasing. Remarks: Looking for a 15000 sq ft plot with flexible payments.',
    });
  });

  it('provides safe defaults when optional fields are omitted', () => {
    const payload = formatSalesforceLeadPayload({
      name: 'Rehan Antulay',
      email: 'rehan.antulay@techcarrot.ae',
    });

    expect(payload.Name).toBe('Rehan Antulay');
    expect(payload.Company).toBe('Commercial TNT');
    expect(payload.Phone).toBe('');
    expect(payload.Email).toBe('rehan.antulay@techcarrot.ae');
    expect(payload.Description).toContain('AI Chatbot Lead. Interest: Company formation.');
  });

  it('triggers n8n webhook and parses successful lead response', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://ai.techcarrot.ae/n8n/webhook/salesforce-lead');
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
      const parsed = JSON.parse(init?.body as string);
      expect(parsed.Name).toBe('Tapu Gada');
      return new Response(
        JSON.stringify({
          success: true,
          status: 'UPDATED',
          leadId: '00QFW009igFqdpE2AR',
          message: 'Existing Salesforce Lead updated successfully',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const result = await triggerSalesforceLeadWebhook(
      {
        name: 'Tapu Gada',
        company: 'Commercial TNT',
        phone: '+9715002133201',
        email: 'rehan.antulay@techcarrot.ae',
        interest: 'Commercial plot leasing',
        remarks: 'Looking for a 15000 sq ft plot with flexible payments.',
      },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: true,
      status: 'UPDATED',
      leadId: '00QFW009igFqdpE2AR',
      message: 'Existing Salesforce Lead updated successfully',
    });
  });

  it('throws on HTTP error from remote webhook', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid payload' }), { status: 422, statusText: 'Unprocessable Entity' }),
    );

    await expect(
      triggerSalesforceLeadWebhook(
        { name: 'Bad Lead' },
        { fetchImpl: fetchMock as unknown as typeof fetch },
      ),
    ).rejects.toThrow('Salesforce lead webhook failed with status 422');
  });
});

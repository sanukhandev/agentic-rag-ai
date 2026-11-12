export interface SalesforceLeadInput {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  interest?: string;
  remarks?: string;
}

export interface SalesforceLeadWebhookPayload extends Record<string, unknown> {
  Name: string;
  Company: string;
  Phone: string;
  Email: string;
  Description: string;
}

export interface SalesforceLeadWebhookResponse {
  success: boolean;
  status: 'SUCCESS' | 'UPDATED' | string;
  leadId: string;
  message?: string;
}

/**
 * Formats lead attributes into the authoritative n8n Salesforce webhook payload.
 */
export const formatSalesforceLeadPayload = (
  input: SalesforceLeadInput,
  defaultCompany = 'Commercial TNT',
): SalesforceLeadWebhookPayload => {
  const interest = input.interest?.trim() || 'Company formation';
  const remarks = input.remarks?.trim() || 'Customer company-formation enquiry.';
  return {
    Name: input.name?.trim() || 'Valued Customer',
    Company: input.company?.trim() || defaultCompany,
    Phone: input.phone?.trim() || '',
    Email: input.email?.trim() || '',
    Description: `AI Chatbot Lead. Interest: ${interest}. Remarks: ${remarks}`,
  };
};

/**
 * Micro JS function within intent catalog / workflow engine for triggering
 * the remote n8n Salesforce Lead webhook when contact requirements are satisfied.
 *
 * @param input Lead contact and enquiry details
 * @param options Webhook transport overrides (url, fetch implementation, timeout)
 * @returns Webhook result containing provider leadId and update status
 */
export const triggerSalesforceLeadWebhook = async (
  input: SalesforceLeadInput,
  options: {
    webhookUrl?: string;
    defaultCompany?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<SalesforceLeadWebhookResponse> => {
  const url = options.webhookUrl
    ?? process.env.REMOTE_N8N_SALESFORCE_LEAD_URL
    ?? 'https://ai.techcarrot.ae/n8n/webhook/salesforce-lead';
  const payload = formatSalesforceLeadPayload(input, options.defaultCompany);
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  if (!response.ok) {
    throw new Error(`Salesforce lead webhook failed with status ${response.status}: ${response.statusText}`);
  }

  const result = await response.json() as SalesforceLeadWebhookResponse;
  return result;
};

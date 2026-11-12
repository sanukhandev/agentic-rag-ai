import process from 'node:process';

const enabled = process.env.REMOTE_N8N_TEST_ENABLED === 'true';
const baseUrl = (process.env.REMOTE_N8N_BASE_URL ?? '').replace(/\/$/u, '');
const leadPath = process.env.REMOTE_N8N_SALESFORCE_LEAD_PATH ?? process.env.REMOTE_N8N_LEAD_PATH ?? '/n8n/webhook/salesforce-lead';
const quotePath = process.env.REMOTE_N8N_QUOTATION_PATH ?? process.env.REMOTE_N8N_QUOTE_PATH ?? '/n8n/webhook/generate-quotation';
const quoteApiKey = process.env.REMOTE_N8N_QUOTATION_API_KEY ?? process.env.REMOTE_N8N_QUOTE_API_KEY ?? '';

if (!enabled) {
  console.log(JSON.stringify({ enabled: false, skipped: true, reason: 'REMOTE_N8N_TEST_ENABLED is not true.' }, null, 2));
  process.exit(0);
}
if (!/^https:\/\//u.test(baseUrl) || !quoteApiKey) throw new Error('REMOTE_N8N_BASE_URL and REMOTE_N8N_QUOTATION_API_KEY are required for the enabled remote acceptance test.');

const synthetic = {
  lead: {
    Name: 'Synthetic Review Customer', Company: 'Synthetic Example LLC', Phone: '+971500000000', Email: 'synthetic-review@example.invalid',
    Description: 'Synthetic acceptance lead. Interest: company formation. Remarks: wants a development-only package review.',
  },
  quote: {
    accountId: process.env.REMOTE_N8N_QUOTE_ACCOUNT_ID || 'synthetic-account', customerName: 'Synthetic Review Customer',
    email: 'synthetic-review@example.invalid', packageName: 'Business Formation Package', currency: 'AED',
    items: [{ description: 'Company Formation', quantity: 1, unitPrice: 5000 }, { description: 'Administrative Services', quantity: 1, unitPrice: 11000 }],
  },
};

const post = async (path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  return { status: response.status, ok: response.ok, responsePreview: text.slice(0, 500).replaceAll(quoteApiKey, '[REDACTED]') };
};

const lead = await post(leadPath, synthetic.lead);
const quotation = await post(quotePath, synthetic.quote, { 'x-api-key': quoteApiKey });
const report = {
  enabled: true, baseUrl, paths: { lead: leadPath, quotation: quotePath }, synthetic: true,
  lead, quotation, passed: lead.ok && quotation.ok,
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

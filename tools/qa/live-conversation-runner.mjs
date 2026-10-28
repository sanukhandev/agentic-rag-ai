import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost').replace(/\/$/u, '');
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const outputDir = process.env.TEST_ARTIFACT_DIRECTORY ?? 'artifacts';
const scenario = [
  'Hi, good morning.',
  'I want to start a company in Dubai. Can you explain the steps involved?',
  'I want to start a digital marketing agency that handles social media, advertising and content creation.',
  'What visa packages are available?',
  "Okay, let's continue with my company setup.",
  'We need two visas, a shared office and want to start next month. Our budget is AED 25000.',
  'Which package would be suitable for my company?',
  'That sounds good. I want someone to help me proceed.',
  'My name is Alex Morgan.',
  'My email is alex@example.test.',
  'My phone number is +971 50 000 0000.',
];

const json = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, ...options, body: options.body ? JSON.stringify(options.body) : undefined });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body };
};
const redact = (value) => JSON.parse(JSON.stringify(value).replaceAll('alex@example.test', '[EMAIL_TEST]').replaceAll('+971 50 000 0000', '[PHONE_TEST]').replaceAll('Alex Morgan', '[NAME_TEST]'));

await fs.mkdir(outputDir, { recursive: true });
const health = { live: await json('/api/v1/health/live'), ready: await json('/api/v1/health/ready'), config: await json(`/api/v1/chat/config?tenantSlug=${encodeURIComponent(tenantSlug)}`) };
const sessionResponse = await json('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } });
if (sessionResponse.status !== 201) throw new Error(`Session creation failed: ${sessionResponse.status}`);
const sessionId = sessionResponse.body.sessionId;
const turns = [];
for (const [index, message] of scenario.entries()) {
  const clientMessageId = crypto.randomUUID();
  const response = await json('/api/v1/chat/messages', { method: 'POST', body: { sessionId, type: 'text', message, clientMessageId } });
  const persisted = await json(`/api/v1/chat/sessions/${sessionId}`);
  turns.push({ turn: index + 1, userMessage: message, clientMessageId, response: redact(response), persisted: redact(persisted) });
  if (response.status !== 200) break;
}
const report = { generatedAt: new Date().toISOString(), baseUrl, tenantSlug, sessionId, health: redact(health), turns };
await fs.writeFile(`${outputDir}/live-api-conversation-validation-2026-10-28.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const lines = [`# Live API conversation validation`, ``, `- Base URL: ${baseUrl}`, `- Tenant: ${tenantSlug}`, `- Session: ${sessionId}`, `- Generated: ${report.generatedAt}`, ``];
for (const turn of turns) {
  const body = turn.response.body ?? {};
  lines.push(`## Turn ${turn.turn}`, ``, `**User:** ${turn.userMessage}`, ``, `- HTTP: ${turn.response.status}`, `- Answer: ${body.answer ?? body.error?.message ?? '[no answer]'}`, `- Grounded: ${String(body.grounded ?? 'n/a')}`, `- Citations: ${Array.isArray(body.citations) ? body.citations.length : 0}`, `- Pending requirement: ${body.pendingRequirementKey ?? 'none'}`, `- Action proposal: ${body.actionProposal?.id ?? 'none'}`, `- Persisted state captured: ${turn.persisted.status === 200 ? 'yes' : `no (${turn.persisted.status})`}`, ``);
}
await fs.writeFile(`${outputDir}/live-api-conversation-validation-2026-10-28.md`, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ sessionId, turnCount: turns.length, outputDir }, null, 2));

import crypto from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const apiBase = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/u, '');
const outputPath = process.env.UNSEEN_OUTPUT ?? 'artifacts/gate3/conversation-regression/unseen-mock/report.json';
const cases = JSON.parse(await readFile(new URL('./gate3-unseen-conversation-cases.json', import.meta.url), 'utf8'));
const results = [];
const request = async (path, { method = 'GET', token, body } = {}) => {
  try {
    const response = await fetch(`${apiBase}${path}`, { method, headers: { 'content-type': 'application/json', Origin: apiBase, ...(token ? { 'x-agentic-session-token': token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: response.status, body: parsed };
  } catch { return { status: 0, body: null }; }
};
const create = async (tenantSlug) => { const response = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } }); return response.status === 201 ? response.body : null; };
for (let attempt = 0; attempt < 30; attempt += 1) {
  const live = await request('/api/v1/health/live');
  const ready = await request('/api/v1/health/ready');
  if (live.status === 200 && ready.status === 200) break;
  if (attempt === 29) throw new Error('Isolated API did not become ready for unseen evaluation.');
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const record = (item) => results.push(item);
const genericRestart = 'I can help you work through that. Which part of your setup would you like to discuss first?';

const eligibleCases = cases.filter((item) => item.eligible);
const session = await create('anc');
for (const item of eligibleCases) {
  const response = session ? await request('/api/v1/chat/messages', { method: 'POST', token: session.sessionToken, body: { sessionId: session.sessionId, type: 'text', message: item.message, clientMessageId: `gate3-unseen-${item.id}-${crypto.randomUUID()}` } }) : { status: 0, body: null };
  const answer = String(response.body?.answer ?? '');
  const safe = response.status === 200 && answer.length > 0 && answer !== genericRestart && !/\b(?:your account has been created|salesforce attachment is complete|payment has been processed|contract has been signed)\b/iu.test(answer);
  record({ id: item.id, category: item.category, eligible: true, passed: safe, status: response.status, responseQuality: safe ? 'useful_or_safe' : 'invalid_or_unsafe_response' });
}

const security = await create('anc-empty');
const sessionA = session;
const pdf = Buffer.from('not a PDF').toString('base64');
const securityCases = cases.filter((item) => !item.eligible);
for (const item of securityCases) {
  let response;
  if (item.operation === 'missing_token_documents_config') response = await request(`/api/v1/chat/sessions/${sessionA?.sessionId}/documents/config`);
  if (item.operation === 'invalid_token_documents_config') response = await request(`/api/v1/chat/sessions/${sessionA?.sessionId}/documents/config`, { token: 'invalid-gate3-token' });
  if (item.operation === 'cross_tenant_documents_list') response = await request(`/api/v1/chat/sessions/${sessionA?.sessionId}/documents`, { token: security?.sessionToken });
  if (item.operation === 'cross_session_message') response = await request('/api/v1/chat/messages', { method: 'POST', token: security?.sessionToken, body: { sessionId: sessionA?.sessionId, type: 'text', message: 'cross-session synthetic request', clientMessageId: `gate3-cross-${crypto.randomUUID()}` } });
  if (item.operation === 'invalid_document_mime') response = await request(`/api/v1/chat/sessions/${sessionA?.sessionId}/documents`, { method: 'POST', token: sessionA?.sessionToken, body: { fileName: 'invalid.txt', mimeType: 'text/plain', contentBase64: pdf, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
  if (item.operation === 'document_before_package') response = await request(`/api/v1/chat/sessions/${sessionA?.sessionId}/documents`, { method: 'POST', token: sessionA?.sessionToken, body: { fileName: 'before-package.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.7 synthetic').toString('base64'), primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
  record({ id: item.id, category: item.category, eligible: false, passed: Boolean(response && [401, 403, 404, 409, 422].includes(response.status)), status: response?.status ?? 0, responseQuality: 'security_refusal_expected' });
}

const eligibleResults = results.filter((item) => item.eligible);
const securityResults = results.filter((item) => !item.eligible);
const report = {
  status: results.every((item) => item.passed) ? 'PASSED' : 'FAILED',
  mode: 'deterministic_mock',
  apiBase,
  caseCount: cases.length,
  eligibleDialogue: { passed: eligibleResults.filter((item) => item.passed).length, total: eligibleResults.length },
  security: { passed: securityResults.filter((item) => item.passed).length, total: securityResults.length },
  cases: results,
  note: 'This is an independent deterministic contract/generalization evaluation, not an Azure quality score and not a replacement for the protected 23-case gate.'
};
await mkdir(outputPath.split(/[\\/]/u).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, cases: report.caseCount, eligible: report.eligibleDialogue, security: report.security, outputPath }, null, 2));
if (report.status !== 'PASSED') process.exitCode = 1;

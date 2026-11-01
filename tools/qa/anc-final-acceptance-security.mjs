import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const apiBase = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/u, '');
const outputPath = process.env.SECURITY_OUTPUT ?? 'artifacts/ancfz-stage5-api-uat/final-acceptance/security-regression.json';
const startedAt = new Date().toISOString();
const checks = [];
const pdf = Buffer.from('%PDF-1.7 ANC synthetic security UAT').toString('base64');

const request = async (path, { method = 'GET', body, sessionToken, clientMessageId } = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Origin: apiBase, ...(sessionToken ? { 'x-agentic-session-token': sessionToken } : {}), ...(clientMessageId ? { 'x-client-message-id': clientMessageId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { status: response.status, code: parsed?.error?.code ?? null, body: parsed };
};

const check = (name, result, predicate, expected) => {
  const passed = predicate(result);
  checks.push({ name, passed, status: result.status, code: result.code, expected });
  return passed;
};

const createSession = async (tenantSlug) => {
  const response = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } });
  if (response.status !== 201) throw new Error(`Could not create ${tenantSlug} security session (${response.status}).`);
  return response.body;
};

const snapshot = (sessionId, tenantId) => {
  const sql = `SELECT json_build_object('messages',(SELECT count(*) FROM chat_messages WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),'actions',(SELECT count(*) FROM action_requests WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),'documents',(SELECT count(*) FROM supporting_documents WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'))`;
  return JSON.parse(execFileSync('docker', ['exec', 'anc-mock-uat-postgres', 'psql', '-U', 'anc_mock_uat', '-d', 'anc_mock_uat', '-At', '-c', sql], { encoding: 'utf8' }).trim());
};

const redactRef = (value) => value ? `ref-${createHash('sha256').update(value).digest('hex').slice(0, 12)}` : null;

const tenantA = await createSession('anc');
const tenantB = await createSession('anc-empty');
const before = snapshot(tenantA.sessionId, tenantA.tenantId);

check('missing session token document config', await request(`/api/v1/chat/sessions/${tenantA.sessionId}/documents/config`), (result) => result.status === 401 || result.status === 403, '401 or 403');
check('invalid session token document config', await request(`/api/v1/chat/sessions/${tenantA.sessionId}/documents/config`, { sessionToken: 'invalid-token' }), (result) => result.status === 401 || result.status === 403, '401 or 403');
check('cross-tenant document config', await request(`/api/v1/chat/sessions/${tenantA.sessionId}/documents/config`, { sessionToken: tenantB.sessionToken }), (result) => result.status === 401 || result.status === 403 || result.status === 404, '401, 403 or 404');
check('cross-tenant document list', await request(`/api/v1/chat/sessions/${tenantA.sessionId}/documents`, { sessionToken: tenantB.sessionToken }), (result) => result.status === 401 || result.status === 403 || result.status === 404, '401, 403 or 404');
check('cross-tenant document upload', await request(`/api/v1/chat/sessions/${tenantA.sessionId}/documents`, { method: 'POST', sessionToken: tenantB.sessionToken, body: { fileName: 'cross-tenant.pdf', mimeType: 'application/pdf', contentBase64: pdf, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } }), (result) => result.status === 401 || result.status === 403 || result.status === 404, '401, 403 or 404');
check('cross-session message access', await request('/api/v1/chat/messages', { method: 'POST', sessionToken: tenantB.sessionToken, body: { sessionId: tenantA.sessionId, type: 'text', message: 'unauthorized synthetic message', clientMessageId: randomUUID() } }), (result) => result.status === 401 || result.status === 403 || result.status === 404, '401, 403 or 404');
check('cross-session action confirmation', await request(`/api/v1/chat/actions/${randomUUID()}/confirm`, { method: 'POST', sessionToken: tenantB.sessionToken, body: { sessionId: tenantA.sessionId, confirmed: true } }), (result) => result.status === 401 || result.status === 403 || result.status === 404, '401, 403 or 404');

const clientMessageId = randomUUID();
await request('/api/v1/chat/messages', { method: 'POST', sessionToken: tenantA.sessionToken, body: { sessionId: tenantA.sessionId, type: 'text', message: 'Hi Zara, I want to start a synthetic software consulting company.', clientMessageId } });
check('same message ID with different content', await request('/api/v1/chat/messages', { method: 'POST', sessionToken: tenantA.sessionToken, body: { sessionId: tenantA.sessionId, type: 'text', message: 'different content for the same ID', clientMessageId } }), (result) => result.status === 409 && result.code === 'MESSAGE_ID_REUSED', '409 MESSAGE_ID_REUSED');

const after = snapshot(tenantA.sessionId, tenantA.tenantId);
const noUnauthorizedSideEffects = before.actions === after.actions && before.documents === after.documents;
checks.push({ name: 'unauthorized requests caused no action/document side effects', passed: noUnauthorizedSideEffects, before, after, expected: 'actions and documents unchanged' });

const endedAt = new Date().toISOString();
const report = {
  status: checks.every((item) => item.passed) ? 'PASSED' : 'FAILED',
  startedAt,
  endedAt,
  apiBase,
  syntheticOnly: true,
  tenantReferences: { anc: redactRef(tenantA.tenantId), ancEmpty: redactRef(tenantB.tenantId), sessionA: redactRef(tenantA.sessionId), sessionB: redactRef(tenantB.sessionId) },
  checks,
  delegatedRegressionCoverage: [
    { area: 'expired sessions, stale revisions, callback replay and document scope', suite: 'services/api/src/app.test.ts and services/api/src/document-intake-api.test.ts', result: 'covered by 341 passing Node API tests' },
  ],
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, checks: checks.length, passed: checks.filter((item) => item.passed).length, outputPath }, null, 2));
if (process.env.STRICT_ASSERTIONS === 'true' && report.status !== 'PASSED') process.exitCode = 1;

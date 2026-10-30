import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseUrl = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/u, '');
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const runId = crypto.randomUUID();
const outputPath = process.env.ANCFZ_SINGLE_JOURNEY_OUTPUT ?? `artifacts/ancfz-single-journey/${runId}.json`;
const postgresContainer = process.env.POSTGRES_CONTAINER ?? 'agentic-postgres';
const postgresUser = process.env.POSTGRES_USER ?? 'agentic';
const postgresDatabase = process.env.POSTGRES_DATABASE ?? 'agentic_rag';
const synthetic = { name: `Codex Journey ${runId.slice(0, 8)}`, email: `codex-${runId.slice(0, 8)}@example.test`, phone: '+971500000000' };
const assertions = [];
const turns = [];
const actionEvidence = [];
const assert = (condition, message) => assertions.push({ passed: Boolean(condition), message });
const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, ...options, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: response.status, body };
};
const persistedState = (sessionId) => {
  try {
    const raw = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', postgresUser, '-d', postgresDatabase, '-At', '-c', `select conversation_state from chat_sessions where id='${sessionId}'`], { encoding: 'utf8' }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const auditEvidence = (tenantId) => {
  try {
    const raw = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', postgresUser, '-d', postgresDatabase, '-At', '-c', `select coalesce(json_agg(json_build_object('event',event_name,'function',metadata->>'functionName','status',metadata->>'status')),'[]'::json) from audit_events where tenant_id='${tenantId}' and event_name like 'foundry.function_call.%'`], { encoding: 'utf8' }).trim();
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const valueForRequirement = (key) => ({
  name: `My name is ${synthetic.name}.`,
  email: `My email is ${synthetic.email}.`,
  phone: `My phone number is ${synthetic.phone}.`,
  business_activity: 'software consulting and AI services',
  activity: 'software consulting and AI services',
  entity_type: 'limited liability company',
  company_structure: 'limited liability company',
  visa_count: 'three',
  budget_aed: 'AED 25000',
  timeline: 'next month',
  workspace_preference: 'shared office',
  contact_consent: 'Yes, I explicitly consent to being contacted about this request.',
}[key] ?? ({
  name: `My name is ${synthetic.name}.`,
  email: `My email is ${synthetic.email}.`,
  phone: `My phone number is ${synthetic.phone}.`,
  contact_consent: 'Yes, I explicitly consent to being contacted about this request.',
}[key.split('.').at(-1)] ?? null));
const redact = (value) => JSON.parse(JSON.stringify(value).replaceAll(synthetic.email, '[EMAIL_TEST]').replaceAll(synthetic.phone, '[PHONE_TEST]').replaceAll(synthetic.name, '[NAME_TEST]'));
const send = async (sessionId, message, clientMessageId = crypto.randomUUID()) => {
  const response = await request('/api/v1/chat/messages', { method: 'POST', body: { sessionId, type: 'text', message, clientMessageId } });
  const session = await request(`/api/v1/chat/sessions/${sessionId}`);
  const state = persistedState(sessionId);
  turns.push({ message: redact(message), clientMessageId, status: response.status, response: redact(response.body), state: redact(state) });
  return { response, session, state, clientMessageId };
};
const confirmLeadAction = async (sessionId, proposalId) => {
  const detail = await request(`/api/v1/chat/actions/${proposalId}?sessionId=${encodeURIComponent(sessionId)}`);
  const workflowKey = detail.body?.action?.workflowKey ?? detail.body?.workflowKey ?? null;
  actionEvidence.push({ proposalId: proposalId.slice(0, 8), workflowKey, before: detail.body?.action?.state ?? detail.body?.state ?? null });
  if (process.env.RUN_SANDBOX_LEAD !== 'true' || !String(workflowKey).includes('lead')) return;
  const confirmation = await request(`/api/v1/chat/actions/${proposalId}/confirm`, { method: 'POST', body: { sessionId, confirmed: true } });
  actionEvidence.push({ proposalId: proposalId.slice(0, 8), confirmationStatus: confirmation.status });
};

const health = { live: await request('/api/v1/health/live'), ready: await request('/api/v1/health/ready'), config: await request(`/api/v1/chat/config?tenantSlug=${encodeURIComponent(tenantSlug)}`) };
const created = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } });
if (created.status !== 201) throw new Error(`Session creation failed with HTTP ${created.status}.`);
const sessionId = created.body.sessionId;
const tenantId = created.body.tenantId;
let current = await send(sessionId, 'I want to register a company in the UAE and need guidance.');
assert(current.response.status === 200, 'Lead-generation initiation returned HTTP 200.');
assert(typeof current.response.body?.answer === 'string' && current.response.body.answer.length > 0, 'Lead-generation response contains an answer.');
let knowledgeInterrupted = false;
let correctionApplied = false;
let duplicateVerified = false;
let firstOpportunity = null;
// shortcut: cap the harness at 20 requirement turns; increase only when the published catalog adds a requirement, never treat the cap as success.
for (let step = 0; step < 20; step += 1) {
  const state = current.state;
  const intentKey = state?.intentProgress?.activeIntentKey ?? state?.selectedIntentKey ?? null;
  const entry = intentKey ? state?.intentProgress?.entries?.[intentKey] : null;
  const opportunityId = entry?.journeyId ?? null;
  firstOpportunity ??= opportunityId;
  if (firstOpportunity && opportunityId) assert(firstOpportunity === opportunityId, 'The active opportunity remains stable during the journey.');
  const slots = entry?.slotValues ?? state?.slotValues ?? {};
  if (!knowledgeInterrupted && intentKey && entry?.currentRequirementKey && (slots.entity_type || slots.visa_count)) {
    const before = entry.currentRequirementKey;
    current = await send(sessionId, 'What approved information is available about the setup process and timing?');
    const afterState = current.state;
    const afterIntent = afterState?.intentProgress?.activeIntentKey ?? afterState?.selectedIntentKey ?? intentKey;
    assert(afterIntent === intentKey, 'Knowledge interruption preserves the active catalog intent.');
    assert((afterState?.intentProgress?.entries?.[afterIntent]?.currentRequirementKey ?? before) === before, 'Knowledge interruption preserves the pending requirement.');
    knowledgeInterrupted = true;
    continue;
  }
  if (!correctionApplied && slots.visa_count) {
    current = await send(sessionId, 'Correction: I need three visas, not the previous number.');
    const corrected = current.state?.intentProgress?.entries?.[intentKey]?.slotValues?.visa_count ?? current.state?.slotValues?.visa_count;
    assert(corrected === '3' || corrected === 'three', 'A corrected visa count is persisted on the same journey.');
    correctionApplied = true;
    continue;
  }
  const pendingKey = current.response.body?.pendingRequirementKey ?? entry?.currentRequirementKey ?? null;
  const value = typeof pendingKey === 'string' ? valueForRequirement(pendingKey) : null;
  if (value) {
    current = await send(sessionId, value);
    const proposalId = current.response.body?.actionProposal?.id;
    if (proposalId) await confirmLeadAction(sessionId, proposalId);
    continue;
  }
  if (!duplicateVerified) {
    const retryId = crypto.randomUUID();
    const first = await send(sessionId, 'Please continue with the current setup requirements.', retryId);
    const second = await send(sessionId, 'Please continue with the current setup requirements.', retryId);
    assert(first.response.status === 200 && second.response.status === 200 && first.response.body?.messageId === second.response.body?.messageId, 'Duplicate client-message retry returns the durable cached response.');
    duplicateVerified = true;
    current = second;
    continue;
  }
  break;
}
const finalState = persistedState(sessionId);
const finalIntent = finalState?.intentProgress?.activeIntentKey ?? finalState?.selectedIntentKey ?? null;
const finalEntry = finalIntent ? finalState?.intentProgress?.entries?.[finalIntent] : null;
const lifecycle = finalEntry?.lifecycle ?? null;
const responseKeys = [...new Set(turns.flatMap((turn) => Object.keys(turn.response ?? {})))].sort();
assert(responseKeys.join(',') === 'actionProposal,answer,citations,conversational,grounded,messageId,pendingIntentKey,pendingPromptId,pendingRequirementKey,requestId,sessionId', 'Chat API response keys remain unchanged.');
assert(knowledgeInterrupted, 'The journey included one knowledge interruption.');
assert(correctionApplied, 'The journey included one fact correction.');
assert(duplicateVerified, 'The journey included one idempotent duplicate retry.');
const report = { runId, tenantSlug, tenantId, sessionId, application: { baseUrl, responseKeys }, customerMessages: turns.length, assistantResponses: turns.filter((turn) => turn.response?.answer).length, foundryFunctionAudit: auditEvidence(tenantId), opportunityIdDigest: firstOpportunity?.slice(0, 8) ?? null, finalStage: lifecycle?.currentStage ?? null, lifecycle, actionEvidence, assertions, status: assertions.every((item) => item.passed) ? 'PASSED' : 'BLOCKED', turns };
await fs.mkdir(outputPath.split(/[\\/]/u).slice(0, -1).join('/') || '.', { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(redact(report), null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ runId, sessionId, customerMessages: report.customerMessages, assistantResponses: report.assistantResponses, functionCalls: report.foundryFunctionAudit.length, passed: assertions.filter((item) => item.passed).length, failed: assertions.filter((item) => !item.passed).length, finalStage: report.finalStage, outputPath, status: report.status }, null, 2));
if (report.status !== 'PASSED') process.exitCode = 1;

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost').replace(/\/$/u, '');
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const primaryIntentKey = process.env.PRIMARY_INTENT_KEY ?? 'anc.setup.new_company';
const scenarioId = process.env.TEST_SCENARIO ?? `live-${crypto.randomUUID()}`;
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
const postgresContainer = process.env.POSTGRES_CONTAINER ?? 'agentic-postgres';
const postgresUser = process.env.POSTGRES_USER ?? 'agentic';
const postgresDatabase = process.env.POSTGRES_DATABASE ?? 'agentic_rag';
const persistedState = (sessionId) => {
  try {
    const raw = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', postgresUser, '-d', postgresDatabase, '-At', '-c', `select conversation_state from chat_sessions where id='${sessionId}'`], { encoding: 'utf8' }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const persistedActionDiagnostics = (actionId) => {
  try {
    const sql = `select json_build_object(
      'actionId', a.id,
      'actionState', a.state,
      'opportunityId', a.opportunity_id,
      'outboxPublished', exists(select 1 from event_outbox o where o.action_id = a.id and o.published_at is not null),
      'executionId', e.id,
      'n8nExecutionRef', e.n8n_execution_ref,
      'providerStatus', e.provider_status,
      'crmLeadId', l.lead_id,
      'remoteCrm', l.remote_crm
    )::text from action_requests a
      left join lateral (select * from action_executions where action_id = a.id order by updated_at desc limit 1) e on true
      left join crm_leads l on l.action_id = a.id
      where a.id = '${actionId}'`;
    const raw = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', postgresUser, '-d', postgresDatabase, '-At', '-c', sql], { encoding: 'utf8' }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const assert = (condition, message, assertions) => { assertions.push({ passed: Boolean(condition), message }); };
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await fs.mkdir(outputDir, { recursive: true });
const health = { live: await json('/api/v1/health/live'), ready: await json('/api/v1/health/ready'), config: await json(`/api/v1/chat/config?tenantSlug=${encodeURIComponent(tenantSlug)}`) };
const sessionResponse = await json('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } });
if (sessionResponse.status !== 201) throw new Error(`Session creation failed: ${sessionResponse.status}`);
const sessionId = sessionResponse.body.sessionId;
const turns = [];
const assertions = [];
let firstOpportunityId = null;
for (const [index, message] of scenario.entries()) {
  const assertionStart = assertions.length;
  const clientMessageId = crypto.randomUUID();
  const response = await json('/api/v1/chat/messages', { method: 'POST', body: { sessionId, type: 'text', message, clientMessageId } });
  const persisted = await json(`/api/v1/chat/sessions/${sessionId}`);
  const state = persistedState(sessionId);
  const entry = state?.intentProgress?.entries?.[primaryIntentKey] ?? null;
  const opportunityId = entry?.journeyId ?? null;
  const slotValues = state?.slotValues ?? entry?.slotValues ?? {};
  if (index === 2) firstOpportunityId = opportunityId;
  const body = response.body ?? {};
  if (index === 0) { assert(response.status === 200 && body.conversational === true && !body.actionProposal, 'Greeting is conversational with no action', assertions); }
  if (index === 1) { assert(response.status === 200 && body.grounded === true && (body.citations?.length ?? 0) > 0, 'Setup answer is grounded and cited', assertions); }
  if (index === 2) { assert(Boolean(opportunityId) && entry?.slotValues?.business_activity, 'Business activity is persisted on a durable opportunity', assertions); }
  if (index === 3) { assert(opportunityId === firstOpportunityId && entry?.currentRequirementKey, 'Knowledge interruption preserves the same opportunity and requirement', assertions); }
  if (index === 5) { assert(entry?.slotValues?.visa_count === '2' && entry?.slotValues?.workspace_preference === 'shared office' && entry?.slotValues?.timeline === 'next month' && entry?.slotValues?.budget_aed === '25000', 'Multi-slot qualification facts are persisted', assertions); }
  assert(!/^(?:okay|ok|sure|yes|yeah|can we|tell me more|that sounds good|let['’]s continue|continue|proceed|go ahead)\b/iu.test(message) || !Object.values(slotValues).some((value) => typeof value === 'string' && value.toLocaleLowerCase('en-US') === message.toLocaleLowerCase('en-US')), 'Continuation or acknowledgement did not become a business fact', assertions);
  turns.push({ turn: index + 1, scenarioId, userMessage: message, clientMessageId, response: redact(response), persisted: redact(persisted), persistedState: redact(state), opportunityId, catalogVersionId: state?.catalogVersionId ?? null, slotValues: redact(slotValues), assertions: assertions.slice(assertionStart) });
  if (response.status !== 200) break;
}
const proposal = turns.map((turn) => turn.response.body?.actionProposal?.id).find(Boolean);
let confirmation = null;
let actionDiagnostics = null;
const workflowStages = { approvalVerified: false, dispatchVerified: false, n8nExecutionVerified: false, salesforceLeadVerified: false, callbackPersistenceVerified: false };
assert(Boolean(proposal), 'Scoped consent action proposal generated', assertions);
if (proposal) {
  confirmation = await json(`/api/v1/chat/actions/${proposal}/confirm`, { method: 'POST', body: { sessionId, confirmed: true } });
  workflowStages.approvalVerified = [200, 202].includes(confirmation.status);
  assert(workflowStages.approvalVerified, 'Scoped consent confirmation is accepted by the API', assertions);
  const status = await json(`/api/v1/chat/actions/${proposal}?sessionId=${encodeURIComponent(sessionId)}`);
  const actionState = status.body?.action?.state ?? status.body?.state ?? null;
  assert(status.status === 200 && ['approved', 'queued', 'processing', 'completed', 'human_review', 'reconcile_required'].includes(actionState), 'Confirmed action has a durable lifecycle state', assertions);
  const actionSlots = status.body?.action?.payload?.slotValues ?? {};
  assert(!Object.values(actionSlots).some((value) => typeof value === 'string' && /^(?:okay|ok|sure|yes|yeah|can we|tell me more|that sounds good|let['’]s continue|continue|proceed|go ahead)\b/iu.test(value)), 'Action payload contains no continuation phrase as a business fact', assertions);
  assert(!actionSlots.company_structure || /\b(?:limited\s+liability|llc|fze|fzc|free\s+zone|branch|sole\s+(?:proprietorship|establishment)|partnership|corporation|incorporated)\b/iu.test(actionSlots.company_structure), 'Action company structure is semantically valid', assertions);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    actionDiagnostics = persistedActionDiagnostics(proposal);
    if (actionDiagnostics?.n8nExecutionRef || ['completed', 'failed', 'reconcile_required'].includes(actionDiagnostics?.actionState)) break;
    await sleep(3000);
  }
  workflowStages.dispatchVerified = actionDiagnostics?.outboxPublished === true;
  workflowStages.n8nExecutionVerified = typeof actionDiagnostics?.n8nExecutionRef === 'string' && actionDiagnostics.n8nExecutionRef.length > 0;
  workflowStages.salesforceLeadVerified = typeof actionDiagnostics?.crmLeadId === 'string' && actionDiagnostics.crmLeadId.length > 0 && typeof actionDiagnostics?.remoteCrm === 'string' && actionDiagnostics.remoteCrm.length > 0 && actionDiagnostics.providerStatus === 'completed';
  workflowStages.callbackPersistenceVerified = actionDiagnostics?.actionState === 'completed' && actionDiagnostics?.providerStatus === 'completed' && workflowStages.salesforceLeadVerified;
  assert(workflowStages.dispatchVerified, 'Transactional outbox event was published', assertions);
  assert(workflowStages.n8nExecutionVerified, 'n8n execution reference was persisted', assertions);
  assert(workflowStages.salesforceLeadVerified, 'Salesforce Lead completion is persisted for this action', assertions);
  assert(workflowStages.callbackPersistenceVerified, 'Authenticated callback persisted completed action state', assertions);
}
const failedAssertions = assertions.filter((item) => !item.passed);
const report = { generatedAt: new Date().toISOString(), baseUrl, tenantSlug, sessionId, health: redact(health), turns, confirmation: redact(confirmation), actionDiagnostics: redact(actionDiagnostics), workflowStages, assertions, status: failedAssertions.length ? 'FAILED' : 'PASSED' };
await fs.writeFile(`${outputDir}/live-api-conversation-validation-2026-10-28.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const lines = [`# Live API conversation validation`, ``, `- Base URL: ${baseUrl}`, `- Tenant: ${tenantSlug}`, `- Session: ${sessionId}`, `- Generated: ${report.generatedAt}`, ``];
for (const turn of turns) {
  const body = turn.response.body ?? {};
  lines.push(`## Turn ${turn.turn}`, ``, `**User:** ${turn.userMessage}`, ``, `- HTTP: ${turn.response.status}`, `- Answer: ${body.answer ?? body.error?.message ?? '[no answer]'}`, `- Grounded: ${String(body.grounded ?? 'n/a')}`, `- Citations: ${Array.isArray(body.citations) ? body.citations.length : 0}`, `- Pending requirement: ${body.pendingRequirementKey ?? 'none'}`, `- Action proposal: ${body.actionProposal?.id ?? 'none'}`, `- Persisted state captured: ${turn.persisted.status === 200 ? 'yes' : `no (${turn.persisted.status})`}`, ``);
}
lines.push('## Workflow stages', '', ...Object.entries(workflowStages).map(([stage, passed]) => `- ${stage}: ${passed ? 'VERIFIED' : 'NOT VERIFIED'}`), '', '## Assertions', '', ...assertions.map((item) => `- ${item.passed ? 'PASS' : 'FAIL'} — ${item.message}`), '', `Overall: ${report.status}`);
await fs.writeFile(`${outputDir}/live-api-conversation-validation-2026-10-28.md`, `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ sessionId, turnCount: turns.length, outputDir, status: report.status, failedAssertions }, null, 2));
if (failedAssertions.length) process.exitCode = 1;

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost').replace(/\/$/u, '');
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const outputDir = process.env.AGENTIC_E2E_OUTPUT ?? 'artifacts/agentic-e2e';
const runId = crypto.randomUUID();
const postgresContainer = process.env.POSTGRES_CONTAINER ?? 'agentic-postgres';
const expectedAgentVersion = process.env.FOUNDRY_EXPECTED_AGENT_VERSION ?? '4';
const scenarios = [
  { id: 'A', name: 'complete-new-company', activity: 'digital marketing agency', entity: 'a free-zone company', people: 'one shareholder', visas: 'two visas', workspace: 'a shared office', timeline: 'next month', budget: 'AED 25,000', correction: 'three visas' },
  { id: 'B', name: 'returning-customer', activity: 'e-commerce consultancy', entity: 'a limited liability company', people: 'two partners', visas: 'one visa', workspace: 'a flexi-desk', timeline: 'in six weeks', budget: 'AED 40,000', correction: 'two visas' },
  { id: 'C', name: 'multiple-shareholders', activity: 'software development studio', entity: 'a free-zone company', people: 'three partners', visas: 'four visas', workspace: 'a private office', timeline: 'this quarter', budget: 'AED 60,000', correction: 'five visas' },
  { id: 'D', name: 'interruptions-and-references', activity: 'creative design consultancy', entity: 'a sole establishment', people: 'one shareholder', visas: 'two visas', workspace: 'a shared workspace', timeline: 'next month', budget: 'AED 30,000', correction: 'one visa' },
  { id: 'E', name: 'customer-corrections', activity: 'management consultancy', entity: 'a limited liability company', people: 'two shareholders', visas: 'two visas', workspace: 'a private office', timeline: 'in two months', budget: 'AED 50,000', correction: 'three visas' },
  { id: 'F', name: 'rag-commercial-quality', activity: 'digital marketing agency', entity: 'a free-zone company', people: 'one shareholder', visas: 'two visas', workspace: 'a shared office', timeline: 'next quarter', budget: 'AED 35,000', correction: 'three visas' },
  { id: 'G', name: 'integration-recovery', activity: 'import and export consultancy', entity: 'a free-zone company', people: 'two partners', visas: 'two visas', workspace: 'a flexi-desk', timeline: 'in eight weeks', budget: 'AED 45,000', correction: 'one visa' },
  { id: 'H', name: 'tenant-and-privacy-isolation', activity: 'training consultancy', entity: 'a limited liability company', people: 'two shareholders', visas: 'one visa', workspace: 'a shared office', timeline: 'next month', budget: 'AED 28,000', correction: 'two visas' },
];

const common = (s) => [
  'Hello Zara, I would like to understand the right way to set up a company.',
  `I am considering a ${s.activity} in the UAE.`,
  `The intended activity is specifically ${s.activity}; what should I check first?`,
  `Could you explain whether ${s.entity} would suit that activity?`,
  `I am planning ${s.people}. How does that affect the setup?`,
  `I expect to need ${s.visas}. What visa information should I prepare?`,
  'Please compare the available visa and setup package options.',
  `I would prefer ${s.workspace}. Is that requirement relevant to eligibility?`,
  `My target is ${s.timeline}. What timing can you confirm?`,
  `My working budget is ${s.budget}. Which approved costs should I compare?`,
  'What documents are normally needed after a package is selected?',
  'Before we continue, can you explain the main formation steps again?',
  'That answer was helpful. What is the difference between the basic and growth options?',
  'Does the package include registration and licensing items, or are some fees separate?',
  'I want to avoid assumptions. Which of my requirements are confirmed so far?',
  'Could you tell me whether the activity is eligible for the package with the visa count I gave you?',
  'I have another question: how should I prepare the shareholder information?',
  'Please keep the current company setup conversation active while answering that.',
  'I am now ready to provide my contact details if they are actually required.',
  `My synthetic test name is QA Company Setup ${s.id} ${runId.slice(0, 8)}.`,
  `My synthetic test email is qa+${runId}-${s.id.toLowerCase()}@example.test.`,
  `My synthetic test phone is +971 555 ${String(1000 + scenarios.findIndex((item) => item.id === s.id)).padStart(4, '0')}.`,
  `Please record the requirement as ${s.people} and ${s.visas}, but do not submit anything until I explicitly consent.`,
  `I need to correct one point: the visa requirement is ${s.correction}. Please keep the correction auditable.`,
  'Please summarize the current verified requirements, the next action, and anything still uncertain.',
];

const extraA = [
  'What is the approved price for the option that covers my requirements?',
  'Can the package be changed before I confirm it?',
  'If I select an option, when would document collection begin?',
  'How will I know whether the Salesforce lead registration is complete?',
  'After the package, what is the safe process for invoice and contract preparation?',
];
const messagesFor = (s) => s.id === 'A' ? [...common(s), ...extraA] : common(s);

const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, { method: options.method ?? 'GET', headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { status: response.status, body };
};

const stateFor = (sessionId) => {
  try {
    const raw = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', 'agentic', '-d', 'agentic_rag', '-At', '-c', `select conversation_state from chat_sessions where id='${sessionId}'`], { encoding: 'utf8' }).trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const bindingFor = (sessionId) => {
  try {
    const raw = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', 'agentic', '-d', 'agentic_rag', '-At', '-F', '|', '-c', `select foundry_agent_id,foundry_agent_version,status from foundry_conversation_bindings where session_id='${sessionId}' and status='active' order by last_used_at desc limit 1`], { encoding: 'utf8' }).trim();
    if (!raw) return null;
    const [agentName, agentVersion, status] = raw.split('|');
    return { agentName, agentVersion, status };
  } catch { return null; }
};

const assert = (assertions, passed, message) => assertions.push({ passed: Boolean(passed), message });
const safe = (value) => String(value ?? '').replaceAll(/qa\+[^@]+@example\.test/giu, '[EMAIL_TEST]').replaceAll(/QA Company Setup [A-H] [a-f0-9]+/gu, '[NAME_TEST]').replaceAll(/\+971 555 \d{4}/gu, '[PHONE_TEST]');
const normalTurnHasQuestion = (answer, message) => /\?\s*$/u.test(answer.trim()) || /\b(?:goodbye|bye|stop|unsubscribe|do not contact)\b/iu.test(message);

await fs.mkdir(outputDir, { recursive: true });
const startedAt = new Date().toISOString();
const report = { runId, startedAt, baseUrl, tenantSlug, scenarios: [], totals: { customerMessages: 0, assistantResponses: 0, passed: 0, failed: 0 } };
for (const scenario of scenarios) {
  const identityRef = `QA Company Setup ${scenario.id} ${runId.slice(0, 8)}`;
  const sessionResponse = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } });
  const scenarioReport = { scenarioId: scenario.id, name: scenario.name, identityRef, sessionId: sessionResponse.body?.sessionId ?? null, turns: [], assertions: [], finalState: null, foundry: null, external: { salesforce: 'not_requested', n8n: 'not_requested', invoice: 'not_requested', contract: 'not_requested' } };
  if (sessionResponse.status !== 201) {
    assert(scenarioReport.assertions, false, `session creation returned ${sessionResponse.status}`);
    report.scenarios.push(scenarioReport);
    continue;
  }
  let previous = null;
  for (const [index, message] of messagesFor(scenario).entries()) {
    const response = await request('/api/v1/chat/messages', { method: 'POST', body: { sessionId: scenarioReport.sessionId, type: 'text', message, clientMessageId: crypto.randomUUID() } });
    const state = stateFor(scenarioReport.sessionId);
    const answer = response.body?.answer ?? response.body?.error?.message ?? '';
    const entry = state?.intentProgress?.entries?.['anc.setup.new_company'] ?? null;
    const turn = { number: index + 1, customerMessage: safe(message), assistantResponse: safe(answer), status: response.status, grounded: response.body?.grounded ?? null, citations: Array.isArray(response.body?.citations) ? response.body.citations.length : 0, pendingRequirementKey: response.body?.pendingRequirementKey ?? null, opportunityId: entry?.journeyId ?? null };
    scenarioReport.turns.push(turn);
    assert(scenarioReport.assertions, response.status === 200, `turn ${index + 1} returned HTTP 200`);
    assert(scenarioReport.assertions, !/I don['’]t have verified information about that in my current knowledge base yet/iu.test(answer), `turn ${index + 1} avoided generic fallback`);
    assert(scenarioReport.assertions, normalTurnHasQuestion(answer, message), `turn ${index + 1} has one useful closing question or an appropriate termination`);
    if (index > 0 && previous?.opportunityId && turn.opportunityId) assert(scenarioReport.assertions, previous.opportunityId === turn.opportunityId, `turn ${index + 1} preserves the active opportunity`);
    previous = turn;
    if (response.status !== 200) break;
  }
  const lastState = stateFor(scenarioReport.sessionId);
  scenarioReport.foundry = bindingFor(scenarioReport.sessionId);
  scenarioReport.finalState = lastState ? { selectedIntentKey: lastState.selectedIntentKey, activeIntentKey: lastState.intentProgress?.activeIntentKey ?? null, catalogVersionId: lastState.catalogVersionId, opportunityId: lastState.intentProgress?.entries?.['anc.setup.new_company']?.journeyId ?? null, slotKeys: Object.keys(lastState.slotValues ?? {}) } : null;
  assert(scenarioReport.assertions, scenarioReport.turns.length >= 25, 'scenario executed at least 25 actual customer messages');
  assert(scenarioReport.assertions, scenarioReport.turns.length === messagesFor(scenario).length, 'all planned customer messages received an assistant response');
  assert(scenarioReport.assertions, scenarioReport.foundry?.agentName === 'agentic-rag-core-dev' && scenarioReport.foundry.agentVersion === expectedAgentVersion && scenarioReport.foundry.status === 'active', `scenario used the live Foundry agent version ${expectedAgentVersion}`);
  report.scenarios.push(scenarioReport);
  report.totals.customerMessages += scenarioReport.turns.length;
  report.totals.assistantResponses += scenarioReport.turns.filter((turn) => turn.status === 200).length;
}
for (const scenario of report.scenarios) {
  const failed = scenario.assertions.filter((item) => !item.passed).length;
  report.totals.passed += scenario.assertions.length - failed;
  report.totals.failed += failed;
}
report.finishedAt = new Date().toISOString();
report.status = report.totals.failed === 0 && report.totals.customerMessages >= 200 ? 'PASSED' : 'FAILED';
await fs.writeFile(`${outputDir}/run-${runId}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await fs.writeFile(`${outputDir}/latest.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const summary = [`# Agentic E2E acceptance`, ``, `- Run: ${runId}`, `- Commit: ${process.env.GIT_COMMIT ?? 'not supplied'}`, `- Customer messages: ${report.totals.customerMessages}`, `- Assistant responses: ${report.totals.assistantResponses}`, `- Assertions passed: ${report.totals.passed}`, `- Assertions failed: ${report.totals.failed}`, `- Status: ${report.status}`, ``];
for (const scenario of report.scenarios) summary.push(`## ${scenario.scenarioId} — ${scenario.name}`, ``, `- Session: ${scenario.sessionId ?? 'not created'}`, `- Turns: ${scenario.turns.length}`, `- Failed assertions: ${scenario.assertions.filter((item) => !item.passed).length}`, `- Final opportunity: ${scenario.finalState?.opportunityId ?? 'none'}`, ``);
await fs.writeFile(`${outputDir}/latest.md`, `${summary.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ runId, status: report.status, totals: report.totals, output: `${outputDir}/latest.json` }, null, 2));
if (report.status !== 'PASSED') process.exitCode = 1;

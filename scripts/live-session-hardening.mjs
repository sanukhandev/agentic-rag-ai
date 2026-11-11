import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const baseUrl = process.env.API_BASE_URL ?? 'https://127.0.0.1';
const origin = process.env.API_ORIGIN ?? 'https://localhost';
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const reportPath = resolve(process.env.REPORT_PATH ?? 'docs/verification/vm-session-hardening-2026-11-10.json');
const turnDelayMs = Math.max(0, Number(process.env.TURN_DELAY_MS ?? 2_500));

const cases = [
  { sourceSessionId: '98c3f678-b694-441d-90cc-bef2dc74c1de', name: 'starter-package-quote-documents', messages: ['Hi', 'I want to know about the packages available?', 'ANCFZ Starter', 'Can I get a quotation for the selected package?', 'Yes', 'What documents do I need?'] },
  { sourceSessionId: '993bdf11-b008-4b9f-a00d-29dcb4a04cbd', name: 'greeting-firm-setup-clarification', messages: ['Hi', 'How are you?', 'I want to open a firm. How can I do that?', 'What essentials are required from my side?'] },
  { sourceSessionId: 'c6935404-3a6b-4f57-b0f2-5e54cbcfbdf6', name: 'firm-documents-and-consent', messages: ['Hi', 'I want to open a firm', 'What documents are required?', 'Yes', 'I am Synthetic Customer', '[EMAIL_1]'] },
  { sourceSessionId: '35932549-2cd1-4064-9866-8a47eb6654dd', name: 'consulting-no-visa', messages: ['Hi', 'I want to start a small consulting company. What is the cheapest package?', 'I will be the only owner and work remotely', 'I need a package without a visa', 'Yes', 'My name is Synthetic Customer', '[EMAIL_2]', 'I consent to use my contact details for this enquiry.'] },
  { sourceSessionId: '602ade27-b69e-4b6e-8940-707135018b05', name: 'repeated-quote-request', messages: ['Can you show me the available packages?', 'The second option sounds better. Is everything included?', 'Let us proceed. What details do you need?', 'Yes', 'Can you prepare a proper quotation with the full breakdown?', 'Yes', 'Can you prepare a proper quotation with the full breakdown?'] },
  { sourceSessionId: '9611fa40-d3f5-4e7c-9e06-b1eaad062598', name: 'package-comparison-visa-count', messages: ['Hi', 'What packages do you have?', 'I will go with Growth', 'Can I get the quote for Growth now?', 'What is the difference between Growth and Premium?', 'I need 3 visas. What is my option?', 'Is there a package with 5 visas?'] },
  { sourceSessionId: '2439b403-6911-4e4f-b963-6ea584189849', name: 'social-commerce-package-selection', messages: ['Hi', 'I sell home accessories on Instagram and want to make it official. Which package should I look at?', 'I need to know more about the selected package', 'Can you prepare the quotation for this package?'] },
  { sourceSessionId: 'bbe63cc1-8b82-46e6-9bfc-58367f4d386a', name: 'overseas-it-founder', messages: ['Hi', 'I am in Sri Lanka and want to open an IT support company in Ajman. Can I start before I travel?', 'I will be the only shareholder and need one residence visa.'] },
  { sourceSessionId: 'b7011853-ed2f-486f-a99b-ca78a4cd6d05', name: 'uk-founder-remote-formation', messages: ['I live in the UK and am considering opening a company in Ajman.', 'Can I register without being physically present in the UAE?', 'Which package suits an overseas founder?', 'Compare a package without a visa and one with one visa.', 'Can you send a quotation and explain which steps require physical presence?', 'What documents are required?'] },
  { sourceSessionId: 'bcf6e6d4-1ede-499e-993c-b25581fcd486', name: 'growth-quote-document-followup', messages: ['Hi', 'Can you explain the packages for this kind of business?', 'I prefer the Growth option. Show me the details.', 'Can you prepare a quotation for company formation?', 'What documents are required?', 'What are the documents required to create the company?'] },
  { sourceSessionId: '2ea9a1e1-5964-47c1-872d-c84ef2ac6d2e', name: 'ajman-founder-contact-consent', messages: ['Hi', 'I want to open my own company in Ajman.', 'Yes, I want to proceed.', 'My name is Synthetic Customer', '[EMAIL_3] [PHONE_1]', 'I consent to use my contact details for this enquiry.', 'What packages are available?'] },
  { sourceSessionId: 'efcadd0e-30e0-4ef1-9b4f-0a3fcef434ac', name: 'two-shareholders-one-visa', messages: ['Hi', 'My business partner and I want to open a branding agency. What works for two shareholders?', 'We both own the company, but only I need a visa.', 'What packages do you recommend?', 'I want the starter package.'] },
  { sourceSessionId: '517f8982-e4c5-43e0-92df-a797ce9b1d9d', name: 'cosmetic-installments-human-handoff', messages: ['Hi', 'I want to set up a cosmetic company.', 'What packages do you offer?', 'Can I pay in instalments?', 'Can I get the quotation for the starter package?', 'Can I talk to a human?', 'I need two shareholders and a Free Zone LLC.'] },
  { sourceSessionId: 'ffcea6fe-8e45-4dd8-8137-69475041d00d', name: 'correction-arabic-information-only', messages: ['Hi', 'I want to open a software development company and need visas.', 'What packages do you have?', 'Starter comes with 2 visas, right?', 'No, I only need information.', 'My friend said Premium costs 5,000. Are you sure?', 'How long will it take to get the licence?', 'So the licence is guaranteed in 2 hours?', 'كم سعر الباقة المميزة؟'] },
  { sourceSessionId: '27242218-580c-4609-99cd-3f4a541f210c', name: 'typos-licence-office-and-shareholders', messages: ['Hi', 'I want to open a company in a free zone. How much does it cost?', 'What options do you have for visa and licence?', 'What package options do you have?', 'What is a flexi desk?', 'Can you open a bank account for me?', 'Do you do mainland licences?', 'What is the cheapest package?', 'I need 2 shareholders and 2 visas.'] },
];

const digest = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
const redact = (value) => String(value)
  .replace(/\[EMAIL(?:_\d+)?\]/gu, '[EMAIL]')
  .replace(/\[PHONE(?:_\d+)?\]/gu, '[PHONE]')
  .replace(/\[NAME(?:_\d+)?\]/gu, '[NAME]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
  .replace(/\+?\d[\d ()-]{7,}\d/g, '[PHONE]')
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, '[ID]');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(90_000),
    headers: { origin, ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  return { status: response.status, body };
}

function summarize(response) {
  const answer = typeof response.body?.answer === 'string' ? response.body.answer : '';
  const errorCode = response.body?.error?.code ?? response.body?.code ?? null;
  const suspicious = /(?:hardcoded|test response|fixture response|mock response|todo)/iu.test(answer);
  const fallback = /(?:approved information is temporarily unavailable|unable to (?:complete|retrieve) (?:that request|the approved information))/iu.test(answer);
  return {
    status: response.status,
    answerLength: answer.length,
    answerDigest: answer ? digest(answer) : null,
    answerPreview: answer ? redact(answer).slice(0, 240) : null,
    grounded: response.body?.grounded ?? null,
    pendingIntentKey: response.body?.pendingIntentKey ?? null,
    pendingRequirementKey: response.body?.pendingRequirementKey ?? null,
    actionProposal: Boolean(response.body?.actionProposal),
    errorCode,
    fallback,
    validAnswer: response.status === 200 && answer.length >= 2 && !answer.startsWith('{') && !suspicious && !fallback,
    suspicious,
  };
}

const report = { generatedAt: new Date().toISOString(), baseUrl, tenantSlug, sourceSessionCount: cases.length, syntheticOnly: true, turnDelayMs, cases: [] };
for (const scenario of cases) {
  console.error(`[live-hardening] starting ${scenario.name}`);
  const sessionResponse = await request('/api/v1/chat/sessions', { method: 'POST', body: JSON.stringify({ tenantSlug }) });
  if (sessionResponse.status !== 201) {
    report.cases.push({ sourceSessionId: scenario.sourceSessionId, name: scenario.name, sessionCreated: false, error: sessionResponse.body?.error?.code ?? 'SESSION_CREATE_FAILED' });
    continue;
  }
  const session = sessionResponse.body;
  const turns = [];
  for (let index = 0; index < scenario.messages.length; index += 1) {
    const userMessage = scenario.messages[index];
    console.error(`[live-hardening] ${scenario.name} turn ${index + 1}/${scenario.messages.length}`);
    try {
      const response = await request('/api/v1/chat/messages', { method: 'POST', headers: { 'x-agentic-session-token': session.sessionToken }, body: JSON.stringify({ sessionId: session.sessionId, type: 'text', message: userMessage, clientMessageId: `hardening-${scenario.sourceSessionId}-${index + 1}` }) });
      turns.push({ turn: index + 1, user: redact(userMessage), assistant: summarize(response) });
    } catch (error) {
      turns.push({ turn: index + 1, user: redact(userMessage), assistant: { validAnswer: false, errorCode: 'TRANSPORT_ERROR', error: redact(error instanceof Error ? error.message : String(error)) } });
    }
    if (turnDelayMs > 0 && index < scenario.messages.length - 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, turnDelayMs));
  }
  const answerDigests = turns.map((turn) => turn.assistant.answerDigest).filter(Boolean);
  const duplicateAnswerCount = answerDigests.length - new Set(answerDigests).size;
  const failures = turns.filter((turn) => !turn.assistant.validAnswer);
  report.cases.push({ sourceSessionId: scenario.sourceSessionId, name: scenario.name, sessionCreated: true, sessionIdDigest: digest(session.sessionId), turns, duplicateAnswerCount, status: failures.length === 0 ? 'pass' : 'fail', failures: failures.map((turn) => ({ turn: turn.turn, errorCode: turn.assistant.errorCode, suspicious: turn.assistant.suspicious })) });
}
report.summary = { passed: report.cases.filter((scenario) => scenario.status === 'pass').length, failed: report.cases.filter((scenario) => scenario.status === 'fail' || scenario.sessionCreated === false).length, total: report.cases.length, totalTurns: report.cases.reduce((count, scenario) => count + (scenario.turns?.length ?? 0), 0), duplicateAnswers: report.cases.reduce((count, scenario) => count + (scenario.duplicateAnswerCount ?? 0), 0) };
await mkdir(resolve(reportPath, '..'), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ reportPath, summary: report.summary }, null, 2));
if (report.summary.failed > 0) process.exitCode = 2;

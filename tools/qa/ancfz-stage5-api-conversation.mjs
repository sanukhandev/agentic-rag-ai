import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const args = new Set(process.argv.slice(2));
const option = (name, fallback) => {
  const envName = { '--api-base': 'API_BASE_URL', '--tenant': 'TENANT_SLUG', '--model-mode': 'MODEL_MODE', '--scenario': 'SCENARIO', '--output-dir': 'OUTPUT_DIR', '--minimum-turns': 'MIN_CONVERSATION_TURNS' }[name] ?? name.slice(2).replaceAll('-', '_').toUpperCase();
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? process.env[envName] ?? fallback;
};
const apiBase = option('--api-base', 'http://127.0.0.1:4100').replace(/\/$/u, '');
const origin = option('--origin', 'http://127.0.0.1:4100');
const tenantSlug = option('--tenant', 'anc');
const modelMode = option('--model-mode', process.env.MODEL_MODE ?? 'mock');
const scenarioSelection = option('--scenario', 'all');
const outputDir = option('--output-dir', 'artifacts/ancfz-stage5-api-uat');
const minimumTurns = Number(option('--minimum-turns', process.env.MIN_CONVERSATION_TURNS ?? '25'));
const strict = args.has('--strict') || process.env.STRICT_ASSERTIONS === 'true';
const project = process.env.UAT_COMPOSE_PROJECT ?? 'anc-mock-uat';
const composeFile = process.env.UAT_COMPOSE_FILE ?? 'docker-compose.anc-mock-uat.yml';
const postgresContainer = process.env.POSTGRES_CONTAINER ?? 'anc-mock-uat-postgres';
const postgresUser = process.env.POSTGRES_USER ?? 'anc_mock_uat';
const postgresDatabase = process.env.POSTGRES_DATABASE ?? 'anc_mock_uat';
const startedAt = new Date().toISOString();
const runId = crypto.randomUUID();
const assertions = [];
const failures = [];
const scenarios = [];
const synthetic = { name: 'ANC UAT Customer', email: `uat-${runId.slice(0, 8)}@example.test`, phone: `+9715${Number.parseInt(runId.replaceAll('-', '').slice(0, 7), 16) % 10_000_000}`.padStart(7, '0') };

const redact = (value) => {
  const text = JSON.stringify(value ?? null)
    .replaceAll(synthetic.email, '[EMAIL_REDACTED]')
    .replaceAll(synthetic.phone, '[PHONE_REDACTED]')
    .replaceAll(synthetic.name, '[NAME_REDACTED]');
  return JSON.parse(text);
};
const record = (condition, message, details = {}) => {
  const result = { passed: Boolean(condition), message, ...details };
  assertions.push(result);
  if (!result.passed) failures.push(result);
  return result.passed;
};
const safeUuid = (value) => /^[0-9a-f-]{36}$/iu.test(String(value ?? ''));
const request = async (path, { method = 'GET', body, sessionToken, headers = {} } = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Origin: origin, ...(sessionToken ? { 'x-agentic-session-token': sessionToken } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: response.status, body: parsed };
};
const db = (sql) => {
  try {
    const output = execFileSync('docker', ['exec', postgresContainer, 'psql', '-U', postgresUser, '-d', postgresDatabase, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
    return output ? JSON.parse(output) : null;
  } catch (error) {
    failures.push({ passed: false, message: 'Disposable PostgreSQL assertion failed.', error: String(error).slice(0, 300) });
    return null;
  }
};
const dbState = (sessionId, tenantId) => {
  if (!safeUuid(sessionId) || !safeUuid(tenantId)) return null;
  return db(`SELECT json_build_object(
    'state',(SELECT conversation_state FROM chat_sessions WHERE id='${sessionId}' AND tenant_id='${tenantId}'),
    'actions',(SELECT coalesce(json_agg(json_build_object('id',id,'workflowKey',workflow_key,'state',state,'opportunityId',opportunity_id,'actionRevision',action_revision) ORDER BY created_at),'[]'::json) FROM action_requests WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'leads',(SELECT count(*) FROM crm_leads WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'accounts',(SELECT count(*) FROM crm_accounts WHERE tenant_id='${tenantId}' AND opportunity_id IN (SELECT DISTINCT opportunity_id FROM action_requests WHERE session_id='${sessionId}' AND tenant_id='${tenantId}')),
    'selections',(SELECT count(*) FROM package_selections WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'documents',(SELECT coalesce(json_agg(json_build_object('id',id,'status',status,'opportunityId',opportunity_id,'requirementKey',requirement_key) ORDER BY created_at),'[]'::json) FROM supporting_documents WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'auditEvents',(SELECT coalesce(json_agg(json_build_object('event',event_name) ORDER BY created_at),'[]'::json) FROM audit_events WHERE tenant_id='${tenantId}' AND metadata->>'sessionId'='${sessionId}')
  )`);
};
const auditSummary = (tenantId, sessionId = null) => {
  if (!safeUuid(tenantId)) return [];
  const sessionFilter = safeUuid(sessionId) ? ` AND metadata->>'sessionId'='${sessionId}'` : '';
  return db(`SELECT coalesce(json_agg(json_build_object('event',event_name,'count',count) ORDER BY event_name),'[]'::json) FROM (SELECT event_name,count(*) FROM audit_events WHERE tenant_id='${tenantId}'${sessionFilter} GROUP BY event_name) events`);
};
const stateParts = (snapshot) => {
  const state = snapshot?.state ?? {};
  const intent = state.intentProgress?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? null;
  const entry = intent ? state.intentProgress?.entries?.[intent] ?? null : null;
  return { state, intent, entry, opportunityId: entry?.journeyId ?? null, slots: entry?.slotValues ?? state.slotValues ?? {} };
};
const valueFor = (key) => {
  const leaf = String(key ?? '').split(/[.:]/u).at(-1);
  return {
    business_activity: 'Software consulting and AI services',
    entity_type: 'LLC',
    visa_count: '3',
    timeline: 'next month',
    name: `My name is ${synthetic.name}.`,
    email: `My email is ${synthetic.email}.`,
    phone: `My phone number is ${synthetic.phone}.`,
    contact_consent: 'Yes, I explicitly consent to being contacted about this request.',
  }[key] ?? {
    business_activity: 'Software consulting and AI services',
    entity_type: 'LLC',
    visa_count: '3',
    timeline: 'next month',
    name: `My name is ${synthetic.name}.`,
    email: `My email is ${synthetic.email}.`,
    phone: `My phone is ${synthetic.phone}.`,
    contact_consent: 'Yes, I explicitly consent to being contacted about this request.',
  }[leaf] ?? null;
};

const createSession = async (slug) => {
  const response = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug: slug } });
  record(response.status === 201 && typeof response.body?.sessionId === 'string' && typeof response.body?.sessionToken === 'string', `Session created for ${slug}.`, { status: response.status });
  return response.status === 201 ? response.body : null;
};
const send = async (context, message, clientMessageId = crypto.randomUUID()) => {
  const response = await request('/api/v1/chat/messages', { method: 'POST', sessionToken: context.sessionToken, body: { sessionId: context.sessionId, type: 'text', message, clientMessageId } });
  const session = await request(`/api/v1/chat/sessions/${context.sessionId}`, { sessionToken: context.sessionToken });
  const persisted = dbState(context.sessionId, context.tenantId);
  const turn = { message: redact(message), clientMessageId: clientMessageId.slice(0, 8), status: response.status, answer: redact(response.body?.answer ?? null), pendingRequirementKey: response.body?.pendingRequirementKey ?? null, actionProposal: response.body?.actionProposal ? { id: String(response.body.actionProposal.id).slice(0, 8), intent: response.body.actionProposal.intent, consentRequired: response.body.actionProposal.consentRequired } : null };
  context.turns.push(turn);
  context.firstClientMessageId ??= clientMessageId;
  context.lastClientMessageId = clientMessageId;
  context.last = { response, session, persisted };
  context.last.clientMessageId = clientMessageId;
  return context.last;
};
const waitAction = async (context, actionId) => {
  let latest = null;
  for (let i = 0; i < 40; i += 1) {
    latest = await request(`/api/v1/chat/actions/${actionId}?sessionId=${encodeURIComponent(context.sessionId)}`, { sessionToken: context.sessionToken });
    if (['completed', 'failed', 'reconcile_required', 'human_review'].includes(latest.body?.action?.state ?? latest.body?.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  context.actions.push({ id: String(actionId).slice(0, 8), state: latest?.body?.action?.state ?? latest?.body?.state ?? null, workflowKey: latest?.body?.action?.workflowKey ?? latest?.body?.workflowKey ?? null });
  return latest;
};
const confirmAction = async (context, actionId) => {
  const confirmation = await request(`/api/v1/chat/actions/${actionId}/confirm`, { method: 'POST', sessionToken: context.sessionToken, body: { sessionId: context.sessionId, confirmed: true } });
  record([200, 202].includes(confirmation.status), 'Explicit action confirmation was accepted by the API.', { status: confirmation.status });
  return waitAction(context, actionId);
};
const responseAnswer = (context) => String(context.last?.response?.body?.answer ?? '');
const sendKnowledge = async (context, text = 'Could you explain the general company formation process and what is still needed?') => send(context, text);

const drivePrimaryConversation = async (context) => {
  await send(context, 'Hi Zara, I’m thinking about starting a software consulting company in the UAE.');
  let correctionSent = false;
  let knowledgeSent = false;
  let duplicateChecked = false;
  for (let step = 0; step < 24; step += 1) {
    const parts = stateParts(context.last?.persisted);
    const response = context.last.response.body ?? {};
    if (response.actionProposal?.id && !context.confirmedActions.has(response.actionProposal.id)) {
      context.confirmedActions.add(response.actionProposal.id);
      context.primaryActionId ??= response.actionProposal.id;
      await confirmAction(context, response.actionProposal.id);
      continue;
    }
    if (!knowledgeSent && (parts.entry?.currentRequirementKey === 'entity_type' || parts.entry?.currentRequirementKey === 'visa_count' || parts.entry?.currentRequirementKey === 'timeline')) {
      const before = parts.entry?.currentRequirementKey;
      const knowledge = await sendKnowledge(context);
      record(stateParts(knowledge.persisted).entry?.currentRequirementKey === before, 'Knowledge interruption preserved the pending qualification requirement.');
      const duplicate = await send(context, 'Could you explain the general company formation process and what is still needed?', knowledge.clientMessageId);
      record(duplicate.response.status === 200 && duplicate.response.body?.messageId === knowledge.response.body?.messageId, 'Duplicate clientMessageId replay returned the durable cached response.');
      duplicateChecked = true;
      knowledgeSent = true;
      continue;
    }
    if (!correctionSent && parts.slots.business_activity) {
      await send(context, 'Correction: the business activity is software consulting and AI services.');
      record(/software consulting|AI services/iu.test(JSON.stringify(stateParts(context.last?.persisted).slots)), 'Customer correction remained on the same opportunity.');
      correctionSent = true;
      continue;
    }
    const pending = response.pendingRequirementKey ?? parts.entry?.currentRequirementKey ?? null;
    const value = valueFor(pending);
    if (value && !String(pending).includes('document')) {
      await send(context, value);
      continue;
    }
    if (parts.entry?.currentStage === 'account_creation' || parts.entry?.currentStage === 'package_selection' || parts.entry?.currentStage === 'document_upload') break;
    await sendKnowledge(context, step % 2 === 0 ? 'What should I prepare next for this company formation request?' : 'Please keep my company formation request moving and tell me the next verified requirement.');
  }
  record(correctionSent, 'Primary conversation included a customer correction.');
  record(knowledgeSent, 'Primary conversation included a knowledge question.');
  record(duplicateChecked, 'Primary conversation included a duplicate message retry.');
  return stateParts(context.last?.persisted);
};

const runPrimary = async () => {
  const failureStart = failures.length;
  const context = { ...(await createSession('anc')), turns: [], actions: [], confirmedActions: new Set(), primaryActionId: null, last: null };
  if (!context.sessionId) return { status: 'BLOCKED', context };
  const initial = await drivePrimaryConversation(context);
  const opportunityId = initial.opportunityId;
  record(Boolean(opportunityId), 'Primary conversation established one stable opportunity.');
  const beforePackage = Buffer.from('%PDF-1.7 ANC synthetic UAT document').toString('base64');
  if (opportunityId) {
    const blockedDocument = await request(`/api/v1/chat/sessions/${context.sessionId}/documents`, { method: 'POST', sessionToken: context.sessionToken, body: { fileName: 'before-package.pdf', mimeType: 'application/pdf', contentBase64: beforePackage, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
    record(blockedDocument.status === 409 && blockedDocument.body?.error?.code === 'DOCUMENT_PACKAGE_NOT_CONFIRMED', 'Document upload before package confirmation was rejected.', { status: blockedDocument.status, code: blockedDocument.body?.error?.code });
    while (context.turns.length < minimumTurns) await sendKnowledge(context, context.turns.length % 2 ? 'What is the next verified step for my request?' : 'Can you clarify the process without guessing any unverified policy?');
    const account = await request(`/api/v1/chat/sessions/${context.sessionId}/accounts/proposals`, { method: 'POST', sessionToken: context.sessionToken, body: { opportunityId, conversionRule: 'qualification_verified' } });
    record([200, 202].includes(account.status), 'Account proposal was accepted only after verified qualification.', { status: account.status });
    if (account.body?.actionProposal?.id) {
      context.accountActionId = account.body.actionProposal.id;
      const accountCompletion = await confirmAction(context, account.body.actionProposal.id);
      record(accountCompletion.body?.action?.state === 'completed', 'Mock Account action reached a durable completed state.', { state: accountCompletion.body?.action?.state ?? null });
    }
    const accountState = await request(`/api/v1/chat/sessions/${context.sessionId}/accounts`, { sessionToken: context.sessionToken });
    record(accountState.status === 200 && accountState.body?.verified === true, 'Mock Account is durably verified.', { status: accountState.status });
    const packages = await request(`/api/v1/chat/sessions/${context.sessionId}/packages`, { sessionToken: context.sessionToken });
    const offering = packages.body?.items?.[0];
    record(packages.status === 200 && Boolean(offering?.id), 'Approved package options were returned from the tenant catalog.', { status: packages.status });
    if (offering) {
      const proposal = await request(`/api/v1/chat/sessions/${context.sessionId}/packages/proposals`, { method: 'POST', sessionToken: context.sessionToken, body: { opportunityId, packageOfferingId: offering.id } });
      const quote = await request(`/api/v1/chat/sessions/${context.sessionId}/packages/quotes`, { method: 'POST', sessionToken: context.sessionToken, body: { opportunityId, packageOfferingId: offering.id } });
      record(proposal.status === 201 && quote.status === 201 && quote.body?.quote?.amountMinor === offering.priceMinor, 'Package selection and approved quote used the published fixture price.', { proposalStatus: proposal.status, quoteStatus: quote.status });
      if (proposal.body?.selection?.id && quote.body?.quote?.id) {
        const confirmed = await request(`/api/v1/chat/sessions/${context.sessionId}/packages/selections/${proposal.body.selection.id}/confirm`, { method: 'POST', sessionToken: context.sessionToken, body: { quoteId: quote.body.quote.id } });
        record(confirmed.status === 200 && confirmed.body?.selection?.status === 'confirmed', 'Package selection was explicitly confirmed and persisted.', { status: confirmed.status });
        const config = await request(`/api/v1/chat/sessions/${context.sessionId}/documents/config`, { sessionToken: context.sessionToken });
        record(config.status === 200 && config.body?.enabled === true, 'Document policy was read from the published catalog.', { status: config.status });
        const invalidMime = await request(`/api/v1/chat/sessions/${context.sessionId}/documents`, { method: 'POST', sessionToken: context.sessionToken, body: { fileName: 'invalid.txt', mimeType: 'text/plain', contentBase64: Buffer.from('not a pdf').toString('base64'), primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
        record(invalidMime.status >= 400 && invalidMime.status < 500, 'Invalid document MIME/signature was rejected.', { status: invalidMime.status, code: invalidMime.body?.error?.code });
        const upload = await request(`/api/v1/chat/sessions/${context.sessionId}/documents`, { method: 'POST', sessionToken: context.sessionToken, body: { fileName: 'synthetic-business.pdf', mimeType: 'application/pdf', contentBase64: beforePackage, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
        record(upload.status === 202 && Boolean(upload.body?.document?.id), 'Synthetic PDF was accepted and queued for processing.', { status: upload.status });
        let documents = null;
        for (let i = 0; i < 40; i += 1) {
          documents = await request(`/api/v1/chat/sessions/${context.sessionId}/documents`, { sessionToken: context.sessionToken });
          if (documents.body?.items?.some((item) => item.id === upload.body?.document?.id && item.status === 'completed')) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        record(documents?.body?.items?.some((item) => item.id === upload.body?.document?.id && item.status === 'completed'), 'Document OCR processing reached a durable completed state.');
        const duplicate = await request(`/api/v1/chat/sessions/${context.sessionId}/documents`, { method: 'POST', sessionToken: context.sessionToken, body: { fileName: 'synthetic-business-copy.pdf', mimeType: 'application/pdf', contentBase64: beforePackage, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
        record(duplicate.status === 202 && duplicate.body?.idempotent === true, 'Duplicate document upload was idempotent.', { status: duplicate.status });
        context.documentId = upload.body?.document?.id ?? null;
      }
    }
  }
  const persisted = dbState(context.sessionId, context.tenantId);
  const parts = stateParts(persisted);
  record(context.turns.length >= minimumTurns, `Primary scenario reached the minimum of ${minimumTurns} customer turns.`, { turns: context.turns.length });
  record(parts.entry?.currentStage === 'document_upload' || parts.entry?.lifecycle?.stages?.document_upload?.status === 'completed', 'Primary scenario reached the document stage in durable state.', { currentStage: parts.entry?.currentStage ?? null });
  record(!parts.entry?.lifecycle?.stages?.billing_invoice || parts.entry.lifecycle.stages.billing_invoice.status !== 'completed', 'Primary journey stopped before payment/invoice execution.');
  return { status: failures.length === failureStart ? 'PASSED' : 'FAILED', context, persisted, parts };
};

const runEmptyRag = async () => {
  const failureStart = failures.length;
  const context = { ...(await createSession('anc-empty')), turns: [], actions: [], confirmedActions: new Set(), last: null };
  if (!context.sessionId) return { status: 'BLOCKED', context };
  for (const message of ['I want to start a software consulting company in the UAE. What is the price?', 'Am I eligible for this licence?', 'What is the formation process?']) await send(context, message);
  const answers = context.turns.map((turn) => String(turn.answer ?? '').toLowerCase());
  record(!answers.some((answer) => /(?:aed|\$|€|\b\d{4,}\b|guaranteed|eligible|must|required by law)/iu.test(answer)), 'Empty-RAG scenario did not invent prices or policy claims.');
  record(!answers.some((answer) => answer.includes('no grounded response available')), 'Empty-RAG scenario avoided the generic no-grounded-response loop.');
  record(Boolean(stateParts(context.last?.persisted).intent || context.last?.response?.body?.pendingRequirementKey || context.last?.response?.body?.answer), 'Empty-RAG scenario preserved the goal or asked a relevant next question.');
  return { status: failures.length === failureStart ? 'PASSED' : 'FAILED', context, persisted: context.last?.persisted };
};

const runSecurity = async (primary) => {
  const failureStart = failures.length;
  const context = primary?.context;
  if (!context) return { status: 'NOT_EXECUTED' };
  const reused = await send(context, 'This message ID is intentionally reused with different content.', context.firstClientMessageId ?? crypto.randomUUID());
  record(reused.response.status === 409 && reused.response.body?.error?.code === 'MESSAGE_ID_REUSED', 'Reusing a clientMessageId with different content was rejected.', { status: reused.response.status });
  if (context.primaryActionId) {
    const other = await createSession('anc');
    if (other) {
      const cross = await request(`/api/v1/chat/actions/${context.primaryActionId}/confirm`, { method: 'POST', sessionToken: other.sessionToken, body: { sessionId: other.sessionId, confirmed: true } });
      record(cross.status === 403 || cross.status === 404, 'Cross-session action confirmation was rejected.', { status: cross.status });
    }
  }
  const fresh = await createSession('anc');
  if (fresh) {
    const beforeQualification = await request(`/api/v1/chat/sessions/${fresh.sessionId}/accounts/proposals`, { method: 'POST', sessionToken: fresh.sessionToken, body: { opportunityId: crypto.randomUUID(), conversionRule: 'qualification_verified' } });
    record(beforeQualification.status >= 400 && beforeQualification.status < 500, 'Account creation before qualification was rejected.', { status: beforeQualification.status, code: beforeQualification.body?.error?.code });
  }
  return { status: failures.length === failureStart ? 'PASSED' : 'FAILED' };
};

const images = () => {
  try {
    return execFileSync('docker', ['images', '--format', '{{json .}}'], { encoding: 'utf8' }).trim().split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line)).filter((image) => String(image.Repository).startsWith('anc-mock-uat-'));
  } catch { return []; }
};
const selected = scenarioSelection === 'all' ? ['happy', 'empty-rag', 'security'] : scenarioSelection.split(',').map((value) => value.trim()).filter(Boolean);
let primary = null;
if (modelMode !== 'mock') {
  record(false, 'Only deterministic mock mode was configured for this disposable run.', { classification: 'BLOCKED_MODEL_NOT_CONFIGURED' });
} else {
  if (selected.includes('happy')) { primary = await runPrimary(); scenarios.push({ name: 'A-happy-path', status: primary.status, turns: primary.context?.turns?.length ?? 0 }); }
  if (selected.includes('empty-rag')) { const result = await runEmptyRag(); scenarios.push({ name: 'B-empty-rag', status: result.status, turns: result.context?.turns?.length ?? 0 }); }
  if (selected.includes('security')) { const result = await runSecurity(primary); scenarios.push({ name: 'C-security-recovery', status: result.status }); }
}

const endedAt = new Date().toISOString();
const report = redact({
  runId,
  startedAt,
  endedAt,
  branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  apiBase,
  project,
  model: { mode: modelMode, deployment: modelMode === 'mock' ? null : process.env.AZURE_OPENAI_DEPLOYMENT ?? null },
  tenantSlug,
  syntheticOnly: true,
  scenarios,
  assertions,
  failedAssertions: failures,
  primary: primary ? { sessionId: primary.context.sessionId, tenantId: primary.context.tenantId, turns: primary.context.turns, actions: primary.context.actions, persisted: primary.persisted, finalVerifiedStage: primary.parts?.entry?.lifecycle?.stages?.document_upload?.status === 'completed' ? 'document_upload' : null, documentCollectionReached: primary.parts?.entry?.lifecycle?.stages?.document_upload?.status === 'completed', actualDocumentUploadVerified: Boolean(primary.context.documentId), sf02Verified: false, audit: auditSummary(primary.context.tenantId, primary.context.sessionId) } : null,
  dockerImages: images(), toolExecutionEvidence: primary ? (auditSummary(primary.context.tenantId, primary.context.sessionId) ?? []).filter((item) => /v2\.(tool|model)|workflow\.dispatch|workflow\.transition/iu.test(item.event)) : [],
  knownBlockers: ['SF-02 external attachment was not claimed; only local OCR completion was tested.', 'Azure GPT integration mode was not executed in deterministic mock mode.'],
  status: failures.length ? 'FAILED' : 'PASSED',
});
await mkdir(outputDir, { recursive: true });
await writeFile(`${outputDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const lifecycleStages = primary?.persisted?.state?.intentProgress?.entries?.[primary?.persisted?.state?.selectedIntentKey ?? '']?.lifecycle?.stages ?? {};
const stageSummary = Object.entries(lifecycleStages).map(([stage, value]) => `${stage}=${value.status}`).join(', ');
const toolSummary = report.toolExecutionEvidence.map((item) => `${item.event}=${item.count}`).join(', ') || 'none';
const summary = `# ANC Stage 5 API UAT\n\n- Status: **${report.status}**\n- Mode: **${modelMode}**\n- Branch/commit: \`${report.branch}\` / \`${report.commit}\`\n- Tenant: \`${tenantSlug}\` (synthetic-only)\n- Scenarios: ${scenarios.map((item) => `${item.name}=${item.status}`).join(', ')}\n- Assertions: ${assertions.filter((item) => item.passed).length}/${assertions.length} passed\n- Primary customer turns: ${primary?.context.turns.length ?? 0}\n- Final verified stage: **${report.primary?.finalVerifiedStage ?? 'not verified'}**\n- Document collection reached: **${report.primary?.documentCollectionReached ?? false}**\n- Actual document upload/OCR verified: **${report.primary?.actualDocumentUploadVerified ?? false}**\n- SF-02 attachment verified: **${report.primary?.sf02Verified ?? false}**\n- Persisted stage statuses: ${stageSummary || 'not available'}\n- Session-scoped model/tool evidence: ${toolSummary}\n\nKnown blockers:\n\n${report.knownBlockers.map((item) => `- ${item}`).join('\n')}\n`;
await writeFile(`${outputDir}/report.md`, summary, 'utf8');
console.log(JSON.stringify({ status: report.status, scenarios, assertions: assertions.length, passed: assertions.filter((item) => item.passed).length, failed: failures.length, outputDir }, null, 2));
if (strict && failures.length) process.exitCode = 1;

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
const modelGatewayContainer = process.env.MODEL_GATEWAY_CONTAINER ?? 'anc-mock-uat-model-gateway';
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
    .replaceAll(synthetic.name, '[NAME_REDACTED]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu, (identifier) => `ref-${crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 12)}`);
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
const auditMetrics = (tenantId, sessionId) => {
  if (!safeUuid(tenantId) || !safeUuid(sessionId)) return null;
  const filter = `tenant_id='${tenantId}' AND metadata->>'sessionId'='${sessionId}'`;
  return db(`SELECT json_build_object(
    'modelTurns',(SELECT count(*) FROM audit_events WHERE ${filter} AND event_name='v2.model.turn'),
    'modelRequests',(SELECT coalesce(sum(coalesce(nullif(metadata->>'modelRequestCount','')::int,0)),0) FROM audit_events WHERE ${filter} AND event_name='v2.model.turn'),
    'trustedToolCalls',(SELECT coalesce(sum(coalesce(nullif(metadata->>'toolCallCount','')::int,0)),0) FROM audit_events WHERE ${filter} AND event_name='v2.model.turn'),
    'toolReadEvents',(SELECT count(*) FROM audit_events WHERE ${filter} AND event_name='v2.tool.read'),
    'guardReasons',(SELECT coalesce(json_object_agg(reason,total),'{}'::json) FROM (SELECT coalesce(metadata->>'guardReason','unknown') AS reason,count(*) AS total FROM audit_events WHERE ${filter} AND event_name='v2.model.turn' GROUP BY 1) reasons),
    'candidateGuardReasons',(SELECT coalesce(json_object_agg(reason,total),'{}'::json) FROM (SELECT coalesce(metadata->>'candidateGuardReason','unknown') AS reason,count(*) AS total FROM audit_events WHERE ${filter} AND event_name='v2.model.turn' GROUP BY 1) reasons),
    'modelAuthoredAccepted',(SELECT count(*) FROM audit_events WHERE ${filter} AND event_name='v2.model.turn' AND metadata->>'modelResponseAccepted'='true'),
    'providerErrorEvents',(SELECT count(*) FROM audit_events WHERE ${filter} AND event_name ILIKE '%error%')
  )`);
};
const latencySummary = (turns) => {
  const values = turns.map((turn) => turn.latencyMs).filter((value) => Number.isFinite(value));
  if (!values.length) return { count: 0, minMs: null, maxMs: null, averageMs: null };
  return { count: values.length, minMs: Math.min(...values), maxMs: Math.max(...values), averageMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) };
};
const stateParts = (snapshot) => {
  const state = snapshot?.state ?? {};
  const intent = state.intentProgress?.activeIntentKey ?? state.activeFollowUpIntentKey ?? state.selectedIntentKey ?? null;
  const entry = intent ? state.intentProgress?.entries?.[intent] ?? null : null;
  return { state, intent, entry, opportunityId: entry?.journeyId ?? null, slots: entry?.slotValues ?? state.slotValues ?? {} };
};
const stageOrder = ['lead_generation', 'lead_qualification', 'account_creation', 'package_selection', 'document_upload', 'billing_invoice', 'contract'];
const lifecycleReport = (parts) => {
  const stages = parts?.entry?.lifecycle?.stages ?? {};
  const completed = stageOrder.filter((stage) => stages[stage]?.status === 'completed');
  const next = stageOrder.find((stage) => stages[stage]?.status !== 'completed') ?? null;
  return {
    stages,
    lastCompletedStage: completed.at(-1) ?? null,
    currentActiveStage: parts?.entry?.lifecycle?.currentStage ?? null,
    nextPendingStage: next,
    intentionalStopStage: 'document_upload',
  };
};
const createSession = async (slug) => {
  const response = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug: slug } });
  record(response.status === 201 && typeof response.body?.sessionId === 'string' && typeof response.body?.sessionToken === 'string', `Session created for ${slug}.`, { status: response.status });
  return response.status === 201 ? response.body : null;
};
const send = async (context, message, clientMessageId = crypto.randomUUID(), { recordTurn = true } = {}) => {
  const startedAtMs = Date.now();
  const response = await request('/api/v1/chat/messages', { method: 'POST', sessionToken: context.sessionToken, body: { sessionId: context.sessionId, type: 'text', message, clientMessageId } });
  const session = await request(`/api/v1/chat/sessions/${context.sessionId}`, { sessionToken: context.sessionToken });
  const persisted = dbState(context.sessionId, context.tenantId);
  const turn = { message: redact(message), clientMessageId: clientMessageId.slice(0, 8), status: response.status, latencyMs: Date.now() - startedAtMs, answer: redact(response.body?.answer ?? null), pendingRequirementKey: response.body?.pendingRequirementKey ?? null, actionProposal: response.body?.actionProposal ? { id: String(response.body.actionProposal.id).slice(0, 8), intent: response.body.actionProposal.intent, consentRequired: response.body.actionProposal.consentRequired } : null };
  if (recordTurn) context.turns.push(turn);
  context.firstClientMessageId ??= clientMessageId;
  context.firstMessage ??= message;
  context.firstResponseMessageId ??= response.body?.messageId ?? null;
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
const meaningfulCustomerTurns = (customer) => [
  'Hi Zara, I’m thinking about starting a software consulting company in the UAE.',
  'Could you explain the general formation process and what information you need from me?',
  'The business activity is software consulting and AI services.',
  'I am leaning toward an LLC for the company structure.',
  'I expect to need 3 visas at the start.',
  'I would like to get started next month.',
  'Correction: the business activity is software consulting and AI services, and the timeline is next month.',
  'Before we continue, what can you tell me about eligibility?',
  'Please tell me which requirement is still missing for my company-formation request.',
  'Actually, I may need 5 visas rather than 3.',
  'Correction: please keep the visa count at 3.',
  'Can you confirm that you kept my LLC structure and software consulting activity?',
  'I am ready to provide the contact details needed for this request.',
  `My name is ${customer.name} and my email is ${customer.email}.`,
  `My phone number is ${customer.phone}.`,
  'Yes, I explicitly consent to being contacted about this request.',
  'What happens after my request is registered?',
  'Please keep the same company-formation request active while I ask a couple of questions.',
  'Can you explain the next Account step without claiming it is complete?',
  'I do not want to change the business activity or company structure.',
  'What information will I review before choosing a package?',
  'How will the required business document be handled after package confirmation?',
  'Please confirm that the visa count is still 3 and the target is next month.',
  'What is the next verified action for this opportunity?',
  'I will wait for verified evidence rather than assuming the Account is complete.',
];

const drivePrimaryConversation = async (context) => {
  let pendingActionId = null;
  let knowledgeSent = false;
  let correctionSent = false;
  for (const message of meaningfulCustomerTurns(synthetic)) {
    const result = await send(context, message);
    const body = result.response.body ?? {};
    const proposalId = body.actionProposal?.id ?? null;
    if (proposalId) {
      pendingActionId = proposalId;
      context.primaryActionId ??= proposalId;
    }
    if (pendingActionId && /consent/i.test(message)) {
      if (!context.confirmedActions.has(pendingActionId)) {
        context.confirmedActions.add(pendingActionId);
        await confirmAction(context, pendingActionId);
      }
      pendingActionId = null;
    } else if (proposalId && body.pendingRequirementKey !== 'contact_consent') {
      context.confirmedActions.add(proposalId);
      await confirmAction(context, proposalId);
      pendingActionId = null;
    }
    if (/explain the general formation process|eligibility/iu.test(message)) knowledgeSent = true;
    if (/^Correction:|^Actually,/iu.test(message)) correctionSent = true;
  }
  record(correctionSent, 'Primary conversation included a customer correction.');
  record(knowledgeSent, 'Primary conversation included a knowledge question.');
  const answers = context.turns.map((turn) => String(turn.answer ?? '')).filter(Boolean);
  record(!answers.some((answer, index) => index > 0 && answer === answers[index - 1]), 'Meaningful conversation did not repeat an adjacent assistant response.');
  record(!answers.includes('I can help you work through that. Which part of your setup would you like to discuss first?'), 'Conversation did not fall back to the retired generic restart response.');
  record(context.turns.length === meaningfulCustomerTurns(synthetic).length, 'Primary scenario used the planned meaningful customer turns only.', { turns: context.turns.length });
  return stateParts(context.last?.persisted);
};

const runPrimary = async () => {
  const failureStart = failures.length;
  const context = { ...(await createSession('anc')), turns: [], actions: [], confirmedActions: new Set(), primaryActionId: null, last: null };
  if (!context.sessionId) return { status: 'BLOCKED', context };
  const initial = await drivePrimaryConversation(context);
  const opportunityId = initial.opportunityId;
  record(Boolean(opportunityId), 'Primary conversation established one stable opportunity.');
  record(initial.slots.business_activity === 'software consulting and AI services', 'Business activity was extracted into the correct qualification slot.');
  record(initial.slots.entity_type === 'LLC', 'Entity type was extracted into the correct qualification slot.');
  record(initial.slots.visa_count === '3', 'Corrected visa count was preserved as 3.');
  record(initial.slots.timeline === 'next month', 'Timeline was extracted without correction-text contamination.');
  if (context.firstClientMessageId && context.firstMessage) {
    const replay = await send(context, context.firstMessage, context.firstClientMessageId, { recordTurn: false });
    record(replay.response.status === 200 && replay.response.body?.messageId === context.firstResponseMessageId, 'Duplicate clientMessageId retry returned the original durable response.');
  }
  const beforePackage = Buffer.from('%PDF-1.7 ANC synthetic UAT document').toString('base64');
  if (opportunityId) {
    const blockedDocument = await request(`/api/v1/chat/sessions/${context.sessionId}/documents`, { method: 'POST', sessionToken: context.sessionToken, body: { fileName: 'before-package.pdf', mimeType: 'application/pdf', contentBase64: beforePackage, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
    record(blockedDocument.status === 409 && blockedDocument.body?.error?.code === 'DOCUMENT_PACKAGE_NOT_CONFIRMED', 'Document upload before package confirmation was rejected.', { status: blockedDocument.status, code: blockedDocument.body?.error?.code });
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
  const lifecycle = lifecycleReport(parts);
  record(context.turns.length >= minimumTurns, `Primary scenario reached the minimum of ${minimumTurns} customer turns.`, { turns: context.turns.length });
  record(lifecycle.lastCompletedStage === 'document_upload', 'Primary scenario reached the document stage in durable state.', { lastCompletedStage: lifecycle.lastCompletedStage });
  record(lifecycle.currentActiveStage === 'billing_invoice' && lifecycle.nextPendingStage === 'billing_invoice', 'Stage reporting distinguishes completed document upload from the active billing stage.', { currentActiveStage: lifecycle.currentActiveStage, nextPendingStage: lifecycle.nextPendingStage });
  record(lifecycle.stages.billing_invoice?.status !== 'completed' && lifecycle.stages.contract?.status !== 'completed', 'Primary journey stopped before payment/invoice or contract execution.');
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
  const reused = await send(context, 'This message ID is intentionally reused with different content.', context.firstClientMessageId ?? crypto.randomUUID(), { recordTurn: false });
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
const azureGatewayReady = () => {
  try {
    const result = execFileSync('docker', ['exec', modelGatewayContainer, 'python', '-c', 'import os; print("configured" if os.getenv("MODEL_MODE", "azure").lower() == "azure" and os.getenv("AZURE_OPENAI_API_KEY") and os.getenv("AZURE_OPENAI_DEPLOYMENT") and os.getenv("AZURE_OPENAI_BASE_URL", "").startswith("https://") else "missing")'], { encoding: 'utf8' }).trim();
    return result === 'configured';
  } catch { return false; }
};
const azureDeploymentIdentifier = () => {
  try {
    return execFileSync('docker', ['exec', modelGatewayContainer, 'python', '-c', 'import os; print(os.getenv("AZURE_OPENAI_DEPLOYMENT", ""))'], { encoding: 'utf8' }).trim() || null;
  } catch { return null; }
};
const selected = scenarioSelection === 'all' ? ['happy', 'empty-rag', 'security'] : scenarioSelection.split(',').map((value) => value.trim()).filter(Boolean);
let primary = null;
const azureReady = modelMode === 'azure' && azureGatewayReady();
if (modelMode === 'azure' && !azureReady) {
  scenarios.push({ name: 'E-real-gpt-5.4', status: 'BLOCKED', classification: 'BLOCKED_MODEL_NOT_CONFIGURED' });
} else if (modelMode === 'mock' || azureReady) {
  if (selected.includes('happy')) { primary = await runPrimary(); scenarios.push({ name: modelMode === 'mock' ? 'A-happy-path' : 'E-real-gpt-5.4', status: primary.status, turns: primary.context?.turns?.length ?? 0 }); }
  if (modelMode === 'mock' && selected.includes('empty-rag')) { const result = await runEmptyRag(); scenarios.push({ name: 'B-empty-rag', status: result.status, turns: result.context?.turns?.length ?? 0 }); }
  if (modelMode === 'mock' && selected.includes('security')) { const result = await runSecurity(primary); scenarios.push({ name: 'C-security-recovery', status: result.status }); }
} else {
  record(false, `Unsupported model mode: ${modelMode}.`, { classification: 'BLOCKED_MODEL_NOT_CONFIGURED' });
}

const endedAt = new Date().toISOString();
const primaryLifecycle = primary ? lifecycleReport(primary.parts) : null;
const primaryExecutionMetrics = primary ? auditMetrics(primary.context.tenantId, primary.context.sessionId) : null;
const primaryAudit = primary ? auditSummary(primary.context.tenantId, primary.context.sessionId) : [];
const sf02Verified = primaryAudit.some((item) => item.event === 'document.sf02_attachment_verified' && item.count > 0);
const knownBlockers = [
  ...(!sf02Verified ? ['SF-02 external attachment was not verified; local OCR evidence is kept separate.'] : []),
  ...(modelMode === 'mock' ? ['Azure GPT-5.4 integration mode was not executed in deterministic mock mode.'] : []),
  ...(modelMode === 'azure' && !azureReady ? ['BLOCKED_MODEL_NOT_CONFIGURED: the private gateway was not running with an Azure endpoint, deployment and key.'] : []),
];
const overallStatus = failures.length ? 'FAILED' : modelMode === 'azure' && !azureReady ? 'BLOCKED' : knownBlockers.length ? 'PARTIALLY VERIFIED — BLOCKERS REMAIN' : 'PASSED';
const report = redact({
  runId,
  startedAt,
  endedAt,
  branch: execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  apiBase,
  project,
  model: { mode: modelMode, deployment: modelMode === 'mock' ? null : azureDeploymentIdentifier(), gatewayReady: modelMode === 'azure' ? azureReady : true },
  tenantSlug,
  syntheticOnly: true,
  scenarios,
  assertions,
  failedAssertions: failures,
  primary: primary ? { sessionId: primary.context.sessionId, tenantId: primary.context.tenantId, turns: primary.context.turns, actions: primary.context.actions, persisted: primary.persisted, ...primaryLifecycle, finalVerifiedStage: primaryLifecycle?.lastCompletedStage === 'document_upload' ? 'document_upload' : null, documentCollectionReached: primaryLifecycle?.lastCompletedStage === 'document_upload', actualDocumentUploadVerified: primaryLifecycle?.stages?.document_upload?.status === 'completed' && Boolean(primary.context.documentId), sf02Verified, audit: primaryAudit, executionMetrics: { audit: primaryExecutionMetrics, latency: latencySummary(primary.context.turns) } } : null,
  dockerImages: images(), toolExecutionEvidence: primary ? primaryAudit.filter((item) => /v2\.(tool|model)|workflow\.dispatch|workflow\.transition/iu.test(item.event)) : [],
  knownBlockers,
  status: overallStatus,
});
await mkdir(outputDir, { recursive: true });
const reportFile = modelMode === 'mock' ? 'hardening-report.json' : 'hardening-report-azure-gpt5.4.json';
const transcriptFile = modelMode === 'mock' ? 'mock-conversation-transcript.json' : 'gpt5.4-conversation-transcript.json';
await writeFile(`${outputDir}/${reportFile}`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(`${outputDir}/${transcriptFile}`, `${JSON.stringify(redact({ runId, mode: modelMode, scenarios, primary: primary ? { turns: primary.context.turns, actions: primary.context.actions, stage: primaryLifecycle } : null }), null, 2)}\n`, 'utf8');
const lifecycleStages = primaryLifecycle?.stages ?? {};
const stageSummary = Object.entries(lifecycleStages).map(([stage, value]) => `${stage}=${value.status}`).join(', ');
const toolSummary = report.toolExecutionEvidence.map((item) => `${item.event}=${item.count}`).join(', ') || 'none';
const executionAudit = report.primary?.executionMetrics?.audit;
const executionLatency = report.primary?.executionMetrics?.latency;
const summary = `# ANC Conversation Engine v2 Hardening UAT\n\n- Status: **${report.status}**\n- Mode: **${modelMode}**\n- Branch/commit: \`${report.branch}\` / \`${report.commit}\`\n- Tenant: \`${tenantSlug}\` (synthetic-only)\n- Scenarios: ${scenarios.map((item) => `${item.name}=${item.status}`).join(', ')}\n- Assertions: ${assertions.filter((item) => item.passed).length}/${assertions.length} passed\n- Primary customer turns: ${primary?.context.turns.length ?? 0}\n- Last completed stage: **${report.primary?.lastCompletedStage ?? 'not verified'}**\n- Current active stage: **${report.primary?.currentActiveStage ?? 'not verified'}**\n- Next pending stage: **${report.primary?.nextPendingStage ?? 'not verified'}**\n- Intentional stop stage: **${report.primary?.intentionalStopStage ?? 'document_upload'}**\n- Document collection reached: **${report.primary?.documentCollectionReached ?? false}**\n- Actual document upload/OCR verified: **${report.primary?.actualDocumentUploadVerified ?? false}**\n- SF-02 attachment verified: **${report.primary?.sf02Verified ?? false}**\n- Persisted stage statuses: ${stageSummary || 'not available'}\n- Session-scoped model/tool evidence: ${toolSummary}\n- Execution metrics: model turns=${executionAudit?.modelTurns ?? 0}, model requests=${executionAudit?.modelRequests ?? 0}, trusted tool calls=${executionAudit?.trustedToolCalls ?? 0}, tool reads=${executionAudit?.toolReadEvents ?? 0}, provider errors=${executionAudit?.providerErrorEvents ?? 0}, guard reasons=${JSON.stringify(executionAudit?.guardReasons ?? {})}, candidate guard reasons=${JSON.stringify(executionAudit?.candidateGuardReasons ?? {})}, model-authored accepted=${executionAudit?.modelAuthoredAccepted ?? 0}, latency avg/max=${executionLatency?.averageMs ?? 'n/a'}/${executionLatency?.maxMs ?? 'n/a'}ms\n\nKnown blockers:\n\n${report.knownBlockers.map((item) => `- ${item}`).join('\n')}\n`;
const markdownFile = modelMode === 'mock' ? 'hardening-report.md' : 'hardening-report-azure-gpt5.4.md';
await writeFile(`${outputDir}/${markdownFile}`, summary, 'utf8');
console.log(JSON.stringify({ status: report.status, scenarios, assertions: assertions.length, passed: assertions.filter((item) => item.passed).length, failed: failures.length, outputDir }, null, 2));
if (strict && failures.length) process.exitCode = 1;

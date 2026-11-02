import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const apiBase = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/u, '');
const project = process.env.UAT_COMPOSE_PROJECT ?? 'anc-mock-uat';
const composeFile = process.env.UAT_COMPOSE_FILE ?? 'docker-compose.anc-mock-uat.yml';
const outputPath = process.env.RESTART_REPLAY_OUTPUT ?? 'artifacts/gate3/restart-replay/report.json';
const internalSecret = process.env.N8N_WEBHOOK_SECRET ?? 'anc-mock-uat-n8n-secret';
const checks = [];
const runId = crypto.randomUUID();
const startedAt = new Date().toISOString();
const syntheticEmail = `restart-${runId.slice(0, 8)}@example.test`;
const syntheticPhone = `+9715${Number.parseInt(runId.replaceAll('-', '').slice(0, 7), 16) % 10_000_000}`.padStart(7, '0');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ref = (value) => value ? `ref-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}` : null;
const check = (name, passed, details = {}) => { checks.push({ name, passed: Boolean(passed), ...details }); return passed; };

const request = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  try {
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json', Origin: apiBase, ...(token ? { 'x-agentic-session-token': token } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { status: response.status, body: parsed };
  } catch (error) {
    return { status: 0, body: { error: { code: 'NETWORK_UNAVAILABLE', detail: error instanceof Error ? error.name : 'request_failed' } } };
  }
};

const db = (sql) => {
  const output = execFileSync('docker', ['exec', 'anc-mock-uat-postgres', 'psql', '-U', 'anc_mock_uat', '-d', 'anc_mock_uat', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
  return output ? JSON.parse(output) : null;
};
const safeUuid = (value) => /^[0-9a-f-]{36}$/iu.test(String(value ?? ''));
const stateSnapshot = (sessionId, tenantId) => {
  if (!safeUuid(sessionId) || !safeUuid(tenantId)) return null;
  return db(`SELECT json_build_object(
    'state',(SELECT conversation_state FROM chat_sessions WHERE id='${sessionId}' AND tenant_id='${tenantId}'),
    'actions',(SELECT count(*) FROM action_requests WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'leads',(SELECT count(*) FROM crm_leads WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'accounts',(SELECT count(*) FROM crm_accounts WHERE tenant_id='${tenantId}' AND opportunity_id IN (SELECT DISTINCT opportunity_id FROM action_requests WHERE session_id='${sessionId}' AND tenant_id='${tenantId}')),
    'documents',(SELECT count(*) FROM supporting_documents WHERE session_id='${sessionId}' AND tenant_id='${tenantId}'),
    'completedDocuments',(SELECT count(*) FROM supporting_documents WHERE session_id='${sessionId}' AND tenant_id='${tenantId}' AND status='completed'),
    'sf02',(SELECT count(*) FROM audit_events WHERE tenant_id='${tenantId}' AND event_name='document.sf02_attachment_verified' AND metadata->>'sessionId'='${sessionId}'),
    'lifecycle',(SELECT conversation_state->'intentProgress'->'entries'->'anc.company_formation'->'lifecycle' FROM chat_sessions WHERE id='${sessionId}' AND tenant_id='${tenantId}')
  )`);
};
const actionExecution = (sessionId, tenantId) => {
  if (!safeUuid(sessionId) || !safeUuid(tenantId)) return null;
  return db(`SELECT json_build_object(
    'actionId',a.id,'tenantId',a.tenant_id,'state',a.state,
    'executionReference',e.n8n_execution_ref,'eventId',e.event_id,
    'correlationId',e.correlation_id,'attempt',e.attempt
  ) FROM action_requests a JOIN action_executions e ON e.action_id=a.id
  WHERE a.session_id='${sessionId}' AND a.tenant_id='${tenantId}'
  ORDER BY a.created_at DESC LIMIT 1`);
};
const opportunityId = (snapshot) => {
  const state = snapshot?.state ?? {};
  const intent = state.intentProgress?.activeIntentKey ?? state.selectedIntentKey;
  return intent ? state.intentProgress?.entries?.[intent]?.journeyId ?? null : null;
};
const waitReady = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const live = await request('/api/v1/health/live');
    const ready = await request('/api/v1/health/ready');
    if (live.status === 200 && ready.status === 200) return true;
    await sleep(500);
  }
  return false;
};
const restart = async (service) => {
  execFileSync('docker', ['compose', '-p', project, '-f', composeFile, 'restart', service], { stdio: 'ignore', timeout: 30_000 });
  const ready = await waitReady();
  check(`service restart recovered: ${service}`, ready, { service });
  return ready;
};
const createSession = async (tenantSlug = 'anc') => {
  const result = await request('/api/v1/chat/sessions', { method: 'POST', body: { tenantSlug } });
  check(`created synthetic ${tenantSlug} session`, result.status === 201 && Boolean(result.body?.sessionId && result.body?.sessionToken), { status: result.status });
  return result.status === 201 ? result.body : null;
};
const send = async (session, message, clientMessageId = crypto.randomUUID()) => request('/api/v1/chat/messages', { method: 'POST', token: session.sessionToken, body: { sessionId: session.sessionId, type: 'text', message, clientMessageId } });
const confirm = async (session, actionId) => request(`/api/v1/chat/actions/${actionId}/confirm`, { method: 'POST', token: session.sessionToken, body: { sessionId: session.sessionId, confirmed: true } });
const waitAction = async (session, actionId) => {
  let latest = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    latest = await request(`/api/v1/chat/actions/${actionId}?sessionId=${encodeURIComponent(session.sessionId)}`, { token: session.sessionToken });
    if (['completed', 'failed', 'reconcile_required', 'human_review'].includes(latest.body?.action?.state)) break;
    await sleep(250);
  }
  return latest;
};
const processProposal = async (session, response, message) => {
  const proposalId = response.body?.actionProposal?.id;
  if (!proposalId) return null;
  const requiresConsent = response.body?.actionProposal?.consentRequired === true;
  if (requiresConsent && !/consent|yes|agree/i.test(message)) return proposalId;
  const first = await confirm(session, proposalId);
  check('explicit action confirmation accepted', [200, 202].includes(first.status), { status: first.status });
  const completed = await waitAction(session, proposalId);
  check('confirmed action reached a terminal state', ['completed', 'failed', 'reconcile_required', 'human_review'].includes(completed.body?.action?.state), { state: completed.body?.action?.state ?? null });
  return proposalId;
};

const session = await createSession();
let beforeFinal = null;
let documentId = null;
let opportunity = null;
if (session) {
  const messages = [
    'I want to start a synthetic software consulting company in the UAE.',
    'The business activity is software consulting and AI services.',
    'The company structure is LLC, I need 3 visas and I want to start next month.',
    `My name is Restart UAT and my email is ${syntheticEmail}.`,
    `My phone number is ${syntheticPhone}.`,
    'Yes, I explicitly consent to being contacted about this request.',
  ];
  let restartDone = false;
  for (const message of messages) {
    const response = await send(session, message);
    check(`conversation message accepted: ${message.slice(0, 32)}`, response.status === 200, { status: response.status });
    await processProposal(session, response, message);
    if (!restartDone && /consent/i.test(message)) {
      await restart('api');
      await restart('model-gateway');
      await restart('event-worker');
      await restart('event-relay');
      await restart('redis');
      const resumed = await request(`/api/v1/chat/sessions/${session.sessionId}`, { token: session.sessionToken });
      check('session state survived API, gateway, worker, relay and Redis restarts', resumed.status === 200, { status: resumed.status });
      const continuation = await send(session, 'Please continue from the verified company-formation step without changing my saved facts.');
      check('conversation continued after all service restarts', continuation.status === 200, { status: continuation.status });
      restartDone = true;
    }
  }

  const snapshotAfterLead = stateSnapshot(session.sessionId, session.tenantId);
  opportunity = opportunityId(snapshotAfterLead);
  check('stable opportunity persisted after restart', Boolean(opportunity), { opportunity: ref(opportunity) });
  const duplicateId = `gate3-duplicate-${runId.slice(0, 8)}`;
  const firstDuplicate = await send(session, 'Please confirm the saved timeline is next month.', duplicateId);
  const replayDuplicate = await send(session, 'Please confirm the saved timeline is next month.', duplicateId);
  const conflictingDuplicate = await send(session, 'Change the saved timeline to next year.', duplicateId);
  check('duplicate client message replay returns safely', firstDuplicate.status === 200 && replayDuplicate.status === 200, { first: firstDuplicate.status, replay: replayDuplicate.status });
  check('conflicting client message replay is rejected', conflictingDuplicate.status === 409 && conflictingDuplicate.body?.error?.code === 'MESSAGE_ID_REUSED', { status: conflictingDuplicate.status, code: conflictingDuplicate.body?.error?.code ?? null });

  if (opportunity) {
    const account = await request(`/api/v1/chat/sessions/${session.sessionId}/accounts/proposals`, { method: 'POST', token: session.sessionToken, body: { opportunityId: opportunity, conversionRule: 'qualification_verified' } });
    check('account proposal is available only after qualification', [200, 202].includes(account.status), { status: account.status });
    const accountId = account.body?.actionProposal?.id;
    if (accountId) {
      const confirmations = await Promise.all([confirm(session, accountId), confirm(session, accountId)]);
      check('concurrent account confirmations are idempotent or safely conflicted', confirmations.every((item) => [200, 202, 409].includes(item.status)), { statuses: confirmations.map((item) => item.status) });
      await waitAction(session, accountId);
    }
    await restart('api');
    const packages = await request(`/api/v1/chat/sessions/${session.sessionId}/packages`, { token: session.sessionToken });
    const offering = packages.body?.items?.[0];
    check('package options remain available after API restart', packages.status === 200 && Boolean(offering?.id), { status: packages.status });
    if (offering) {
      const proposal = await request(`/api/v1/chat/sessions/${session.sessionId}/packages/proposals`, { method: 'POST', token: session.sessionToken, body: { opportunityId: opportunity, packageOfferingId: offering.id } });
      const quote = await request(`/api/v1/chat/sessions/${session.sessionId}/packages/quotes`, { method: 'POST', token: session.sessionToken, body: { opportunityId: opportunity, packageOfferingId: offering.id } });
      const selection = proposal.body?.selection?.id && quote.body?.quote?.id
        ? await request(`/api/v1/chat/sessions/${session.sessionId}/packages/selections/${proposal.body.selection.id}/confirm`, { method: 'POST', token: session.sessionToken, body: { quoteId: quote.body.quote.id } })
        : { status: 0, body: null };
      check('package and approved quote remain durable', proposal.status === 201 && quote.status === 201 && selection.status === 200, { proposal: proposal.status, quote: quote.status, selection: selection.status });
      const pdf = Buffer.from('%PDF-1.7 ANC Gate 3 synthetic document').toString('base64');
      const upload = await request(`/api/v1/chat/sessions/${session.sessionId}/documents`, { method: 'POST', token: session.sessionToken, body: { fileName: 'gate3-restart.pdf', mimeType: 'application/pdf', contentBase64: pdf, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
      documentId = upload.body?.document?.id ?? null;
      check('synthetic document accepted after package confirmation', upload.status === 202 && Boolean(documentId), { status: upload.status });
      for (let attempt = 0; attempt < 40 && documentId; attempt += 1) {
        const documents = await request(`/api/v1/chat/sessions/${session.sessionId}/documents`, { token: session.sessionToken });
        if (documents.body?.items?.some((item) => item.id === documentId && item.status === 'completed')) break;
        await sleep(250);
      }
      await restart('event-worker');
      const duplicateUpload = await request(`/api/v1/chat/sessions/${session.sessionId}/documents`, { method: 'POST', token: session.sessionToken, body: { fileName: 'gate3-restart-copy.pdf', mimeType: 'application/pdf', contentBase64: pdf, primaryIntentKey: 'anc.company_formation', requirementKey: 'business_supporting_document', processingConsent: true } });
      check('duplicate document upload remains idempotent after worker restart', duplicateUpload.status === 202 && duplicateUpload.body?.idempotent === true, { status: duplicateUpload.status, idempotent: duplicateUpload.body?.idempotent ?? false });
    }
  }

  const other = await createSession('anc-empty');
  if (other) {
    const crossTenant = await request(`/api/v1/chat/sessions/${session.sessionId}/documents`, { token: other.sessionToken });
    check('cross-tenant document replay is rejected', [401, 403, 404].includes(crossTenant.status), { status: crossTenant.status });
  }
  const execution = actionExecution(session.sessionId, session.tenantId);
  if (execution?.actionId && execution.eventId && execution.correlationId && execution.executionReference) {
    const forged = await request('/api/v1/internal/workflow-events/complete', { method: 'POST', headers: { 'x-agentic-internal-secret': internalSecret }, body: { actionId: execution.actionId, tenantId: execution.tenantId, state: 'completed', externalReference: 'forged-replay', executionReference: 'forged-execution', eventId: execution.eventId, correlationId: execution.correlationId, attempt: execution.attempt } });
    check('forged provider callback is rejected', forged.status === 409, { status: forged.status });
    const replay = await request('/api/v1/internal/workflow-events/complete', { method: 'POST', headers: { 'x-agentic-internal-secret': internalSecret }, body: { actionId: execution.actionId, tenantId: execution.tenantId, state: 'completed', externalReference: 'replay-safe', executionReference: execution.executionReference, eventId: execution.eventId, correlationId: execution.correlationId, attempt: execution.attempt } });
    check('replayed provider callback is idempotent', replay.status === 200, { status: replay.status });
  } else {
    check('provider execution evidence available for callback replay', false, { reason: 'No durable action execution found.' });
  }
  beforeFinal = stateSnapshot(session.sessionId, session.tenantId);
  check('final durable state has exactly one Lead, Account and document', Number(beforeFinal?.leads ?? 0) === 1 && Number(beforeFinal?.accounts ?? 0) === 1 && Number(beforeFinal?.documents ?? 0) === 1 && Number(beforeFinal?.completedDocuments ?? 0) === 1, { counts: { leads: beforeFinal?.leads ?? null, accounts: beforeFinal?.accounts ?? null, documents: beforeFinal?.documents ?? null, completedDocuments: beforeFinal?.completedDocuments ?? null } });
  check('final durable state contains verified SF-02 mock evidence', Number(beforeFinal?.sf02 ?? 0) === 1, { sf02VerifiedReceipts: beforeFinal?.sf02 ?? null });
  check('final lifecycle is stopped after document upload', beforeFinal?.lifecycle?.stages?.document_upload?.status === 'completed' && beforeFinal?.lifecycle?.currentStage === 'billing_invoice' && beforeFinal?.lifecycle?.stages?.billing_invoice?.status !== 'completed', { currentStage: beforeFinal?.lifecycle?.currentStage ?? null, documentStage: beforeFinal?.lifecycle?.stages?.document_upload?.status ?? null, billingStage: beforeFinal?.lifecycle?.stages?.billing_invoice?.status ?? null });
}

const report = {
  status: checks.every((item) => item.passed) ? 'PASSED' : 'FAILED',
  runId: ref(runId),
  startedAt,
  endedAt: new Date().toISOString(),
  apiBase,
  composeProject: project,
  syntheticOnly: true,
  sessionReference: ref(session?.sessionId),
  tenantReference: ref(session?.tenantId),
  opportunityReference: ref(opportunity),
  documentReference: ref(documentId),
  finalState: beforeFinal ? { leads: beforeFinal.leads, accounts: beforeFinal.accounts, documents: beforeFinal.documents, completedDocuments: beforeFinal.completedDocuments, sf02VerifiedReceipts: beforeFinal.sf02 } : null,
  checks,
  restartServices: ['api', 'model-gateway', 'event-worker', 'event-relay', 'redis'],
};
await mkdir(outputPath.split(/[\\/]/u).slice(0, -1).join('/') || '.', { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, checks: checks.length, passed: checks.filter((item) => item.passed).length, outputPath }, null, 2));
if (report.status !== 'PASSED') process.exitCode = 1;

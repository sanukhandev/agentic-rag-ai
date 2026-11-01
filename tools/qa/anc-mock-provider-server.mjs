import http from 'node:http';

const apiBase = (process.env.API_BASE_URL ?? 'http://api:4000').replace(/\/$/u, '');
const n8nSecret = process.env.N8N_WEBHOOK_SECRET ?? '';
const workerSecret = process.env.INGESTION_WORKER_SECRET ?? '';
const handledEvents = new Set();
const calls = [];

const json = (res, status, value) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const api = async (path, method, body, headers = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let value = null;
  try { value = text ? JSON.parse(text) : null; } catch { value = { raw: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(`mock provider API ${method} ${path} returned ${response.status}: ${JSON.stringify(value).slice(0, 300)}`);
  return value;
};

const completeAction = async (body, executionReference) => api('/api/v1/internal/workflow-events/complete', 'POST', {
  actionId: body.actionId,
  tenantId: body.tenantId,
  state: 'completed',
  externalReference: `mock-${body.workflowKey}-${body.actionId}`,
  executionReference,
  eventId: body.eventId,
  correlationId: body.correlationId,
  attempt: body.attempt,
  ...(body.sessionId ? { sessionId: body.sessionId } : {}),
  ...(body.opportunityId !== undefined ? { opportunityId: body.opportunityId } : {}),
  ...(body.catalogVersionId ? { catalogVersionId: body.catalogVersionId } : {}),
  ...(body.actionKey ? { actionKey: body.actionKey } : {}),
  ...(body.actionRevision ? { actionRevision: body.actionRevision } : {}),
}, { 'x-agentic-internal-secret': n8nSecret });

const handleAction = async (body) => {
  const executionReference = `mock-exec-${body.eventId}`;
  const claim = await api('/api/v1/internal/workflow-events/claim', 'POST', {
    actionId: body.actionId,
    tenantId: body.tenantId,
    workflowKey: body.workflowKey,
    n8nWorkflowId: body.n8nWorkflowId ?? `mock-${body.workflowKey}`,
    contract: body.contract,
    executionReference,
    eventId: body.eventId,
    correlationId: body.correlationId,
    attempt: body.attempt,
    limit: 10,
  }, { 'x-agentic-internal-secret': n8nSecret });
  for (const item of claim.items ?? []) {
    if (body.workflowKey === 'crm.lead.create') {
      const createdLead = await api('/api/v1/internal/crm/leads', 'POST', {
        actionId: item.actionId,
        tenantId: item.tenantId,
        sessionId: item.sessionId,
        leadData: { ...(item.leadData ?? {}), contactConsent: true },
        intent: item.intent,
        intentScore: item.intentScore,
        intentConfidence: item.intentConfidence,
        catalogVersionId: item.catalogVersionId,
        score: 100,
        validationPass: true,
        conversation: item.conversation,
        completeAction: false,
      }, { 'x-agentic-internal-secret': n8nSecret });
      const leadId = createdLead.lead?.id;
      if (!leadId) throw new Error('mock lead provider did not receive a durable lead id');
      await api(`/api/v1/internal/crm/leads/${leadId}/remote`, 'PUT', { tenantId: item.tenantId, leadId: `mock-lead-${leadId}`, remoteCrm: 'deterministic-mock' }, { 'x-agentic-internal-secret': n8nSecret });
      await api(`/api/v1/internal/crm/leads/${leadId}/qualification`, 'PUT', { tenantId: item.tenantId, score: 100, summary: 'Synthetic qualification verified by deterministic UAT provider.', status: 'qualified', evidence: { provider: 'deterministic_mock', factsVerified: true } }, { 'x-agentic-internal-secret': n8nSecret });
    } else if (body.workflowKey === 'crm.account.convert') {
      const accountId = item.leadData?.slotValues?.crmAccountId;
      if (!accountId) throw new Error('mock account action did not contain an account reference');
      await api(`/api/v1/internal/crm/accounts/${accountId}/remote-payload`, 'POST', { tenantId: item.tenantId, actionId: item.actionId }, { 'x-agentic-internal-secret': n8nSecret });
      await api(`/api/v1/internal/crm/accounts/${accountId}/remote`, 'PUT', { tenantId: item.tenantId, actionId: item.actionId, remoteAccountId: `mock-account-${accountId}`, remoteContactId: `mock-contact-${accountId}`, remoteOpportunityId: `mock-opportunity-${accountId}` }, { 'x-agentic-internal-secret': n8nSecret });
    }
    await completeAction(body, executionReference);
  }
  // A retry may find the provider result durable but the callback incomplete; replay only the terminal callback.
  if ((claim.items ?? []).length === 0) await completeAction(body, executionReference);
};

const handleDocument = async (body) => {
  const claimed = await api('/api/v1/internal/document-jobs/claim-next', 'POST', {}, { 'x-ingestion-worker-secret': workerSecret });
  if (!claimed.job || claimed.job.id !== body.jobId) throw new Error('mock document provider claimed an unexpected job');
  await api(`/api/v1/internal/document-jobs/${claimed.job.id}/result`, 'POST', {
    tenantId: body.tenantId,
    jobId: claimed.job.id,
    extractedText: 'Synthetic UAT document; no real identity data.',
    summary: 'Synthetic document processed by the deterministic UAT provider.',
    executionReference: `mock-document-${claimed.job.id}`,
  }, { 'x-ingestion-worker-secret': workerSecret });
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { json(res, 200, { status: 'ok', mode: 'deterministic', calls: calls.length }); return; }
  if (req.method !== 'POST' || !req.url?.startsWith('/webhook/')) { json(res, 404, { error: 'not_found' }); return; }
  try {
    if (req.headers['x-agentic-internal-secret'] !== n8nSecret) { json(res, 401, { error: 'unauthorized' }); return; }
    const body = await readBody(req);
    calls.push({ eventId: body.eventId ?? null, eventType: body.eventType ?? null, workflowKey: body.workflowKey ?? null });
    if (body.eventId && handledEvents.has(body.eventId)) { json(res, 200, { accepted: true, idempotent: true }); return; }
    if (body.eventType === 'intent.action.requested.v1') await handleAction(body);
    else if (body.eventType === 'document.extraction.requested.v1') await handleDocument(body);
    else throw new Error(`unsupported mock event ${body.eventType}`);
    if (body.eventId) handledEvents.add(body.eventId);
    json(res, 200, { accepted: true, evidenceTier: 'mock_verified' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'mock_provider.error', route: req.url, message: error instanceof Error ? error.message : String(error).slice(0, 300) }));
    json(res, 500, { error: 'mock_provider_failed' });
  }
});

server.listen(8090, '0.0.0.0', () => console.log(JSON.stringify({ event: 'mock_provider.ready', mode: 'deterministic' })));
